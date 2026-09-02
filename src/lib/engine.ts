import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import type { Case, DiseaseTemplate, LabItemMaster, OrderType } from "@prisma/client";
import {
  applyContraindicationJump,
  computeAiSeverityRatePerHour,
  computeCaseSeverityAtTime,
  computeVitalsForSeverity,
  evaluateCrisisTriggers,
  findActiveOxygenBoost,
  findCrisisRescueAt,
  getCaseClockNow,
  parsePhysiologyParams,
  resolveDynamicLab,
  type CrisisScenario,
  type CrisisTrigger,
  type PatternSet,
  type SeverityTier,
  type TemplateConfig,
  type TreatmentTrigger,
  type VitalPoint,
} from "@/lib/physiology-engine";
import { formatLabValues, type LabValue } from "@/lib/lab-reference-ranges";
import { evaluateTreatment } from "@/lib/ai-treatment-evaluation";

// DiseaseTemplateとその関連テーブル（TemplateLabPattern/TemplateCrisisScenario等）から、
// physiology-engine.tsの純粋な計算関数が期待するTemplateConfig形へ組み立てる。
// vitalsConfig/treatmentConfigが未設定のテンプレート（管理画面でまだ入力していない）はnullを返す
// （エンジン非対応。従来の重症度カーブ・急変判定は一切走らない）。
export async function loadTemplateConfig(templateKey: string | null | undefined): Promise<TemplateConfig | null> {
  if (!templateKey) return null;
  const template = await db.diseaseTemplate.findUnique({
    where: { key: templateKey },
    include: {
      labPatterns: { include: { values: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } },
      crisis: {
        include: {
          triggers: { orderBy: { sortOrder: "asc" } },
          rescueActions: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });
  if (!template || !template.vitalsConfig || !template.treatmentConfig) return null;

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

  let crisis: CrisisScenario | null = null;
  if (template.crisis) {
    const triggers: CrisisTrigger[] = template.crisis.triggers.map((t) => {
      if (t.type === "severity") return { type: "severity", op: t.op as ">=" | "<=", value: t.value };
      if (t.type === "vital") return { type: "vital", field: t.field as keyof VitalPoint, op: t.op as ">=" | "<=", value: t.value };
      return { type: "lab", code: t.code ?? "", label: t.label ?? undefined, op: t.op as ">=" | "<=", value: t.value };
    });
    crisis = {
      name: template.crisis.name,
      triggers,
      windowMinutes: template.crisis.windowMinutes,
      rescueActions: template.crisis.rescueActions.map((r) => ({
        label: r.label,
        drugCategories: JSON.parse(r.drugCategories) as string[],
        procedureKeywords: JSON.parse(r.procedureKeywords) as string[],
      })),
      crisisVitals: JSON.parse(template.crisis.crisisVitals) as VitalPoint,
      postRescueSeverity: template.crisis.postRescueSeverity,
    };
  }

  return {
    treatment: JSON.parse(template.treatmentConfig) as TreatmentTrigger,
    vitals: JSON.parse(template.vitalsConfig) as TemplateConfig["vitals"],
    labPatterns,
    crisis,
  };
}

// この検査項目コードが、いずれかの病態テンプレートの動的所見パターンで使われているか
export async function loadEngineLinkedLabCodes(): Promise<Set<string>> {
  const rows = await db.templateLabPattern.findMany({ select: { labItemCode: true }, distinct: ["labItemCode"] });
  return new Set(rows.map((r) => r.labItemCode));
}

const DEFAULT_RESULT_TEXT = "結果は基準範囲内です。";
const DELAYED_RESULT_DELAY_MS = 2 * 3_600_000; // 遅延型オーダーの結果反映までの固定遅延（簡易実装。症例の時計＝実時間 or シミュレーション時間で解釈）
const SNAPSHOT_INTERVAL_HOURS = 4; // バイタルの自動記録間隔（実時間 or シミュレーション時間）
const MAX_SNAPSHOTS_PER_RECONCILE = 12; // 一度に生成するバイタル記録の上限（時間を大きく進めた場合の暴走防止）

type CaseForEngine = Pick<
  Case,
  | "id"
  | "title"
  | "patientName"
  | "patientAge"
  | "patientGender"
  | "createdAt"
  | "physiologyParams"
  | "timeProgressMode"
  | "simNowAt"
  | "severityBaselineAt"
  | "aiSeverityRatePerHour"
  | "crisisMode"
  | "crisisState"
  | "crisisStartedAt"
> & {
  diseaseTemplate: DiseaseTemplate | null;
};

type TreatmentOrderWithDrug = {
  orderedAt: Date;
  orderType: OrderType;
  label: string;
  detail: string | null;
  drug: { categoryLinks: { category: { majorCategory: string } }[] } | null;
};

export function computeResultReadyAt(resultTiming: "IMMEDIATE" | "DELAYED", now = new Date()): Date {
  if (resultTiming === "IMMEDIATE") return now;
  return new Date(now.getTime() + DELAYED_RESULT_DELAY_MS);
}

export type LabResult = { text: string; values: LabValue[] | null };

// 病態テンプレートに紐づく検査項目なら、その時点の重症度に応じた所見を返す。
// テンプレート対象外の項目やテンプレート未設定の症例では、マスターの固定値/固定文にフォールバックする。
// crisisState が STABLE でない（危機シナリオ発生中・死亡後）症例は、通常の重症度カーブでなく
// 常にsevere階層の所見を返す（危機専用の所見までは作り込まず、既存のsevere値を流用する）。
export function resolveLabResult(
  caseRecord: Pick<Case, "physiologyParams" | "severityBaselineAt" | "aiSeverityRatePerHour" | "crisisState">,
  treatmentOrders: TreatmentOrderWithDrug[],
  config: TemplateConfig | null,
  labItem: Pick<LabItemMaster, "code" | "sampleResult" | "sampleValues"> | null,
  atTime: Date
): LabResult {
  if (labItem) {
    const severity =
      caseRecord.crisisState === "STABLE"
        ? computeCaseSeverityAtTime(caseRecord, treatmentOrders, config, atTime)
        : 100;
    if (severity !== null) {
      const dynamic = resolveDynamicLab(config, labItem.code, severity);
      if (dynamic) return dynamic;
    }
    if (labItem.sampleValues) {
      try {
        const values = JSON.parse(labItem.sampleValues) as LabValue[];
        return { text: formatLabValues(values), values };
      } catch {
        // 不正なJSONは無視してテキストにフォールバック
      }
    }
    if (labItem.sampleResult) return { text: labItem.sampleResult, values: null };
  }
  return { text: DEFAULT_RESULT_TEXT, values: null };
}

async function loadCaseForEngine(caseId: string): Promise<CaseForEngine | null> {
  return db.case.findUnique({ where: { id: caseId }, include: { diseaseTemplate: true } });
}

// MEDICATION/INJECTION（薬剤治療判定）・PROCEDURE（処置・手術治療判定）・GENERAL（酸素投与のSpO2上乗せ判定）
// をまとめて取得する。判定に使わないオーダー種別（LAB/IMAGING）は含めない。
async function loadTreatmentOrders(caseId: string): Promise<TreatmentOrderWithDrug[]> {
  return db.order.findMany({
    where: { caseId, orderType: { in: ["MEDICATION", "INJECTION", "PROCEDURE", "GENERAL"] } },
    select: {
      orderedAt: true,
      orderType: true,
      label: true,
      detail: true,
      drug: { select: { categoryLinks: { select: { category: { select: { majorCategory: true } } } } } },
    },
  });
}

// 遅延型オーダーのうち反映時刻を過ぎたものを「結果あり」に更新し、通知を発行する。
// 「反映時刻を過ぎたか」は症例の時計（REALTIME=実時間 / MANUAL=シミュレーション時間）で判定する。
export async function reconcileCaseResults(caseId: string): Promise<void> {
  const caseRecord = await loadCaseForEngine(caseId);
  if (!caseRecord || caseRecord.crisisState === "DECEASED") return;
  const clockNow = getCaseClockNow(caseRecord);

  const due = await db.order.findMany({
    where: { caseId, status: "RESULT_PENDING", resultReadyAt: { lte: clockNow } },
    include: { labItem: true },
  });
  if (due.length === 0) return;

  const treatmentOrders = await loadTreatmentOrders(caseId);
  const config = await loadTemplateConfig(caseRecord.diseaseTemplate?.key);

  for (const order of due) {
    const result = resolveLabResult(caseRecord, treatmentOrders, config, order.labItem, order.resultReadyAt ?? new Date());
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
  }
}

// 病態テンプレートを持つ症例について、前回記録から現在時刻（実時間 or シミュレーション時間）までの
// バイタルを一定間隔で自動生成する。テンプレート未設定の症例は対象外（従来どおり静的なデータのまま）。
export async function reconcileCaseVitals(caseId: string): Promise<void> {
  const caseRecord = await loadCaseForEngine(caseId);
  if (!caseRecord || caseRecord.crisisState === "DECEASED") return;
  const config = await loadTemplateConfig(caseRecord.diseaseTemplate?.key);
  if (!config) return;

  const clockNow = getCaseClockNow(caseRecord);
  const lastVital = await db.vital.findFirst({ where: { caseId }, orderBy: { recordedAt: "desc" } });
  const anchor = lastVital?.recordedAt ?? caseRecord.createdAt;

  const intervalMs = SNAPSHOT_INTERVAL_HOURS * 3_600_000;
  const totalMs = clockNow.getTime() - anchor.getTime();
  // 前回記録から丸1間隔分の時間が経っていなければ何もしない。
  // これがないと、タブ切り替えなどページを開くたびに reconcile が走り、
  // ほぼ同時刻の記録が何件も量産されてしまう（実際に起きていたバグ）。
  if (totalMs < intervalMs) return;

  // 通常は固定間隔で記録するが、間隔が長く空きすぎた場合は上限件数に収まるよう間隔を引き伸ばす
  const rawSteps = Math.floor(totalMs / intervalMs);
  const steps = Math.min(rawSteps, MAX_SNAPSHOTS_PER_RECONCILE);
  const stepMs = rawSteps > MAX_SNAPSHOTS_PER_RECONCILE ? totalMs / MAX_SNAPSHOTS_PER_RECONCILE : intervalMs;

  const points: Date[] = [];
  for (let i = 1; i <= steps; i++) {
    points.push(new Date(anchor.getTime() + stepMs * i));
  }

  const treatmentOrders = await loadTreatmentOrders(caseId);

  // 危機シナリオ発生中（CRITICAL）は通常の重症度カーブでなく、シナリオ固定の危機バイタルを記録する。
  for (const at of points) {
    const vitals =
      caseRecord.crisisState === "CRITICAL"
        ? (config.crisis?.crisisVitals ?? null)
        : (() => {
            const severity = computeCaseSeverityAtTime(caseRecord, treatmentOrders, config, at);
            if (severity === null) return null;
            const oxygenBoost = findActiveOxygenBoost(treatmentOrders, at);
            return computeVitalsForSeverity(config, severity, oxygenBoost);
          })();
    if (!vitals) continue;
    await db.vital.create({ data: { caseId, recordedAt: at, ...vitals } });
  }
}

// 危機シナリオ（急変・死亡モデル）の状態遷移を判定する。
// STABLE: 発動条件（テンプレートごとのcrisis.triggers）を満たせばCRITICALへ遷移し、対象学生へ通知する。
// CRITICAL: crisisStartedAt以降に救命オーダー（crisis.rescueActions）があればSTABLEへ復帰
//   （重症度カーブの起点をこの時刻にリセットし、postRescueSeverityから再開する）。
//   なければwindowMinutes経過を確認し、crisisMode=LETHALならDECEASEDへ（症例凍結）、
//   REVERSIBLEなら猶予切れでも死亡させずCRITICALのまま留まる（いつでも救命オーダーで脱出可能）。
export async function reconcileCaseCrisis(caseId: string): Promise<void> {
  const caseRecord = await loadCaseForEngine(caseId);
  if (!caseRecord || caseRecord.crisisState === "DECEASED" || caseRecord.crisisMode === "OFF") return;

  const config = await loadTemplateConfig(caseRecord.diseaseTemplate?.key);
  const crisis = config?.crisis;
  if (!crisis) return;

  const clockNow = getCaseClockNow(caseRecord);
  const treatmentOrders = await loadTreatmentOrders(caseId);

  if (caseRecord.crisisState === "STABLE") {
    const severity = computeCaseSeverityAtTime(caseRecord, treatmentOrders, config, clockNow);
    if (severity === null) return;
    const oxygenBoost = findActiveOxygenBoost(treatmentOrders, clockNow);
    if (!evaluateCrisisTriggers(config, severity, oxygenBoost)) return;

    await db.case.update({ where: { id: caseId }, data: { crisisState: "CRITICAL", crisisStartedAt: clockNow } });
    await notifyAssignedStudents(caseId, `【急変】${crisis.name}を疑う状態です。直ちに対応してください。`);
    return;
  }

  // CRITICAL
  const crisisStartedAt = caseRecord.crisisStartedAt ?? clockNow;
  const rescuedAt = findCrisisRescueAt(treatmentOrders, crisis, crisisStartedAt);
  if (rescuedAt) {
    const params = parsePhysiologyParams(caseRecord.physiologyParams);
    await db.case.update({
      where: { id: caseId },
      data: {
        crisisState: "STABLE",
        crisisStartedAt: null,
        severityBaselineAt: clockNow,
        physiologyParams: JSON.stringify({ ...params, severitySlider: crisis.postRescueSeverity }),
      },
    });
    await notifyAssignedStudents(caseId, "救命処置が奏功し、状態は安定化しました。");
    return;
  }

  const elapsedMinutes = (clockNow.getTime() - crisisStartedAt.getTime()) / 60_000;
  if (elapsedMinutes >= crisis.windowMinutes && caseRecord.crisisMode === "LETHAL") {
    await db.case.update({ where: { id: caseId }, data: { crisisState: "DECEASED" } });
    await notifyAssignedStudents(caseId, "【死亡確認】救命処置が間に合わず、患者は死亡しました。");
  }
}

async function notifyAssignedStudents(caseId: string, message: string): Promise<void> {
  const assignments = await db.caseAssignment.findMany({ where: { caseId }, select: { studentId: true } });
  if (assignments.length === 0) return;
  await db.notification.createMany({ data: assignments.map((a) => ({ userId: a.studentId, caseId, message })) });
}

export async function reconcileCase(caseId: string): Promise<void> {
  await reconcileCaseResults(caseId);
  await reconcileCaseCrisis(caseId);
  await reconcileCaseVitals(caseId);
}

export async function reconcileCasesForStudent(studentId: string): Promise<void> {
  const assignments = await db.caseAssignment.findMany({
    where: { studentId },
    select: { caseId: true },
  });
  for (const { caseId } of assignments) {
    await reconcileCase(caseId);
  }
}

// ── AI治療評価（治療内容をGeminiに評価させ、時間あたりの重症度変化量として重症度カーブへ反映する） ──
// 評価のたびに重症度を直接ジャンプさせるのではなく、次の評価まで持続する「変化率」
// （Case.aiSeverityRatePerHour）を設定する。無害なオーダーが何度混ざって評価が再発火しても、
// 同じ変化率が再アンカーされるだけなので二重に改善/悪化が計上されない（詳細は物理エンジン側の
// computeAiSeverityRatePerHourコメント参照）。禁忌等の重大な問題（contraindicated）は別枠で、
// その場で一気に重症度をジャンプさせる（applyContraindicationJump）。

const TREATMENT_EVALUATION_ORDER_TYPES: OrderType[] = ["MEDICATION", "INJECTION", "PROCEDURE", "GENERAL"];

function hashOrderIds(orderIds: string[]): string {
  return createHash("sha256").update(orderIds.slice().sort().join(",")).digest("hex");
}

// オーダー提出直後（治療系オーダーを含む提出のときのみ）に呼ぶ。ガード条件（急変状態でない・
// テンプレートに採点ルーブリック設定済み・エンジン対応）を満たし、かつ現在の治療系オーダー集合が
// 過去に評価済み(PENDING/COMPLETED)の集合と異なる場合のみPENDING行を作成してそのIDを返す。
// 実際のAI呼び出しはここでは行わない（呼び出し元がNext.jsのafter()でprocessTreatmentEvaluationを呼ぶ）。
export async function createPendingTreatmentEvaluationIfNeeded(caseId: string): Promise<string | null> {
  const caseRecord = await loadCaseForEngine(caseId);
  if (!caseRecord || caseRecord.crisisState !== "STABLE") return null;

  const template = caseRecord.diseaseTemplate;
  const guideline = template?.aiEvaluationGuideline?.trim();
  if (!template || !guideline) return null;

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
  const template = caseRecord?.diseaseTemplate;
  const guideline = template?.aiEvaluationGuideline?.trim();
  if (!caseRecord || caseRecord.crisisState !== "STABLE" || !template || !guideline) {
    await db.treatmentEvaluation.update({
      where: { id: evaluationId },
      data: {
        status: "FAILED",
        errorMessage: "評価開始前に前提条件（急変未発生・ルーブリック設定）が崩れたため中止しました。",
        completedAt: new Date(),
      },
    });
    return;
  }

  try {
    const orderIds = JSON.parse(evaluation.orderIdsSnapshot) as string[];
    const [orders, problems, latestVital] = await Promise.all([
      db.order.findMany({
        where: { id: { in: orderIds } },
        select: { orderType: true, label: true, detail: true, orderedAt: true },
      }),
      db.problem.findMany({ where: { caseId: evaluation.caseId }, select: { label: true, isPrimary: true } }),
      db.vital.findFirst({ where: { caseId: evaluation.caseId }, orderBy: { recordedAt: "desc" } }),
    ]);

    const result = await evaluateTreatment({
      caseRecord,
      templateName: template.name,
      templateDescription: template.description,
      guideline,
      problems,
      orders,
      latestVital,
    });

    // AI呼び出し中（数秒〜）に状態が変わっていないか（危機発生・死亡）再確認してから重症度へ反映する
    const freshCase = await loadCaseForEngine(evaluation.caseId);
    let resetSeverity: number | null = null;
    const severityRatePerHour = computeAiSeverityRatePerHour(result.appropriatenessScore);
    if (freshCase && freshCase.crisisState === "STABLE") {
      const clockNow = getCaseClockNow(freshCase);
      const config = await loadTemplateConfig(template.key);
      const treatmentOrders = await loadTreatmentOrders(evaluation.caseId);
      const currentSeverity = computeCaseSeverityAtTime(freshCase, treatmentOrders, config, clockNow);
      if (currentSeverity !== null) {
        // 禁忌等が検知された場合のみ、その場で一気に重症度をジャンプさせる。それ以外は現在値をそのまま
        // 引き継ぐ（ジャンプなし）— 以降はseverityRatePerHourによる連続的な変化に委ねる。
        resetSeverity = result.contraindicated ? applyContraindicationJump(currentSeverity) : Math.round(currentSeverity);
        const params = parsePhysiologyParams(freshCase.physiologyParams);
        await db.case.update({
          where: { id: evaluation.caseId },
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
