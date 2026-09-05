import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import type { Case, CaseDiseaseLink, DiseaseTemplate, LabItemMaster, OrderType } from "@prisma/client";
import {
  aggregateLabResult,
  aggregateVitals,
  applyContraindicationJump,
  applyDrugLabEffect,
  computeAiSeverityRatePerHour,
  computeCaseSeverityAtTime,
  evaluateCrisisTriggers,
  findActiveOxygenBoost,
  findActiveVitalsIntervalHours,
  findCrisisRescueAt,
  getCaseClockNow,
  parsePhysiologyParams,
  resolveActiveDrugEffects,
  summarizeDrugEffects,
  type ActiveDrugEffects,
  type CrisisRescueConfig,
  type CrisisTrigger,
  type CrisisTriggerConfig,
  type DiseaseContribution,
  type DrugEffectRule,
  type DrugOrderForEffect,
  type PatternSet,
  type SeverityTier,
  type TemplateConfig,
  type VitalPoint,
} from "@/lib/physiology-engine";
import { formatLabValues, type LabValue } from "@/lib/lab-reference-ranges";
import { treatmentTriggerSchema, vitalCoefficientsSchema } from "@/lib/schemas";
import { evaluateTreatment, type TargetedTherapyContext } from "@/lib/ai-treatment-evaluation";
import {
  evaluateAntibioticCoverage,
  isSpecimenSiteRelevant,
  resolveCultureFinalResult,
  resolveCulturePreliminaryResult,
  type ActiveAntibioticCategory,
  type PathogenProfile,
} from "@/lib/infection-engine";

// DiseaseTemplateとその関連テーブル（TemplateLabPattern/TemplateCrisisScenario等）から、
// physiology-engine.tsの純粋な計算関数が期待するTemplateConfig形へ組み立てる。
// vitalsConfig/treatmentConfigが未設定のテンプレート（管理画面でまだ入力していない）はnullを返す
// （エンジン非対応。従来の重症度カーブ・急変判定は一切走らない）。
function parseCrisisTriggerRows(rows: { type: string; code: string | null; label: string | null; field: string | null; op: string; value: number }[]): CrisisTrigger[] {
  return rows.map((t) => {
    if (t.type === "severity") return { type: "severity", op: t.op as ">=" | "<=", value: t.value };
    if (t.type === "vital") return { type: "vital", field: t.field as keyof VitalPoint, op: t.op as ">=" | "<=", value: t.value };
    return { type: "lab", code: t.code ?? "", label: t.label ?? undefined, op: t.op as ">=" | "<=", value: t.value };
  });
}

export async function loadTemplateConfig(templateKey: string | null | undefined): Promise<TemplateConfig | null> {
  if (!templateKey) return null;
  const template = await db.diseaseTemplate.findUnique({
    where: { key: templateKey },
    include: {
      labPatterns: { include: { values: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } },
      crisisTriggers: {
        include: { triggers: { orderBy: { sortOrder: "asc" } }, targetTemplate: { select: { key: true, name: true } } },
        orderBy: { sortOrder: "asc" },
      },
      crisisRescue: { include: { rescueActions: { orderBy: { sortOrder: "asc" } } } },
    },
  });
  if (!template || !template.vitalsConfig || !template.treatmentConfig) return null;

  // treatmentConfig/vitalsConfigは管理画面の手入力・Turso手動同期を経由するJSON文字列のため、
  // 形が壊れていても未ガードのJSON.parseで全カルテ描画をクラッシュさせないよう、パース失敗・
  // スキーマ不一致は「このテンプレートはエンジン未対応」として扱う（呼び出し側は既にnullを想定済み）。
  const treatmentParsed = safeJsonParse(template.treatmentConfig, treatmentTriggerSchema);
  const vitalsParsed = safeJsonParse(template.vitalsConfig, vitalCoefficientsSchema);
  if (!treatmentParsed.success || !vitalsParsed.success) return null;

  const labPatterns: Record<string, PatternSet> = {};
  for (const p of template.labPatterns) {
    if (p.kind === "text") {
      labPatterns[p.labItemCode] = {
        kind: "text",
        patterns: { mild: p.mildText ?? "", moderate: p.moderateText ?? "", severe: p.severeText ?? "" },
      };
    } else {
      const byTier: Record<SeverityTier, LabValue[]> = { mild: [], moderate: [], severe: [] };
      for (const v of p.values) {
        byTier[v.tier as SeverityTier].push({ label: v.label, value: v.value, unit: v.unit, note: v.note ?? undefined });
      }
      labPatterns[p.labItemCode] = { kind: "values", patterns: byTier };
    }
  }

  const crisisTriggers: CrisisTriggerConfig[] = template.crisisTriggers.map((s) => ({
    id: s.id,
    targetTemplateKey: s.targetTemplate.key,
    targetTemplateName: s.targetTemplate.name,
    triggers: parseCrisisTriggerRows(s.triggers),
    sustainMinutes: s.sustainMinutes,
  }));

  const crisisRescue: CrisisRescueConfig | null = template.crisisRescue
    ? {
        postRescueSeverity: template.crisisRescue.postRescueSeverity,
        rescueActions: template.crisisRescue.rescueActions.map((r) => ({
          label: r.label,
          drugCategories: parseStringArray(r.drugCategories),
          procedureKeywords: parseStringArray(r.procedureKeywords),
        })),
      }
    : null;

  return {
    treatment: treatmentParsed.data,
    vitals: vitalsParsed.data,
    labPatterns,
    crisisTriggers,
    crisisRescue,
  };
}

// JSON.parseとzod検証をまとめたヘルパー。不正なJSON・スキーマ不一致のどちらもsuccess:falseに正規化する
// （呼び出し側はJSON構文エラーとスキーマ不一致を区別する必要が無いため）。
export function safeJsonParse<T>(raw: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }): { success: true; data: T } | { success: false } {
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? { success: true, data: result.data as T } : { success: false };
  } catch {
    return { success: false };
  }
}

// この検査項目コードが、いずれかの病態テンプレートの動的所見パターンで使われているか
export async function loadEngineLinkedLabCodes(): Promise<Set<string>> {
  const rows = await db.templateLabPattern.findMany({ select: { labItemCode: true }, distinct: ["labItemCode"] });
  return new Set(rows.map((r) => r.labItemCode));
}

// ── 感染症エンジン（原因菌×抗菌薬感受性による培養結果生成） ──────────────────────

// 症例にアタッチされた疾患リンクのうち、最初に「真の原因菌」が設定されているものを返す
// （通常は感染症系テンプレートが1つだけ該当する想定）。どのリンクにも設定が無ければnull。
export function findCasePathogenId(diseaseLinks: { pathogenId: string | null }[]): string | null {
  return diseaseLinks.find((l) => l.pathogenId)?.pathogenId ?? null;
}

// findCasePathogenIdと対になる検体部位制限。原因菌を持つ疾患リンクのrelevantSpecimenSitesを返す
// （通常は原因菌を持つリンクが1つだけの想定なので、findCasePathogenIdと同じ行を探す）。
// null＝制限なし（isSpecimenSiteRelevantが常にtrueを返す）。
export function findCaseRelevantSpecimenSites(diseaseLinks: { pathogenId: string | null; relevantSpecimenSites: string | null }[]): string[] | null {
  const link = diseaseLinks.find((l) => l.pathogenId);
  if (!link?.relevantSpecimenSites) return null;
  return parseStringArray(link.relevantSpecimenSites);
}

export async function loadPathogenProfile(pathogenId: string): Promise<PathogenProfile | null> {
  const pathogen = await db.pathogenMaster.findUnique({
    where: { id: pathogenId },
    include: { susceptibilities: { include: { category: true } } },
  });
  if (!pathogen) return null;
  return {
    name: pathogen.name,
    gramStain: pathogen.gramStain,
    susceptibilities: pathogen.susceptibilities.map((s) => ({
      subCategory: s.category.subCategory ?? s.category.majorCategory,
      susceptibility: s.susceptibility as "S" | "I" | "R",
      note: s.note,
    })),
  };
}

const DEFAULT_RESULT_TEXT = "結果は基準範囲内です。";
const DELAYED_RESULT_DELAY_MS = 2 * 3_600_000; // 遅延型オーダーの結果反映までの固定遅延（簡易実装。症例の時計＝実時間 or シミュレーション時間で解釈）
// バイタルの自動記録間隔（実時間 or シミュレーション時間）。既定は4時間ごとだが、学生・教員が
// 一般指示「バイタル測定」オーダーで2〜8時間ごとの範囲に調節できる（findActiveVitalsIntervalHours）。
// 急変(crisisState=CRITICAL)発生中はその指示に関わらずリアルタイム監視相当（15分ごと）に強制する。
const DEFAULT_SNAPSHOT_INTERVAL_HOURS = 4;
const CRITICAL_SNAPSHOT_INTERVAL_HOURS = 0.25;
const MAX_SNAPSHOTS_PER_RECONCILE = 12; // 一度に生成するバイタル記録の上限（時間を大きく進めた場合の暴走防止）

// 症例にアタッチされた1病態モデル分の状態（DiseaseTemplate本体込み）
type LinkWithTemplate = CaseDiseaseLink & { template: DiseaseTemplate };

type CaseForEngine = Pick<
  Case,
  | "id"
  | "title"
  | "patientName"
  | "patientAge"
  | "patientGender"
  | "createdAt"
  | "timeProgressMode"
  | "simNowAt"
  | "crisisMode"
  | "crisisState"
  | "crisisStartedAt"
> & {
  diseaseLinks: LinkWithTemplate[];
};

type TreatmentOrderWithDrug = {
  orderedAt: Date;
  orderType: OrderType;
  label: string;
  detail: string | null;
  discontinuedAt: Date | null;
  drug: { categoryLinks: { categoryId: string; category: { majorCategory: string } }[] } | null;
};

// 薬剤影響エンジン向け: 処方・注射オーダーのうちdrugが紐づくものだけを、判定に使う形(categoryIds)へ変換する。
function toDrugOrdersForEffect(orders: TreatmentOrderWithDrug[]): DrugOrderForEffect[] {
  return orders
    .filter((o): o is TreatmentOrderWithDrug & { drug: NonNullable<TreatmentOrderWithDrug["drug"]> } => o.drug !== null)
    .map((o) => ({
      orderedAt: o.orderedAt,
      discontinuedAt: o.discontinuedAt,
      categoryIds: o.drug.categoryLinks.map((l) => l.categoryId),
    }));
}

// 症例横断で共有できるマスターデータ(件数が少なく症例に依存しない)。呼び出しごとに全件取得する。
export async function loadDrugEffectRules(): Promise<DrugEffectRule[]> {
  const rows = await db.drugEffectRule.findMany({
    select: { categoryId: true, targetType: true, target: true, shiftValue: true, effectText: true, onsetDelayHours: true },
  });
  return rows.map((r) => ({ ...r, targetType: r.targetType === "vital" ? "vital" : "lab" }));
}

// atTime時点で有効な薬剤影響ルールを、バイタル・検査値それぞれの加算量へ集約する(resolveActiveDrugEffects
// + summarizeDrugEffectsのまとめ)。submitOrderBatch（即時結果を解決する箇所）からも直接使う。
export function computeDrugEffectsAt(orders: TreatmentOrderWithDrug[], rules: DrugEffectRule[], atTime: Date): ActiveDrugEffects {
  const active = resolveActiveDrugEffects(toDrugOrdersForEffect(orders), rules, atTime);
  return summarizeDrugEffects(active);
}

export function computeResultReadyAt(resultTiming: "IMMEDIATE" | "DELAYED", now = new Date()): Date {
  if (resultTiming === "IMMEDIATE") return now;
  return new Date(now.getTime() + DELAYED_RESULT_DELAY_MS);
}

export type LabResult = { text: string; values: LabValue[] | null };

// 症例にアタッチされた複数疾患のうち、危機シナリオ・AI治療評価の対象として扱う1件を返す
// （isPrimaryの疾患。未設定なら先頭の疾患にフォールバック。疾患が1件も無ければnull）。
export function findPrimaryDiseaseLink<T extends { isPrimary: boolean }>(links: T[]): T | null {
  return links.find((l) => l.isPrimary) ?? links[0] ?? null;
}

function parseLabValues(raw: string | null): LabValue[] | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LabValue[];
  } catch {
    return null;
  }
}

// drugCategories/procedureKeywordsは常にJSON.stringify(string[])で保存される想定だが、
// 過去のスキーマ移行で複製されたレガシーデータ等、想定外の値が1件でも混ざると
// 未ガードのJSON.parseがページ全体をクラッシュさせてしまうため、壊れた値は空配列として扱う。
function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

// 生理モデルの基礎値（バイタルのみ）。年齢・性別に該当するPhysiologyBaselineBandがあればbaseはその値、
// なければBasePhysiologyModel（症例・疾患非依存のシングルトン、常に1行だけ存在する想定）にフォールバックする。
// referenceは常にBasePhysiologyModelの値（各病態テンプレートのperSeverityがこれを基準に定義されているため、
// aggregateVitalsがbase/referenceの比率でperSeverityをスケーリングするのに使う。詳細はphysiology-engine.ts参照）。
// BasePhysiologyModel自体が万一未初期化の場合は生理学的に妥当な既定値にフォールバックする。
async function loadPhysiologyBaseline(age: number, gender: string): Promise<{ base: VitalPoint; reference: VitalPoint }> {
  const referenceRow = await db.basePhysiologyModel.findUnique({ where: { id: "default" } });
  const reference: VitalPoint = referenceRow
    ? {
        temperature: referenceRow.temperature,
        systolicBp: referenceRow.systolicBp,
        diastolicBp: referenceRow.diastolicBp,
        pulse: referenceRow.pulse,
        spo2: referenceRow.spo2,
        respRate: referenceRow.respRate,
      }
    : { temperature: 36.5, systolicBp: 120, diastolicBp: 70, pulse: 75, spo2: 98, respRate: 16 };

  const bands = await db.physiologyBaselineBand.findMany({ where: { minAge: { lte: age }, maxAge: { gte: age } } });
  const match = bands.find((b) => b.gender === gender) ?? bands.find((b) => b.gender === "共通") ?? null;
  const base: VitalPoint = match
    ? {
        temperature: match.temperature,
        systolicBp: match.systolicBp,
        diastolicBp: match.diastolicBp,
        pulse: match.pulse,
        spo2: match.spo2,
        respRate: match.respRate,
      }
    : reference;

  return { base, reference };
}

// 症例にアタッチされた各疾患について、指定時刻における(テンプレート設定, 重症度)の組を集める。
// エンジン非対応（vitalsConfig/treatmentConfig未設定）のテンプレートはスキップする（寄与0）。
// overrideSeverityを渡すと全疾患の重症度をその値に固定する（危機発生中・死亡後にsevere値へ倒す用途）。
// db.$transaction内では使わないこと（テンプレート設定の読み込みに別途DB読み取りが発生するため、
// トランザクション開始前に呼んで結果を渡す。submitOrderBatchのLABオーダー解決を参照）。
export async function loadDiseaseContributionsAt(
  diseaseLinks: LinkWithTemplate[],
  orders: TreatmentOrderWithDrug[],
  atTime: Date,
  overrideSeverity?: number
): Promise<(DiseaseContribution & { link: LinkWithTemplate })[]> {
  const contributions: (DiseaseContribution & { link: LinkWithTemplate })[] = [];
  for (const link of diseaseLinks) {
    const config = await loadTemplateConfig(link.template.key);
    if (!config) continue;
    const severity = overrideSeverity ?? computeCaseSeverityAtTime(link, orders, config, atTime);
    if (severity === null) continue;
    contributions.push({ link, config, severity });
  }
  return contributions;
}

// 病態テンプレートに紐づく検査項目なら、その時点の重症度に応じた（複数疾患を統合した）所見を返し、
// さらに薬剤影響エンジンのdrugLabEffects（有効なら）をその上へ加算する。テンプレート対象外の項目や
// どの疾患もパターンを持たない場合は、マスターの固定値/固定文をベースに同様に薬剤影響を加算する。
export function resolveLabResult(
  contributions: DiseaseContribution[],
  labItem: Pick<LabItemMaster, "code" | "sampleResult" | "sampleValues"> | null,
  drugLabEffects?: Pick<ActiveDrugEffects, "labShifts" | "labTexts">
): LabResult {
  if (!labItem) return { text: DEFAULT_RESULT_TEXT, values: null };

  const baseSampleValues = parseLabValues(labItem.sampleValues);
  const dynamic = aggregateLabResult(labItem.code, contributions, baseSampleValues);
  const result: LabResult = dynamic
    ? dynamic
    : baseSampleValues
      ? { text: formatLabValues(baseSampleValues), values: baseSampleValues }
      : labItem.sampleResult
        ? { text: labItem.sampleResult, values: null }
        : { text: DEFAULT_RESULT_TEXT, values: null };

  if (!drugLabEffects) return result;
  const shift = drugLabEffects.labShifts[labItem.code] ?? 0;
  const texts = drugLabEffects.labTexts[labItem.code] ?? [];
  return applyDrugLabEffect(result, shift, texts);
}

// resolveLabResult向けに、症例の全疾患の寄与＋薬剤影響を指定時刻で計算してから解決するまとめ関数。
// crisisState が STABLE でない（危機シナリオ発生中・死亡後）症例は、通常の重症度カーブでなく
// 常にsevere階層の所見を返す（危機専用の所見までは作り込まず、既存のsevere値を流用する）。
export async function resolveLabResultForCase(
  caseRecord: Pick<CaseForEngine, "crisisState" | "diseaseLinks">,
  treatmentOrders: TreatmentOrderWithDrug[],
  drugEffectRules: DrugEffectRule[],
  labItem: Pick<LabItemMaster, "code" | "sampleResult" | "sampleValues"> | null,
  atTime: Date
): Promise<LabResult> {
  const overrideSeverity = caseRecord.crisisState === "STABLE" ? undefined : 100;
  const contributions = await loadDiseaseContributionsAt(caseRecord.diseaseLinks, treatmentOrders, atTime, overrideSeverity);
  const drugEffects = computeDrugEffectsAt(treatmentOrders, drugEffectRules, atTime);
  return resolveLabResult(contributions, labItem, drugEffects);
}

async function loadCaseForEngine(caseId: string): Promise<CaseForEngine | null> {
  return db.case.findUnique({
    where: { id: caseId },
    include: { diseaseLinks: { include: { template: true }, orderBy: { sortOrder: "asc" } } },
  });
}

// MEDICATION/INJECTION（薬剤治療判定）・PROCEDURE（処置・手術治療判定）・
// GENERAL（酸素投与のSpO2上乗せ判定・バイタル測定間隔判定）をまとめて取得する。
// 判定に使わないオーダー種別（LAB/IMAGING）は含めない。
async function loadTreatmentOrders(caseId: string): Promise<TreatmentOrderWithDrug[]> {
  return db.order.findMany({
    where: { caseId, orderType: { in: ["MEDICATION", "INJECTION", "PROCEDURE", "GENERAL"] } },
    select: {
      orderedAt: true,
      orderType: true,
      label: true,
      detail: true,
      discontinuedAt: true,
      drug: { select: { categoryLinks: { select: { categoryId: true, category: { select: { majorCategory: true } } } } } },
    },
  });
}

// AI治療評価（標的治療フェーズ）向け: 抗菌薬オーダー(MEDICATION/INJECTION)を、感受性判定に使う
// 系統(DrugCategoryMaster.subCategory)単位に解決する。severityカーブの治療判定用loadTreatmentOrders
// （大分類のみ見る二値判定）とは別軸の解決なので専用に用意する。
async function loadActiveAntibioticCategories(caseId: string): Promise<ActiveAntibioticCategory[]> {
  const orders = await db.order.findMany({
    where: { caseId, orderType: { in: ["MEDICATION", "INJECTION"] } },
    select: {
      label: true,
      drug: {
        select: {
          categoryLinks: {
            // 抗結核薬は結核菌の感受性データを持たせるため対象に含める（loadPathogenProfileの
            // subCategory解決とPathogenSusceptibility側の分類軸を揃える必要がある）。
            where: { category: { majorCategory: { in: ["抗菌薬", "抗結核薬"] } } },
            select: { category: { select: { subCategory: true, majorCategory: true } } },
          },
        },
      },
    },
  });

  const result: ActiveAntibioticCategory[] = [];
  for (const order of orders) {
    for (const link of order.drug?.categoryLinks ?? []) {
      result.push({ subCategory: link.category.subCategory ?? link.category.majorCategory, drugLabel: order.label });
    }
  }
  return result;
}

// AI治療評価（標的治療フェーズ）向け: 症例に原因菌が割り当てられ、かつ「妥当な検体部位」の培養の
// 確定結果(RESULT_AVAILABLE)が開示済みの場合のみ、現在の抗菌薬オーダーの原因菌カバレッジを判定して返す。
// 原因菌未割当・培養未確定（＝学生がまだ原因菌を知り得ない経験的治療フェーズ）、または部位不一致で
// 陰性確定しただけの培養しかない場合はnullを返し、AIの採点材料に含めない
// （既存の大分類ベースの二値判定のみで評価される、従来どおりの挙動を維持する）。
async function loadTargetedTherapyContext(
  caseRecord: Pick<CaseForEngine, "id" | "diseaseLinks">
): Promise<TargetedTherapyContext | null> {
  const casePathogenId = findCasePathogenId(caseRecord.diseaseLinks);
  if (!casePathogenId) return null;

  const relevantSites = findCaseRelevantSpecimenSites(caseRecord.diseaseLinks);
  const revealedCultureOrders = await db.order.findMany({
    where: { caseId: caseRecord.id, status: "RESULT_AVAILABLE", labItem: { isCulture: true } },
    select: { labItem: { select: { specimenSite: true } } },
  });
  const cultureRevealed = revealedCultureOrders.some((o) => isSpecimenSiteRelevant(relevantSites, o.labItem?.specimenSite ?? null));
  if (!cultureRevealed) return null;

  const pathogen = await loadPathogenProfile(casePathogenId);
  if (!pathogen) return null;

  const activeCategories = await loadActiveAntibioticCategories(caseRecord.id);
  return { pathogenName: pathogen.name, coverage: evaluateAntibioticCoverage(pathogen, activeCategories) };
}

const PRESCRIPTION_DURATION_DAYS_RE = /^(\d+)日分$/;

// 定期処方（dosingType==="定期"）のうち、指定日数（duration、例: "5日分"）を症例の時計で
// 経過したものを自動的に中止扱いにする。頓用（回数指定）・注射・点滴は対象外
// （日数という概念を持たないため）。discontinuedAtには「今」ではなく計算済みの正確な
// 期限時刻を入れる（以降の重症度・バイタル計算がその時刻を基準に治療終了を反映できるようにするため）。
export async function reconcileExpiredPrescriptions(caseId: string): Promise<void> {
  const caseRecord = await loadCaseForEngine(caseId);
  if (!caseRecord || caseRecord.crisisState === "DECEASED") return;
  const clockNow = getCaseClockNow(caseRecord);

  const active = await db.order.findMany({
    where: { caseId, orderType: "MEDICATION", discontinuedAt: null },
  });

  for (const order of active) {
    if (!order.detail) continue;
    let detail: { dosingType?: string; duration?: string };
    try {
      detail = JSON.parse(order.detail);
    } catch {
      continue;
    }
    if (detail.dosingType !== "定期" || !detail.duration) continue;
    const match = detail.duration.match(PRESCRIPTION_DURATION_DAYS_RE);
    if (!match) continue;

    const days = Number(match[1]);
    const expiresAt = new Date(order.orderedAt.getTime() + days * 24 * 3_600_000);
    if (expiresAt > clockNow) continue;

    await db.order.update({ where: { id: order.id }, data: { status: "DISCONTINUED", discontinuedAt: expiresAt } });
    await logAudit({
      userId: order.orderedByUserId,
      action: "auto_discontinue_prescription",
      targetType: "Order",
      targetId: order.id,
      detail: { expiresAt },
    });
  }
}

// 遅延型オーダーのうち反映時刻を過ぎたものを「結果あり」に更新し、通知を発行する。
// 「反映時刻を過ぎたか」は症例の時計（REALTIME=実時間 / MANUAL=シミュレーション時間）で判定する。
export async function reconcileCaseResults(caseId: string): Promise<void> {
  const caseRecord = await loadCaseForEngine(caseId);
  if (!caseRecord || caseRecord.crisisState === "DECEASED") return;
  const clockNow = getCaseClockNow(caseRecord);

  const pending = await db.order.findMany({
    where: { caseId, status: { in: ["RESULT_PENDING", "RESULT_PRELIMINARY"] } },
    include: { labItem: true },
  });
  if (pending.length === 0) return;

  // 培養系検査(preliminaryResultReadyAtが設定されている＝isCulture&&原因菌割り当てありのオーダーのみ)の
  // 速報開示。確定開示のタイミングと同時に到達した場合は速報を飛ばして確定へ進む（下のdueFinalへ）。
  const duePrelim = pending.filter(
    (o) =>
      o.status === "RESULT_PENDING" &&
      o.preliminaryResultReadyAt &&
      o.preliminaryResultReadyAt <= clockNow &&
      (!o.resultReadyAt || o.resultReadyAt > clockNow)
  );
  const dueFinal = pending.filter((o) => o.resultReadyAt && o.resultReadyAt <= clockNow);
  if (duePrelim.length === 0 && dueFinal.length === 0) return;

  const casePathogenId = findCasePathogenId(caseRecord.diseaseLinks);
  const pathogen = casePathogenId ? await loadPathogenProfile(casePathogenId) : null;
  const relevantSites = findCaseRelevantSpecimenSites(caseRecord.diseaseLinks);
  // 検体部位が症例にとって妥当な注文だけに原因菌を反映する。部位不一致の注文は「原因菌未割り当て」と
  // 同じフォールバック経路（LabItemMaster.sampleResult表示）に合流させる。
  const effectivePathogenFor = (labItem: { specimenSite: string | null } | null) =>
    isSpecimenSiteRelevant(relevantSites, labItem?.specimenSite ?? null) ? pathogen : null;
  // 通常検査(非培養)の最終結果解決にのみ必要。培養系は原因菌モデルベースでオーダー履歴を見ないため省略可。
  const needsTreatmentOrders = dueFinal.some((o) => !o.labItem?.isCulture);
  const treatmentOrders = needsTreatmentOrders ? await loadTreatmentOrders(caseId) : [];
  const drugEffectRules = needsTreatmentOrders ? await loadDrugEffectRules() : [];

  for (const order of duePrelim) {
    const text = resolveCulturePreliminaryResult(
      effectivePathogenFor(order.labItem),
      order.labItem?.sampleResult ?? null,
      order.labItem?.microbiologyKind ?? null
    );
    await db.order.update({ where: { id: order.id }, data: { status: "RESULT_PRELIMINARY", resultText: text } });
    await db.notification.create({
      data: { userId: order.orderedByUserId, caseId, message: `${order.label} の速報結果が出ました。` },
    });
    await logAudit({ userId: null, action: "order_result_preliminary", targetType: "Order", targetId: order.id });
  }

  for (const order of dueFinal) {
    let result: LabResult;
    if (order.labItem?.isCulture) {
      result = {
        text: resolveCultureFinalResult(effectivePathogenFor(order.labItem), order.labItem.sampleResult, order.labItem.microbiologyKind),
        values: null,
      };
    } else {
      const atTime = order.resultReadyAt ?? new Date();
      result = await resolveLabResultForCase(caseRecord, treatmentOrders, drugEffectRules, order.labItem, atTime);
    }
    await db.order.update({
      where: { id: order.id },
      data: { status: "RESULT_AVAILABLE", resultText: result.text, resultValues: result.values ? JSON.stringify(result.values) : null },
    });
    await db.notification.create({
      data: {
        userId: order.orderedByUserId,
        caseId,
        message: `${order.label} の結果が出ました。`,
      },
    });
    await logAudit({ userId: null, action: "order_result_available", targetType: "Order", targetId: order.id });
  }
}

// 病態モデルがアタッチされた症例について、前回記録から現在時刻（実時間 or シミュレーション時間）までの
// バイタルを一定間隔で自動生成する。疾患未アタッチの症例は対象外（従来どおり静的なデータのまま）。
export async function reconcileCaseVitals(caseId: string): Promise<void> {
  const caseRecord = await loadCaseForEngine(caseId);
  if (!caseRecord || caseRecord.crisisState === "DECEASED") return;
  if (caseRecord.diseaseLinks.length === 0) return;

  const clockNow = getCaseClockNow(caseRecord);
  const lastVital = await db.vital.findFirst({ where: { caseId }, orderBy: { recordedAt: "desc" } });
  const anchor = lastVital?.recordedAt ?? caseRecord.createdAt;

  const treatmentOrders = await loadTreatmentOrders(caseId);
  const drugEffectRules = await loadDrugEffectRules();
  const { base: basePhysiology, reference: referenceBase } = await loadPhysiologyBaseline(caseRecord.patientAge, caseRecord.patientGender);

  const points: Date[] = [];
  // 症例の初回閲覧時（＝まだ1件もバイタルが記録されていない）は、記録間隔を待たず、
  // 症例開始時点の初期バイタルを必ず記録する。これが無いと、症例作成直後に開いた学生には
  // 次の間隔が経過するまでバイタルが1件も表示されない。
  if (!lastVital) points.push(anchor);

  const intervalHours =
    caseRecord.crisisState === "CRITICAL"
      ? CRITICAL_SNAPSHOT_INTERVAL_HOURS
      : (findActiveVitalsIntervalHours(treatmentOrders, clockNow) ?? DEFAULT_SNAPSHOT_INTERVAL_HOURS);
  const intervalMs = intervalHours * 3_600_000;
  const totalMs = clockNow.getTime() - anchor.getTime();
  // 前回記録から丸1間隔分の時間が経っていれば、通常の定期記録も追加する。
  // 間隔判定自体を省略しないのは、タブ切り替えなどページを開くたびに reconcile が走り、
  // ほぼ同時刻の記録が何件も量産されてしまう（実際に起きていたバグ）のを防ぐため。
  if (totalMs >= intervalMs) {
    // 通常は固定間隔で記録するが、間隔が長く空きすぎた場合は上限件数に収まるよう間隔を引き伸ばす
    const rawSteps = Math.floor(totalMs / intervalMs);
    const steps = Math.min(rawSteps, MAX_SNAPSHOTS_PER_RECONCILE);
    const stepMs = rawSteps > MAX_SNAPSHOTS_PER_RECONCILE ? totalMs / MAX_SNAPSHOTS_PER_RECONCILE : intervalMs;
    for (let i = 1; i <= steps; i++) {
      points.push(new Date(anchor.getTime() + stepMs * i));
    }
  }

  if (points.length === 0) return;

  // 危機病態(CRITICAL中の主病態)も普通の疾患としてperSeverity寄与を持つため、STABLE/CRITICALを
  // 区別せず常に全疾患を集約する。危機発生中の荒れたバイタルは危機病態自身の重症度・perSeverityから
  // 自然に生じる（固定値による上書きは廃止）。
  for (const at of points) {
    const contributions = await loadDiseaseContributionsAt(caseRecord.diseaseLinks, treatmentOrders, at);
    if (contributions.length === 0) continue;
    const oxygenBoost = findActiveOxygenBoost(treatmentOrders, at);
    const { vitalShifts } = computeDrugEffectsAt(treatmentOrders, drugEffectRules, at);
    const vitals = aggregateVitals(basePhysiology, referenceBase, contributions, oxygenBoost, vitalShifts);
    await db.vital.create({ data: { caseId, recordedAt: at, ...vitals } });
  }
}

// 症例の全疾患の現時点の寄与＋集約後バイタルと、labトリガーが参照する検査値を同期的に引けるresolverを
// まとめて用意する（reconcileCaseCrisisのSTABLE判定・CRITICAL判定の両方で使う）。
async function buildCrisisEvaluationContext(
  diseaseLinks: LinkWithTemplate[],
  treatmentOrders: TreatmentOrderWithDrug[],
  drugEffectRules: DrugEffectRule[],
  atTime: Date,
  labCodesNeeded: Set<string>,
  patientAge: number,
  patientGender: string
): Promise<{
  contributions: (DiseaseContribution & { link: LinkWithTemplate })[];
  aggregatedVitals: VitalPoint;
  resolveAggregatedLabValue: (code: string, label?: string) => number | null;
}> {
  const contributions = await loadDiseaseContributionsAt(diseaseLinks, treatmentOrders, atTime);
  const { base: basePhysiology, reference: referenceBase } = await loadPhysiologyBaseline(patientAge, patientGender);
  const oxygenBoost = findActiveOxygenBoost(treatmentOrders, atTime);
  const drugEffects = computeDrugEffectsAt(treatmentOrders, drugEffectRules, atTime);
  const aggregatedVitals = aggregateVitals(basePhysiology, referenceBase, contributions, oxygenBoost, drugEffects.vitalShifts);

  const labItems =
    labCodesNeeded.size > 0 ? await db.labItemMaster.findMany({ where: { code: { in: Array.from(labCodesNeeded) } } }) : [];
  const labItemByCode = new Map(labItems.map((l) => [l.code, l]));
  const resolveAggregatedLabValue = (code: string, label?: string): number | null => {
    const labItem = labItemByCode.get(code);
    if (!labItem) return null;
    const dynamic = aggregateLabResult(code, contributions, parseLabValues(labItem.sampleValues));
    const withDrugEffect = dynamic ? applyDrugLabEffect(dynamic, drugEffects.labShifts[code] ?? 0, []) : null;
    const entry = label ? withDrugEffect?.values?.find((v) => v.label === label) : withDrugEffect?.values?.[0];
    return typeof entry?.value === "number" ? entry.value : null;
  };

  return { contributions, aggregatedVitals, resolveAggregatedLabValue };
}

// 危機シナリオ（急変・死亡モデル）の状態遷移を判定する。危機シナリオも「病態モデルの1つ」として扱う:
// 症例に複数疾患がアタッチされていても、発火条件は「主病態」（isPrimaryのCaseDiseaseLink）が持つ
// 発火条件(crisisTriggers、条件による複数分岐が持てる)だけを見る。
// STABLE: 各分岐の発動条件を、生理モデルが集約した後のバイタル・検査値・主病態自身の重症度で判定する。
//   分岐ごとにCaseCrisisTriggerProgressで持続時間を追跡し、sustainMinutes分だけ連続して満たした
//   最初の分岐が発火する。発火すると、その分岐のtargetTemplateを新規CaseDiseaseLinkとしてアタッチし
//   （疾患自身の初期値はtargetTemplate.defaultParamsから）、他の全リンクのisPrimaryをfalseにしてこの
//   危機病態を主病態に昇格させ、CRITICALへ遷移する（決定事項: 危機病態は以後の主病態であり続ける）。
// CRITICAL: 主病態（＝危機病態）自身のcrisisRescueを見る。crisisStartedAt以降に救命オーダーがあれば
//   STABLEへ復帰（危機病態の重症度カーブの起点をこの時刻にリセットし、postRescueSeverityから再開）。
//   救命されなければ、危機病態自身の現在の重症度を計算し、100に達し crisisMode=LETHAL ならDECEASEDへ
//   （症例凍結）。REVERSIBLEなら重症度が上限に張り付いても死亡させずCRITICALのまま留まる。
export async function reconcileCaseCrisis(caseId: string): Promise<void> {
  const caseRecord = await loadCaseForEngine(caseId);
  if (!caseRecord || caseRecord.crisisState === "DECEASED" || caseRecord.crisisMode === "OFF") return;

  const primaryLink = findPrimaryDiseaseLink(caseRecord.diseaseLinks);
  if (!primaryLink) return;
  const primaryConfig = await loadTemplateConfig(primaryLink.template.key);
  if (!primaryConfig) return;

  const clockNow = getCaseClockNow(caseRecord);
  const treatmentOrders = await loadTreatmentOrders(caseId);
  const drugEffectRules = await loadDrugEffectRules();

  if (caseRecord.crisisState === "STABLE") {
    const scenarios = primaryConfig.crisisTriggers;
    if (scenarios.length === 0) return;

    const labCodesNeeded = new Set<string>();
    for (const s of scenarios) for (const t of s.triggers) if (t.type === "lab") labCodesNeeded.add(t.code);
    const { contributions, aggregatedVitals, resolveAggregatedLabValue } = await buildCrisisEvaluationContext(
      caseRecord.diseaseLinks,
      treatmentOrders,
      drugEffectRules,
      clockNow,
      labCodesNeeded,
      caseRecord.patientAge,
      caseRecord.patientGender
    );
    const primaryContribution = contributions.find((c) => c.link.id === primaryLink.id);
    if (!primaryContribution) return; // 主病態がエンジン非対応（vitalsConfig等未設定）なら判定不可

    const progressRows = await db.caseCrisisTriggerProgress.findMany({
      where: { caseId, scenarioId: { in: scenarios.map((s) => s.id) } },
    });
    const progressByScenario = new Map(progressRows.map((p) => [p.scenarioId, p]));

    for (const scenario of scenarios) {
      const conditionHolds = evaluateCrisisTriggers(scenario, primaryContribution.severity, aggregatedVitals, resolveAggregatedLabValue);
      const progress = progressByScenario.get(scenario.id);

      if (!conditionHolds) {
        // 学生のカルテ表示と教員ダッシュボードの同時アクセス等でreconcileが競合しうるため、
        // 「無ければ何もしない」deleteManyにして、既に他方が削除済みでもP2025で落ちないようにする。
        if (progress) await db.caseCrisisTriggerProgress.deleteMany({ where: { caseId, scenarioId: scenario.id } });
        continue;
      }
      if (!progress) {
        // 同様に、他方が既に作成済みならupsertが上書きするだけで済むようにする（read-check-then-createは
        // @@unique([caseId, scenarioId])に対する競合でP2002になりうる）。
        await db.caseCrisisTriggerProgress.upsert({
          where: { caseId_scenarioId: { caseId, scenarioId: scenario.id } },
          update: {},
          create: { caseId, scenarioId: scenario.id, conditionSince: clockNow },
        });
        continue;
      }
      const sustainedMinutes = (clockNow.getTime() - progress.conditionSince.getTime()) / 60_000;
      if (sustainedMinutes < scenario.sustainMinutes) continue;

      // 発火: targetTemplateを危機病態としてアタッチし、主病態に昇格させる
      const targetTemplate = await db.diseaseTemplate.findUnique({ where: { key: scenario.targetTemplateKey } });
      if (!targetTemplate) continue; // 設定不備（テンプレート削除済み等）。この分岐はスキップし他の分岐を確認
      const targetParams = parsePhysiologyParams(targetTemplate.defaultParams);
      const maxSort = await db.caseDiseaseLink.aggregate({ where: { caseId }, _max: { sortOrder: true } });

      // 4段階の状態遷移を1トランザクションにまとめる。非トランザクションのままだと、
      // 途中で失敗した場合に「主病態がゼロ件の症例」（updateManyだけ成功）や、
      // 「crisisStateはCRITICALなのに新しい病態リンクが無い」といった不整合な中間状態が残ってしまう。
      await db.$transaction(async (tx) => {
        await tx.caseDiseaseLink.updateMany({ where: { caseId }, data: { isPrimary: false } });
        await tx.caseDiseaseLink.upsert({
          where: { caseId_templateId: { caseId, templateId: targetTemplate.id } },
          update: {
            isPrimary: true,
            severityBaselineAt: clockNow,
            physiologyParams: JSON.stringify(targetParams),
            aiSeverityRatePerHour: null,
          },
          create: {
            caseId,
            templateId: targetTemplate.id,
            isPrimary: true,
            physiologyParams: JSON.stringify(targetParams),
            severityBaselineAt: clockNow,
            sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
          },
        });
        await tx.case.update({ where: { id: caseId }, data: { crisisState: "CRITICAL", crisisStartedAt: clockNow } });
        await tx.caseCrisisTriggerProgress.deleteMany({ where: { caseId } });
      });
      await logAudit({
        userId: null,
        action: "crisis_onset",
        targetType: "Case",
        targetId: caseId,
        detail: { targetTemplateKey: targetTemplate.key, targetTemplateName: targetTemplate.name },
      });
      await notifyAssignedStudents(caseId, `【急変】${targetTemplate.name}を疑う状態です。直ちに対応してください。`);
      return;
    }
    return;
  }

  // CRITICAL: 主病態(=危機病態)自身の救命設定を見る
  const rescue = primaryConfig.crisisRescue;
  const crisisStartedAt = caseRecord.crisisStartedAt ?? clockNow;

  if (rescue) {
    const rescuedAt = findCrisisRescueAt(treatmentOrders, rescue, crisisStartedAt);
    if (rescuedAt) {
      const params = parsePhysiologyParams(primaryLink.physiologyParams);
      // 「安定化したのにcrisisStateだけ変わって重症度カーブは危機のまま」という中間状態を避けるため
      // 1トランザクションにまとめる（急変発生時と同じ理由）。
      await db.$transaction(async (tx) => {
        await tx.case.update({ where: { id: caseId }, data: { crisisState: "STABLE", crisisStartedAt: null } });
        await tx.caseDiseaseLink.update({
          where: { id: primaryLink.id },
          data: {
            severityBaselineAt: clockNow,
            physiologyParams: JSON.stringify({ ...params, severitySlider: rescue.postRescueSeverity }),
          },
        });
      });
      await logAudit({ userId: null, action: "crisis_rescue", targetType: "Case", targetId: caseId });
      await notifyAssignedStudents(caseId, "救命処置が奏功し、状態は安定化しました。");
      return;
    }
  }

  if (caseRecord.crisisMode === "LETHAL") {
    const severity = computeCaseSeverityAtTime(primaryLink, treatmentOrders, primaryConfig, clockNow);
    if (severity !== null && severity >= 100) {
      await db.case.update({ where: { id: caseId }, data: { crisisState: "DECEASED" } });
      await logAudit({ userId: null, action: "case_deceased", targetType: "Case", targetId: caseId });
      await notifyAssignedStudents(caseId, "【死亡確認】救命処置が間に合わず、患者は死亡しました。");
    }
  }
}

// 症例の主病態（危機発生中は危機病態）について、現在時刻における重症度を計算する。
// CrisisBannerの表示用（現在の重症度/100を目安として提示する）。
export async function getCurrentPrimarySeverity(caseId: string): Promise<number | null> {
  const caseRecord = await loadCaseForEngine(caseId);
  if (!caseRecord) return null;
  const primaryLink = findPrimaryDiseaseLink(caseRecord.diseaseLinks);
  if (!primaryLink) return null;
  const config = await loadTemplateConfig(primaryLink.template.key);
  if (!config) return null;
  const treatmentOrders = await loadTreatmentOrders(caseId);
  const clockNow = getCaseClockNow(caseRecord);
  return computeCaseSeverityAtTime(primaryLink, treatmentOrders, config, clockNow);
}

// 症例の全病態（主病態以外も含む）について、現在時刻における重症度を計算する。
// 教員・管理者向けの病態管理UI（重症度の一覧表示）用。
export async function getDiseaseLinkSeverities(caseId: string): Promise<Map<string, number | null>> {
  const caseRecord = await loadCaseForEngine(caseId);
  if (!caseRecord) return new Map();
  const treatmentOrders = await loadTreatmentOrders(caseId);
  const clockNow = getCaseClockNow(caseRecord);
  const contributions = await loadDiseaseContributionsAt(caseRecord.diseaseLinks, treatmentOrders, clockNow);
  const severities = new Map<string, number | null>(caseRecord.diseaseLinks.map((l) => [l.id, null]));
  for (const c of contributions) severities.set(c.link.id, c.severity);
  return severities;
}

async function notifyAssignedStudents(caseId: string, message: string): Promise<void> {
  const assignments = await db.caseAssignment.findMany({
    where: { caseId, dischargedAt: null },
    select: { studentId: true },
  });
  if (assignments.length === 0) return;
  await db.notification.createMany({ data: assignments.map((a) => ({ userId: a.studentId, caseId, message })) });
}

export async function reconcileCase(caseId: string): Promise<void> {
  await reconcileExpiredPrescriptions(caseId);
  await reconcileCaseResults(caseId);
  await reconcileCaseCrisis(caseId);
  await reconcileCaseVitals(caseId);
}

export async function reconcileCasesForStudent(studentId: string): Promise<void> {
  const assignments = await db.caseAssignment.findMany({
    where: { studentId, dischargedAt: null },
    select: { caseId: true },
  });
  for (const { caseId } of assignments) {
    await reconcileCase(caseId);
  }
}

// ── AI治療評価（治療内容をGeminiに評価させ、時間あたりの重症度変化量として重症度カーブへ反映する） ──
// 症例に複数疾患がアタッチされていても、AI治療評価は「主病態」（isPrimaryのCaseDiseaseLink）のみを
// 対象にする。評価のたびに重症度を直接ジャンプさせるのではなく、次の評価まで持続する「変化率」
// （CaseDiseaseLink.aiSeverityRatePerHour）を設定する。無害なオーダーが何度混ざって評価が再発火しても、
// 同じ変化率が再アンカーされるだけなので二重に改善/悪化が計上されない（詳細は物理エンジン側の
// computeAiSeverityRatePerHourコメント参照）。禁忌等の重大な問題（contraindicated）は別枠で、
// その場で一気に重症度をジャンプさせる（applyContraindicationJump）。

const TREATMENT_EVALUATION_ORDER_TYPES: OrderType[] = ["MEDICATION", "INJECTION", "PROCEDURE", "GENERAL"];

function hashOrderIds(orderIds: string[]): string {
  return createHash("sha256").update(orderIds.slice().sort().join(",")).digest("hex");
}

// オーダー提出直後（治療系オーダーを含む提出のときのみ）に呼ぶ。ガード条件（急変状態でない・
// 主病態にルーブリック設定済み・エンジン対応）を満たし、かつ現在の治療系オーダー集合が
// 過去に評価済み(PENDING/COMPLETED)の集合と異なる場合のみPENDING行を作成してそのIDを返す。
// 実際のAI呼び出しはここでは行わない（呼び出し元がNext.jsのafter()でprocessTreatmentEvaluationを呼ぶ）。
export async function createPendingTreatmentEvaluationIfNeeded(caseId: string): Promise<string | null> {
  const caseRecord = await loadCaseForEngine(caseId);
  if (!caseRecord || caseRecord.crisisState !== "STABLE") return null;

  const primaryLink = findPrimaryDiseaseLink(caseRecord.diseaseLinks);
  const template = primaryLink?.template;
  const guideline = template?.aiEvaluationGuideline?.trim();
  if (!primaryLink || !template || !guideline) return null;

  const config = await loadTemplateConfig(template.key);
  if (!config) return null;

  const orders = await db.order.findMany({
    where: { caseId, orderType: { in: TREATMENT_EVALUATION_ORDER_TYPES } },
    select: { id: true },
  });
  if (orders.length === 0) return null;

  const orderIds = orders.map((o) => o.id);
  const ordersSnapshotHash = hashOrderIds(orderIds);

  const existing = await db.treatmentEvaluation.findFirst({
    where: { caseId, ordersSnapshotHash, status: { in: ["PENDING", "COMPLETED"] } },
    select: { id: true },
  });
  if (existing) return null;

  const created = await db.treatmentEvaluation.create({
    data: { caseId, ordersSnapshotHash, orderIdsSnapshot: JSON.stringify(orderIds) },
  });
  return created.id;
}

// createPendingTreatmentEvaluationIfNeededが作成したPENDING行を実際に処理する。Next.jsのafter()経由で
// レスポンス返却後にバックグラウンド実行される想定。AI呼び出し・応答パースに失敗した場合は症例の状態を
// 一切変更せずFAILEDとして記録するだけに留める（フェイルセーフ）。
export async function processTreatmentEvaluation(evaluationId: string): Promise<void> {
  const evaluation = await db.treatmentEvaluation.findUnique({ where: { id: evaluationId } });
  if (!evaluation || evaluation.status !== "PENDING") return;

  const caseRecord = await loadCaseForEngine(evaluation.caseId);
  const primaryLink = caseRecord ? findPrimaryDiseaseLink(caseRecord.diseaseLinks) : null;
  const template = primaryLink?.template;
  const guideline = template?.aiEvaluationGuideline?.trim();
  if (!caseRecord || caseRecord.crisisState !== "STABLE" || !primaryLink || !template || !guideline) {
    await db.treatmentEvaluation.update({
      where: { id: evaluationId },
      data: {
        status: "FAILED",
        errorMessage: "評価開始前に前提条件（急変未発生・主病態のルーブリック設定）が崩れたため中止しました。",
        completedAt: new Date(),
      },
    });
    return;
  }

  try {
    const orderIds = JSON.parse(evaluation.orderIdsSnapshot) as string[];
    const [orders, problems, latestVital, targetedTherapy] = await Promise.all([
      db.order.findMany({
        where: { id: { in: orderIds } },
        select: { orderType: true, label: true, detail: true, orderedAt: true },
      }),
      db.problem.findMany({ where: { caseId: evaluation.caseId }, select: { label: true, isPrimary: true } }),
      db.vital.findFirst({ where: { caseId: evaluation.caseId }, orderBy: { recordedAt: "desc" } }),
      loadTargetedTherapyContext(caseRecord),
    ]);

    const result = await evaluateTreatment({
      caseRecord,
      templateName: template.name,
      templateDescription: template.description,
      guideline,
      problems,
      orders,
      latestVital,
      targetedTherapy,
    });

    // AI呼び出し中（数秒〜）に状態が変わっていないか（危機発生・死亡）再確認してから重症度へ反映する
    const freshCase = await loadCaseForEngine(evaluation.caseId);
    const freshPrimaryLink = freshCase ? findPrimaryDiseaseLink(freshCase.diseaseLinks) : null;
    let resetSeverity: number | null = null;
    const severityRatePerHour = computeAiSeverityRatePerHour(result.appropriatenessScore);
    if (freshCase && freshCase.crisisState === "STABLE" && freshPrimaryLink) {
      const clockNow = getCaseClockNow(freshCase);
      const config = await loadTemplateConfig(template.key);
      const treatmentOrders = await loadTreatmentOrders(evaluation.caseId);
      const currentSeverity = computeCaseSeverityAtTime(freshPrimaryLink, treatmentOrders, config, clockNow);
      if (currentSeverity !== null) {
        // 禁忌等が検知された場合のみ、その場で一気に重症度をジャンプさせる。それ以外は現在値をそのまま
        // 引き継ぐ（ジャンプなし）— 以降はseverityRatePerHourによる連続的な変化に委ねる。
        resetSeverity = result.contraindicated ? applyContraindicationJump(currentSeverity) : Math.round(currentSeverity);
        const params = parsePhysiologyParams(freshPrimaryLink.physiologyParams);
        await db.caseDiseaseLink.update({
          where: { id: freshPrimaryLink.id },
          data: {
            severityBaselineAt: clockNow,
            aiSeverityRatePerHour: severityRatePerHour,
            physiologyParams: JSON.stringify({ ...params, severitySlider: resetSeverity }),
          },
        });
      }
    }

    await db.treatmentEvaluation.update({
      where: { id: evaluationId },
      data: {
        status: "COMPLETED",
        appropriatenessScore: result.appropriatenessScore,
        contraindicated: result.contraindicated,
        severityRatePerHour: resetSeverity !== null ? severityRatePerHour : null,
        resetSeverity,
        rationale: result.rationale,
        rawResponse: result.rawResponse,
        completedAt: new Date(),
      },
    });

    // resetSeverityがnull＝評価中に危機へ遷移していた等で重症度へは未反映。監査記録のみ残し、学生への
    // 「反映しました」通知は送らない（現況と矛盾するメッセージになるため）。
    if (resetSeverity !== null) {
      const prefix = result.contraindicated ? "【AI治療評価・重大な懸念】" : "【AI治療評価】";
      await notifyAssignedStudents(
        evaluation.caseId,
        `${prefix}適切性スコア ${result.appropriatenessScore}/100。${result.rationale}`
      );
    }
  } catch (err) {
    console.error(`[ai-treatment-evaluation] caseId=${evaluation.caseId} evaluationId=${evaluationId}`, err);
    await db.treatmentEvaluation.update({
      where: { id: evaluationId },
      data: { status: "FAILED", errorMessage: err instanceof Error ? err.message : String(err), completedAt: new Date() },
    });
  }
}
