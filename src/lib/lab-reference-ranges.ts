export type LabValue = { label: string; value: number; unit: string; note?: string };
export type LabFlag = "H" | "L" | null;

// 成人の目安基準範囲（簡易・性別区分なし）。学習用シミュレーションのための概算値。
export const REFERENCE_RANGES: Record<string, { low: number; high: number }> = {
  WBC: { low: 3300, high: 8600 },
  Hb: { low: 13.5, high: 17.5 },
  Plt: { low: 15.8, high: 34.8 },
  AST: { low: 13, high: 30 },
  ALT: { low: 10, high: 42 },
  Cr: { low: 0.65, high: 1.07 },
  BUN: { low: 8, high: 20 },
  Na: { low: 138, high: 145 },
  K: { low: 3.6, high: 4.8 },
  CRP: { low: 0, high: 0.3 },
  BNP: { low: 0, high: 18.4 },
};

export function getLabFlag(label: string, value: number): LabFlag {
  const range = REFERENCE_RANGES[label];
  if (!range) return null;
  if (value > range.high) return "H";
  if (value < range.low) return "L";
  return null;
}

export function formatLabValue(v: LabValue): string {
  const flag = getLabFlag(v.label, v.value);
  const num = v.value.toLocaleString("ja-JP");
  const notes = [flag === "H" ? "高値" : flag === "L" ? "低値" : null, v.note].filter(Boolean).join("・");
  return `${v.label} ${num}${v.unit}${notes ? `（${notes}）` : ""}`;
}

export function formatLabValues(values: LabValue[]): string {
  return values.map(formatLabValue).join("、");
}
