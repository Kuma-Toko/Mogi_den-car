import type { Case, Order } from "@prisma/client";
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

type VitalCoefficients = {
  base: VitalPoint;
  perSeverity: VitalPoint; // 重症度100あたりの増減量（base + perSeverity * severity/100）
};

type TextPatternSet = { kind: "text"; patterns: Record<SeverityTier, string> };
type ValuePatternSet = { kind: "values"; patterns: Record<SeverityTier, LabValue[]> };
type PatternSet = TextPatternSet | ValuePatternSet;

type TemplateConfig = {
  // このテンプレートにおける「有効な治療」とみなす薬剤カテゴリ
  treatmentCategories: string[];
  vitals: VitalCoefficients;
  // 検査項目コード（LabItemMaster.code）ごとの重症度別所見パターン。
  // 数値化できる項目はvalues（H/L判定・色分け表示の対象）、画像所見・培養結果などの定性的な項目はtextを使う。
  labPatterns: Record<string, PatternSet>;
};

const TEMPLATE_CONFIG: Record<string, TemplateConfig> = {
  infection: {
    treatmentCategories: ["抗菌薬"],
    vitals: {
      base: { temperature: 36.5, systolicBp: 122, diastolicBp: 76, pulse: 72, spo2: 99, respRate: 15 },
      perSeverity: { temperature: 3.4, systolicBp: -22, diastolicBp: -14, pulse: 48, spo2: -14, respRate: 13 },
    },
    labPatterns: {
      "LAB-003": {
        // CRP
        kind: "values",
        patterns: {
          mild: [{ label: "CRP", value: 1.2, unit: "mg/dL" }],
          moderate: [{ label: "CRP", value: 8.9, unit: "mg/dL" }],
          severe: [{ label: "CRP", value: 22.4, unit: "mg/dL" }],
        },
      },
      "LAB-004": {
        // 血液培養（2セット）
        kind: "text",
        patterns: {
          mild: "陰性（48時間培養、有意菌の発育なし）",
          moderate: "グラム陽性球菌を少数検出（同定検査中）",
          severe: "グラム陰性桿菌を検出、同定検査中（菌血症の可能性）",
        },
      },
      "LAB-005": {
        // 胸部X線
        kind: "text",
        patterns: {
          mild: "軽度の透亮性低下を認めるが、明らかな浸潤影は指摘できない。",
          moderate: "右下肺野に浸潤影を認める。",
          severe: "両側肺野に広範な浸潤影を認め、一部に無気肺を疑う所見あり。",
        },
      },
    },
  },
  heart_failure: {
    treatmentCategories: ["利尿薬"],
    vitals: {
      base: { temperature: 36.6, systolicBp: 145, diastolicBp: 88, pulse: 78, spo2: 97, respRate: 16 },
      perSeverity: { temperature: 0.8, systolicBp: 10, diastolicBp: 6, pulse: 32, spo2: -17, respRate: 14 },
    },
    labPatterns: {
      "LAB-006": {
        // BNP
        kind: "values",
        patterns: {
          mild: [{ label: "BNP", value: 180, unit: "pg/mL" }],
          moderate: [{ label: "BNP", value: 620, unit: "pg/mL" }],
          severe: [{ label: "BNP", value: 1450, unit: "pg/mL" }],
        },
      },
      "LAB-005": {
        // 胸部X線
        kind: "text",
        patterns: {
          mild: "軽度の肺うっ血を疑う所見。心胸郭比はやや拡大。",
          moderate: "肺うっ血像と胸水貯留を認める。心胸郭比拡大。",
          severe: "著明な肺うっ血、両側胸水、心拡大を認める。",
        },
      },
    },
  },
  dehydration: {
    treatmentCategories: ["輸液"],
    vitals: {
      base: { temperature: 36.8, systolicBp: 122, diastolicBp: 78, pulse: 76, spo2: 98, respRate: 16 },
      perSeverity: { temperature: 1.0, systolicBp: -32, diastolicBp: -18, pulse: 44, spo2: -4, respRate: 6 },
    },
    labPatterns: {
      "LAB-002": {
        // 生化学一般
        kind: "values",
        patterns: {
          mild: [
            { label: "Cr", value: 1.1, unit: "mg/dL" },
            { label: "BUN", value: 22, unit: "mg/dL" },
            { label: "Na", value: 142, unit: "mEq/L" },
          ],
          moderate: [
            { label: "Cr", value: 1.6, unit: "mg/dL" },
            { label: "BUN", value: 38, unit: "mg/dL" },
            { label: "Na", value: 148, unit: "mEq/L" },
          ],
          severe: [
            { label: "Cr", value: 2.4, unit: "mg/dL" },
            { label: "BUN", value: 55, unit: "mg/dL" },
            { label: "Na", value: 152, unit: "mEq/L" },
          ],
        },
      },
    },
  },
};

const FLOOR_SEVERITY = 5;
const UNTREATED_DRIFT_PER_HOUR = 2; // 未治療時の悪化速度（重症度ポイント/時間）

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getTemplateConfig(templateKey: string | null | undefined): TemplateConfig | null {
  if (!templateKey) return null;
  return TEMPLATE_CONFIG[templateKey] ?? null;
}

// この検査項目コードが、いずれかの病態テンプレートの動的所見パターンで使われているか
export function isEngineLinkedLabCode(labItemCode: string): boolean {
  return Object.values(TEMPLATE_CONFIG).some((config) => labItemCode in config.labPatterns);
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

type TreatmentOrder = Pick<Order, "orderedAt" | "orderType"> & { drug: { category: string | null } | null };

// 治療開始時刻（該当カテゴリの薬剤オーダーのうち最も早いもの）。未治療ならnull
export function findTreatmentStartAt(orders: TreatmentOrder[], treatmentCategories: string[]): Date | null {
  let earliest: Date | null = null;
  for (const order of orders) {
    if (order.orderType !== "MEDICATION" && order.orderType !== "INJECTION") continue;
    const category = order.drug?.category;
    if (!category || !treatmentCategories.includes(category)) continue;
    if (!earliest || order.orderedAt < earliest) earliest = order.orderedAt;
  }
  return earliest;
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

export function getSeverityTier(severity: number): SeverityTier {
  if (severity < 34) return "mild";
  if (severity < 67) return "moderate";
  return "severe";
}

export function computeVitalsForSeverity(templateKey: string, severity: number): VitalPoint | null {
  const config = TEMPLATE_CONFIG[templateKey];
  if (!config) return null;
  const ratio = clamp(severity, 0, 100) / 100;
  const { base, perSeverity } = config.vitals;
  const round1 = (v: number) => Math.round(v * 10) / 10;
  const round0 = (v: number) => Math.round(v);
  return {
    temperature: round1(base.temperature + perSeverity.temperature * ratio),
    systolicBp: round0(base.systolicBp + perSeverity.systolicBp * ratio),
    diastolicBp: round0(base.diastolicBp + perSeverity.diastolicBp * ratio),
    pulse: round0(base.pulse + perSeverity.pulse * ratio),
    spo2: clamp(round0(base.spo2 + perSeverity.spo2 * ratio), 70, 100),
    respRate: round0(base.respRate + perSeverity.respRate * ratio),
  };
}

export type DynamicLabResult = { text: string; values: LabValue[] | null };

// テンプレートに紐づく検査項目であれば重症度に応じた所見を返す。対象外ならnull（呼び出し側は静的サンプルにフォールバック）
export function resolveDynamicLab(
  templateKey: string | null | undefined,
  labItemCode: string,
  severity: number
): DynamicLabResult | null {
  const config = getTemplateConfig(templateKey);
  if (!config) return null;
  const patternSet = config.labPatterns[labItemCode];
  if (!patternSet) return null;
  const tier = getSeverityTier(severity);
  if (patternSet.kind === "text") return { text: patternSet.patterns[tier], values: null };
  const values = patternSet.patterns[tier];
  return { text: formatLabValues(values), values };
}

export function computeCaseSeverityAtTime(
  caseRecord: Pick<Case, "createdAt" | "physiologyParams">,
  orders: TreatmentOrder[],
  templateKey: string | null | undefined,
  atTime: Date
): number | null {
  const config = getTemplateConfig(templateKey);
  if (!config) return null;
  const params = parsePhysiologyParams(caseRecord.physiologyParams);
  const treatmentStartAt = findTreatmentStartAt(orders, config.treatmentCategories);
  return computeSeverityAt({
    baseSeverity: params.severitySlider,
    improvementSpeedSlider: params.improvementSpeedSlider,
    caseStartAt: caseRecord.createdAt,
    treatmentStartAt,
    atTime,
  });
}

