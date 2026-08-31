"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function joinCase(caseId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const caseRecord = await db.case.findUnique({ where: { id: caseId } });
  const isPoolable =
    caseRecord &&
    (caseRecord.status === "ACTIVE" || caseRecord.status === "SIMULATING") &&
    (caseRecord.caseType === "ROUTINE_COMMON" || caseRecord.caseType === "SIMULATION");
  if (!isPoolable) redirect("/patients/pool");

  await db.caseAssignment.upsert({
    where: { caseId_studentId: { caseId, studentId: user.id } },
    create: { caseId, studentId: user.id },
    update: {},
  });
  await logAudit({ userId: user.id, action: "case_join", targetType: "Case", targetId: caseId });

  revalidatePath("/patients");
  revalidatePath("/patients/pool");
  redirect(`/patients/${caseId}`);
}
