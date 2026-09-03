import type { Case, CaseDiseaseLink, Order } from "@prisma/client";
import { DEFAULT_PHYSIOLOGY_PARAMS, type PhysiologyParams } from "@/lib/physiology";
import { formatLabValues, type LabValue } from "@/lib/lab-reference-ranges";

export type SeverityTier = "mild" | "moderate" | "severe";

export type VitalPoint = {
  temperature: number;
  systolicBp: number;
  diastolicBp: number;
  pulse: number;
  spo2: number;
  respRate: number;
};

// 疾患の影響は基礎生理モデルへの増減量（perSeverity * severity/100）のみを持つ。基礎値(base)は
// BasePhysiologyModel（症例・疾患非依存の1行）が持ち、生理モデルがそこへ全疾患分を単純加算する。
type VitalCoefficients = {
  perSeverity: VitalPoint; // 重症度100あたりの増減量
};

type TextPatternSet = { kind: "text"; patterns: Record<SeverityTier, string> };
type ValuePatternSet = { kind: "values"; patterns: Record<SeverityTier, LabValue[]> };
export type PatternSet = TextPatternSet | ValuePatternSet;

// このテンプレートにおける「治療開始」とみなす条件。drugCategoriesは処方・注射オーダーの薬剤大分類、
// procedureKeywordsは処置・手術オーダーのlabelに含まれる文字列（部分一致）。どちらか一方でも指定でき、
// 両方指定した場合はいずれか早く条件を満たしたオーダーの時刻を治療開始時刻として採用する。
export type TreatmentTrigger = {
  drugCategories?: string[];
  procedureKeywords?: string[];
};

// 危機シナリオ（急変・死亡モデル）の発動条件。severityは重症度そのもの、labはその時点の重症度から
// 導かれる動的検査所見（resolveDynamicLabの数値項目）、vitalはその時点の重症度から導かれるバイタルを参照する。
// いずれもテンプレートの通常の重症度カーブ上の値を見るだけで、学生が実際にその検査をオーダーしたかは問わない
// （＝オーダーの有無に関わらず、患者の「真の」病態として急変しうる）。
// labトリガーのlabelは、1つの検査項目コードが複数の値を返す（例: 動脈血液ガス分析がpH/pCO2/pO2等を
// まとめて返す）場合に、そのうちどの値を見るかを指定する。省略時は配列の先頭（values[0]）を見る。
export type CrisisTrigger =
  | { type: "severity"; op: ">=" | "<="; value: number }
  | { type: "lab"; code: string; label?: string; op: ">=" | "<="; value: number }
  | { type: "vital"; field: keyof VitalPoint; op: ">=" | "<="; value: number };

// 危機シナリオから脱するための救命オーダー。TreatmentTrigger同様、薬剤大分類 or 処置・手術labelの部分一致。
export type CrisisRescueAction = {
  label: string;
  drugCategories?: string[];
  procedureKeywords?: string[];
};

export type CrisisScenario = {
  name: string; // 表示名（例: "心室細動・心停止"）
  triggers: CrisisTrigger[]; // いずれか1つで発動（OR）
  // トリガー条件が連続して満たされてからCRITICALへ遷移するまでの猶予（分）。0＝瞬間発火。
  sustainMinutes: number;
  windowMinutes: number; // 発動後この時間内に救命オーダーがなければ死亡（crisisMode=LETHALの場合）
  rescueActions: CrisisRescueAction[]; // いずれか1つのオーダーで危機を脱する
  crisisVitals: VitalPoint; // 危機発生中（CRITICAL/DECEASED）は通常の重症度カーブでなくこの固定値を表示
  postRescueSeverity: number; // 救命成功後にリセットする重症度
};

// vitals/labPatterns/treatmentはDiseaseTemplate（vitalsConfig/treatmentConfig列、TemplateLabPattern等の関連テーブル）から、
// crisisはTemplateCrisisScenario（未設定ならnull＝そのテンプレートには急変シナリオがない）から、
// engine.tsのloadTemplateConfigが組み立てる。以降の計算ロジックはこの形に一本化されたconfigだけを見る。
export type TemplateConfig = {
  treatment: TreatmentTrigger;
  vitals: VitalCoefficients;
  // 検査項目コード（LabItemMaster.code）ごとの重症度別所見パターン。
  // 数値化できる項目はvalues（H/L判定・色分け表示の対象）、画像所見・培養結果などの定性的な項目はtextを使う。
  labPatterns: Record<string, PatternSet>;
  crisis: CrisisScenario | null;
};

// 管理画面で新規に急変シナリオを作成する際の猶予時間の初期値。現実の急変対応時間より大幅に長いが、
// 症例の進行ペース（実時間 or シミュレーション時間の単位が時間〜日オーダー）に合わせて
// あえてこの値を採用している（ユーザー指示）。テンプレートごとに管理画面から変更可能。
export const CRISIS_WINDOW_MINUTES = 480;

const FLOOR_SEVERITY = 5;
const UNTREATED_DRIFT_PER_HOUR = 2; // 未治療時の悪化速度（重症度ポイント/時間）

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parsePhysiologyParams(raw: string | null | undefined): PhysiologyParams {
  if (!raw) return DEFAULT_PHYSIOLOGY_PARAMS;
  try {
    return { ...DEFAULT_PHYSIOLOGY_PARAMS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PHYSIOLOGY_PARAMS;
  }
}

// MANUAL症例は学習者が手動で進める仮想時計、REALTIME症例は実時計を「現在時刻」として使う
export function getCaseClockNow(caseRecord: Pick<Case, "timeProgressMode" | "simNowAt" | "createdAt">): Date {
  if (caseRecord.timeProgressMode === "MANUAL") {
    return caseRecord.simNowAt ?? caseRecord.createdAt;
  }
  return new Date();
}

function improvementRatePerHour(improvementSpeedSlider: number): number {
  const halfLifeHours = 24 - (improvementSpeedSlider / 100) * 20; // 4〜24時間
  return Math.log(2) / halfLifeHours;
}

type TreatmentOrder = Pick<Order, "orderedAt" | "orderType" | "label" | "detail"> & {
  drug: { categoryLinks: { category: { majorCategory: string } }[] } | null;
};

// 治療開始時刻。薬剤カテゴリ一致（処方・注射、1薬剤が複数カテゴリを持ちうるためいずれか1つでも
// drugCategoriesに含まれれば治療とみなす。判定は大分類(majorCategory)単位のみ）、または処置ラベルの
// キーワード一致（処置・手術）のうち、最も早く条件を満たしたオーダーの時刻を返す。未治療ならnull。
export function findTreatmentStartAt(orders: TreatmentOrder[], trigger: TreatmentTrigger): Date | null {
  let earliest: Date | null = null;
  for (const order of orders) {
    let matched = false;
    if (order.orderType === "MEDICATION" || order.orderType === "INJECTION") {
      const majors = order.drug?.categoryLinks.map((l) => l.category.majorCategory) ?? [];
      matched = !!trigger.drugCategories?.length && majors.some((m) => trigger.drugCategories!.includes(m));
    } else if (order.orderType === "PROCEDURE") {
      matched = !!trigger.procedureKeywords?.length && trigger.procedureKeywords.some((kw) => order.label.includes(kw));
    }
    if (matched && (!earliest || order.orderedAt < earliest)) earliest = order.orderedAt;
  }
  return earliest;
}

// 一般指示カテゴリ「酸素投与」のデバイス・流量ごとのSpO2上乗せ幅（%pt）。基礎疾患の重症度自体は
// 改善しない対症療法的な効果として扱う。選択肢の文言はGeneralOrderDialog.tsxのプリセットと対応させる。
const OXYGEN_SPO2_BOOST: Record<string, number> = {
  "鼻カニューレ 1L/分": 2,
  "鼻カニューレ 2L/分": 3,
  "鼻カニューレ 3L/分": 4,
  "鼻カニューレ 4L/分": 5,
  "鼻カニューレ 5L/分": 6,
  "簡易酸素マスク 5L/分": 6,
  "簡易酸素マスク 6L/分": 7,
  "簡易酸素マスク 7L/分": 8,
  "リザーバーマスク 8L/分": 10,
  "リザーバーマスク 10L/分": 12,
  "リザーバーマスク 15L/分": 14,
  "中止（room air）": 0,
};

// 指定時刻の時点で有効な酸素投与指示（時刻以前の最新の一般指示「酸素投与」オーダー）による
// SpO2上乗せ幅を返す。一般指示オーダーのdetailにはカテゴリ・選択値をJSON文字列で保存している。
export function findActiveOxygenBoost(orders: TreatmentOrder[], atTime: Date): number {
  let latest: { orderedAt: Date; selection: string } | null = null;
  for (const order of orders) {
    if (order.orderType !== "GENERAL" || order.orderedAt > atTime) continue;
    let detail: { category?: string; selection?: string } = {};
    if (order.detail) {
      try {
        detail = JSON.parse(order.detail);
      } catch {
        continue;
      }
    }
    if (detail.category !== "酸素投与") continue;
    if (!latest || order.orderedAt > latest.orderedAt) latest = { orderedAt: order.orderedAt, selection: detail.selection ?? "" };
  }
  return latest ? (OXYGEN_SPO2_BOOST[latest.selection] ?? 0) : 0;
}

export function computeSeverityAt(params: {
  baseSeverity: number;
  improvementSpeedSlider: number;
  caseStartAt: Date;
  treatmentStartAt: Date | null;
  atTime: Date;
}): number {
  const { baseSeverity, improvementSpeedSlider, caseStartAt, treatmentStartAt, atTime } = params;

  if (!treatmentStartAt || atTime <= treatmentStartAt) {
    const hoursSinceStart = Math.max(0, (atTime.getTime() - caseStartAt.getTime()) / 3_600_000);
    return clamp(baseSeverity + UNTREATED_DRIFT_PER_HOUR * hoursSinceStart, 0, 100);
  }

  // 治療開始時点の重症度を起点に、そこから治療効果で減衰させる
  const severityAtTreatmentStart = clamp(
    baseSeverity + UNTREATED_DRIFT_PER_HOUR * Math.max(0, (treatmentStartAt.getTime() - caseStartAt.getTime()) / 3_600_000),
    0,
    100
  );
  const hoursSinceTreatment = Math.max(0, (atTime.getTime() - treatmentStartAt.getTime()) / 3_600_000);
  const k = improvementRatePerHour(improvementSpeedSlider);
  const severity = FLOOR_SEVERITY + (severityAtTreatmentStart - FLOOR_SEVERITY) * Math.exp(-k * hoursSinceTreatment);
  return clamp(severity, 0, 100);
}

// AI治療評価のスコア（0-100、50が中立）を「時間あたりの重症度変化量」に変換する。1回の評価で重症度を
// 直接ジャンプさせるのではなく、次の評価が入るまで持続する変化率として適用することで、無害なオーダーを
// 何度出しても（＝評価が何度再発火しても）同じ変化率が再アンカーされるだけで済み、改善が二重・三重に
// 計上されることがない（適切な治療が続く限り、重症度は0へ向かって単調に収束することが保証される）。
// スコア50＝現状維持（変化率0）、100＝最速改善、0（ただし禁忌ではない）＝最速悪化。
const MAX_AI_SEVERITY_RATE_PER_HOUR = 4; // スコア0/100のときの最大変化率。100→0まで最短約25時間で改善する想定

export function computeAiSeverityRatePerHour(appropriatenessScore: number): number {
  return -((appropriatenessScore - 50) / 50) * MAX_AI_SEVERITY_RATE_PER_HOUR;
}

// 禁忌薬剤の投与など、単発で重大な害をもたらす行為をAIが検知したときに即座に加算する重症度。
// 上の時間あたり変化率とは別に、その場で一気に悪化させる（ユーザー指示: 「禁忌などを行っている場合は
// 一気に重症化するようにしたい」）。急変シナリオのseverity閾値に届きうる強さを意図している。
const CONTRAINDICATION_SEVERITY_JUMP = 35;

export function applyContraindicationJump(currentSeverity: number): number {
  return clamp(Math.round(currentSeverity + CONTRAINDICATION_SEVERITY_JUMP), 0, 100);
}

export function getSeverityTier(severity: number): SeverityTier {
  if (severity < 34) return "mild";
  if (severity < 67) return "moderate";
  return "severe";
}

// 生理モデルへの1疾患分の入力＝そのテンプレート設定と、現時点でのその疾患自身の重症度。
export type DiseaseContribution = { config: TemplateConfig; severity: number };

// 生理モデル: 基礎生理モデル(base)に、活性中の全疾患それぞれの(perSeverity * 自分の重症度/100)を
// 単純加算して最終的なバイタルを算出する。oxygenBoostは酸素投与によるSpO2上乗せ幅
// （findActiveOxygenBoostの戻り値）。省略時は0（酸素投与なし）。
export function aggregateVitals(base: VitalPoint, contributions: DiseaseContribution[], oxygenBoost = 0): VitalPoint {
  const round1 = (v: number) => Math.round(v * 10) / 10;
  const round0 = (v: number) => Math.round(v);
  const sumField = (field: keyof VitalPoint) =>
    base[field] +
    contributions.reduce((total, c) => total + c.config.vitals.perSeverity[field] * (clamp(c.severity, 0, 100) / 100), 0);
  const spo2WithoutO2 = clamp(round0(sumField("spo2")), 70, 100);
  return {
    temperature: round1(sumField("temperature")),
    systolicBp: round0(sumField("systolicBp")),
    diastolicBp: round0(sumField("diastolicBp")),
    pulse: round0(sumField("pulse")),
    spo2: clamp(spo2WithoutO2 + oxygenBoost, 70, 100),
    respRate: round0(sumField("respRate")),
  };
}

export type DynamicLabResult = { text: string; values: LabValue[] | null };

// テンプレートに紐づく検査項目であれば重症度に応じた所見を返す。対象外ならnull（呼び出し側は静的サンプルにフォールバック）
export function resolveDynamicLab(
  config: TemplateConfig | null,
  labItemCode: string,
  severity: number
): DynamicLabResult | null {
  if (!config) return null;
  const patternSet = config.labPatterns[labItemCode];
  if (!patternSet) return null;
  const tier = getSeverityTier(severity);
  if (patternSet.kind === "text") return { text: patternSet.patterns[tier], values: null };
  const values = patternSet.patterns[tier];
  return { text: formatLabValues(values), values };
}

// 生理モデル: 検査値の統合。数値項目(kind=values)は基礎値(LabItemMaster.sampleValues)に、
// パターンを持つ各疾患の「階層値-基礎値」を単純加算する。文章型(kind=text)や基礎値が無い項目は
// 数値合成できないため、パターンを持つ各疾患の所見テキストを連結する（渡された順、通常は主病態→他疾患）。
// パターンを持たない疾患の寄与は0（無視）。誰もパターンを持たなければnull（呼び出し側は静的サンプルにフォールバック）。
export function aggregateLabResult(
  labItemCode: string,
  contributions: DiseaseContribution[],
  baseSampleValues: LabValue[] | null
): DynamicLabResult | null {
  const matched = contributions
    .map((c) => resolveDynamicLab(c.config, labItemCode, c.severity))
    .filter((r): r is DynamicLabResult => r !== null);
  if (matched.length === 0) return null;

  const allNumeric = matched.every((r) => r.values !== null);
  if (!allNumeric || !baseSampleValues || baseSampleValues.length === 0) {
    return { text: matched.map((r) => r.text).join("\n"), values: null };
  }

  const combined: LabValue[] = baseSampleValues.map((base) => {
    const delta = matched.reduce((sum, r) => {
      const entry = r.values!.find((v) => v.label === base.label);
      return sum + (entry ? entry.value - base.value : 0);
    }, 0);
    return { ...base, value: Math.round((base.value + delta) * 1000) / 1000 };
  });
  return { text: formatLabValues(combined), values: combined };
}

// severityBaselineAtは重症度カーブの起点。通常は疾患アタッチ時刻相当だが、
// 危機シナリオからの救命成功時やAI治療評価時にその時刻へ更新され、以降はそこを新たな起点として
// 重症度が再計算される（救命前の治療オーダーはこの新しい起点以降のものだけを見る）。
export function computeCaseSeverityAtTime(
  diseaseLink: Pick<CaseDiseaseLink, "physiologyParams" | "severityBaselineAt" | "aiSeverityRatePerHour">,
  orders: TreatmentOrder[],
  config: TemplateConfig | null,
  atTime: Date
): number | null {
  if (!config) return null;
  const params = parsePhysiologyParams(diseaseLink.physiologyParams);
  const baselineAt = diseaseLink.severityBaselineAt;

  // AI治療評価が一度でも発火した疾患は、severityBaselineAt以降aiSeverityRatePerHour（時間あたりの
  // 重症度変化量）による線形カーブに切り替わる。この場合、drugCategories/procedureKeywordsによる
  // 素朴な治療開始判定（treatmentStartAt）はもう使わない（AIの評価が既にそれを代替しているため）。
  // AI評価が未発火（null）の疾患では従来どおりの指数減衰カーブを使う。
  if (diseaseLink.aiSeverityRatePerHour !== null && diseaseLink.aiSeverityRatePerHour !== undefined) {
    const hoursSinceBaseline = Math.max(0, (atTime.getTime() - baselineAt.getTime()) / 3_600_000);
    return clamp(params.severitySlider + diseaseLink.aiSeverityRatePerHour * hoursSinceBaseline, 0, 100);
  }

  const relevantOrders = orders.filter((o) => o.orderedAt >= baselineAt);
  const treatmentStartAt = findTreatmentStartAt(relevantOrders, config.treatment);
  return computeSeverityAt({
    baseSeverity: params.severitySlider,
    improvementSpeedSlider: params.improvementSpeedSlider,
    caseStartAt: baselineAt,
    treatmentStartAt,
    atTime,
  });
}

function compareOp(value: number, op: ">=" | "<=", threshold: number): boolean {
  return op === ">=" ? value >= threshold : value <= threshold;
}

// 危機シナリオの発動条件を判定する。lab/vitalは実際にオーダーされた結果ではなく、生理モデルが
// 集約した後の「真の」値（呼び出し側が事前に計算して渡すaggregatedVitals/resolveAggregatedLabValue経由）
// を参照する（未オーダーでも急変しうる）。severityは主病態自身の重症度を見る。
export function evaluateCrisisTriggers(
  crisis: CrisisScenario,
  primarySeverity: number,
  aggregatedVitals: VitalPoint,
  resolveAggregatedLabValue: (code: string, label?: string) => number | null
): boolean {
  return crisis.triggers.some((trigger) => {
    if (trigger.type === "severity") return compareOp(primarySeverity, trigger.op, trigger.value);
    if (trigger.type === "vital") return compareOp(aggregatedVitals[trigger.field], trigger.op, trigger.value);
    const value = resolveAggregatedLabValue(trigger.code, trigger.label);
    return typeof value === "number" && compareOp(value, trigger.op, trigger.value);
  });
}

// crisisStartedAt以降のオーダーに、いずれかのrescueActionsに該当するものがあるか（＝救命に成功したか）
export function findCrisisRescueAt(orders: TreatmentOrder[], scenario: CrisisScenario, crisisStartedAt: Date): Date | null {
  const eligibleOrders = orders.filter((o) => o.orderedAt >= crisisStartedAt);
  const combinedTrigger: TreatmentTrigger = {
    drugCategories: scenario.rescueActions.flatMap((a) => a.drugCategories ?? []),
    procedureKeywords: scenario.rescueActions.flatMap((a) => a.procedureKeywords ?? []),
  };
  return findTreatmentStartAt(eligibleOrders, combinedTrigger);
}

