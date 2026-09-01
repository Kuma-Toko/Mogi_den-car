import { db } from "@/lib/db";
import { formatJaDateTimeShort } from "@/lib/format";
import type { LabValue } from "@/lib/lab-reference-ranges";
import { ResultsView, type ImagingDetail, type ResultBatch, type TrendSeries } from "./ResultsView";

type LabOrder = Awaited<ReturnType<typeof loadLabOrders>>[number];

function loadLabOrders(caseId: string) {
  return db.order.findMany({
    where: { caseId, orderType: { in: ["LAB", "IMAGING"] } },
    orderBy: { orderedAt: "desc" },
  });
}

function parseValues(json: string | null): LabValue[] | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as LabValue[];
  } catch {
    return null;
  }
}

function parseImaging(detail: string | null): ImagingDetail | null {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail) as ImagingDetail;
    if (!parsed.chiefComplaint && !parsed.findings && !parsed.purpose && parsed.needsInterpretation === undefined) return null;
    return parsed;
  } catch {
    return null;
  }
}

// 表示上の日付・時刻（分単位）が同じオーダーをまとめる。同じタイミングで別々に発行した
// オーダーも、画面に表示される日時が一致していれば同じグループとして見えるようにする。
function groupByDisplayedTime(orders: LabOrder[]): LabOrder[][] {
  const groups = new Map<string, LabOrder[]>();
  const keys: string[] = [];
  for (const o of orders) {
    const key = formatJaDateTimeShort(o.orderedAt);
    if (!groups.has(key)) {
      groups.set(key, []);
      keys.push(key);
    }
    groups.get(key)!.push(o);
  }
  return keys.map((k) => groups.get(k)!);
}

// 検査値ラベルごとに、結果が判明した時刻順（古い→新しい）で値を集めて時系列データにする。
function buildTrendSeries(orders: LabOrder[]): TrendSeries[] {
  const chronological = [...orders].reverse();
  const map = new Map<string, TrendSeries>();
  for (const o of chronological) {
    const values = parseValues(o.resultValues);
    if (!values) continue;
    const time = formatJaDateTimeShort(o.resultReadyAt ?? o.orderedAt);
    for (const v of values) {
      let series = map.get(v.label);
      if (!series) {
        series = { label: v.label, unit: v.unit, points: [] };
        map.set(v.label, series);
      }
      series.points.push({ time, value: v.value });
    }
  }
  return [...map.values()].sort((a, b) => b.points.length - a.points.length || a.label.localeCompare(b.label, "ja"));
}

export async function ResultsTab({ caseId }: { caseId: string }) {
  const labOrders = await loadLabOrders(caseId);
  const batches = groupByDisplayedTime(labOrders);
  const trendSeries = buildTrendSeries(labOrders);

  const serializedBatches: ResultBatch[] = batches.map((batch) => ({
    key: batch[0].id,
    heading: `${formatJaDateTimeShort(batch[0].orderedAt)}　オーダー（${batch.length}件）`,
    rows: batch.map((o) => ({
      id: o.id,
      label: o.label,
      status: o.status,
      values: parseValues(o.resultValues),
      resultText: o.resultText,
      imaging: parseImaging(o.detail),
    })),
  }));

  return <ResultsView batches={serializedBatches} trendSeries={trendSeries} />;
}
