import { db } from "@/lib/db";
import { formatJaDateTimeShort } from "@/lib/format";
import { loadEncounterLog } from "@/lib/encounter-log";
import type { LabValue } from "@/lib/lab-reference-ranges";
import { KarteReferenceTabs, type ReferenceLabRow, type ReferenceVitalRow } from "./KarteReferenceTabs";

function parseValues(json: string | null): LabValue[] | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as LabValue[];
  } catch {
    return null;
  }
}

// カルテ記載タブで、問診・診察ログに加えて検査結果・バイタルも表形式で参照できるようにするパネル。
export async function KarteReferencePanel({ caseId }: { caseId: string }) {
  const [messages, vitals, labOrders] = await Promise.all([
    loadEncounterLog(caseId),
    db.vital.findMany({ where: { caseId }, orderBy: { recordedAt: "desc" } }),
    db.order.findMany({ where: { caseId, orderType: "LAB" }, orderBy: { orderedAt: "desc" } }),
  ]);

  const vitalRows: ReferenceVitalRow[] = vitals.map((v) => ({
    id: v.id,
    time: formatJaDateTimeShort(v.recordedAt),
    temperature: v.temperature,
    systolicBp: v.systolicBp,
    diastolicBp: v.diastolicBp,
    pulse: v.pulse,
    spo2: v.spo2,
    respRate: v.respRate,
  }));

  const labRows: ReferenceLabRow[] = labOrders.map((o) => ({
    id: o.id,
    time: formatJaDateTimeShort(o.resultReadyAt ?? o.orderedAt),
    label: o.label,
    status: o.status,
    values: parseValues(o.resultValues),
    resultText: o.resultText,
  }));

  return <KarteReferenceTabs messages={messages} vitals={vitalRows} labs={labRows} />;
}
