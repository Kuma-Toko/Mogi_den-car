import { db } from "@/lib/db";
import { formatJaDateTimeShort } from "@/lib/format";
import { VitalsView } from "./VitalsView";

export async function VitalsTab({ caseId }: { caseId: string }) {
  const vitals = await db.vital.findMany({ where: { caseId }, orderBy: { recordedAt: "asc" } });

  const rows = vitals.map((v) => ({
    id: v.id,
    time: formatJaDateTimeShort(v.recordedAt),
    temperature: v.temperature,
    systolicBp: v.systolicBp,
    diastolicBp: v.diastolicBp,
    pulse: v.pulse,
    spo2: v.spo2,
    respRate: v.respRate,
  }));

  return <VitalsView vitals={rows} />;
}
