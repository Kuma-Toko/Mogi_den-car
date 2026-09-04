"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireCaseAccess } from "@/lib/case-access";
import { logAudit } from "@/lib/audit";

export async function dischargeCase(caseId: string) {
  const { user } = await requireCaseAccess(caseId);

  await db.caseAssignment.update({
    where: { caseId_studentId: { caseId, studentId: user.id } },
    data: { dischargedAt: new Date() },
  });
  await logAudit({ userId: user.id, action: "case_discharge", targetType: "Case", targetId: caseId });

  revalidatePath("/patients");
  revalidatePath("/patients/discharged");
}

export async function readmitCase(caseId: string) {
  const { user } = await requireCaseAccess(caseId);

  await db.caseAssignment.update({
    where: { caseId_studentId: { caseId, studentId: user.id } },
    data: { dischargedAt: null },
  });
  await logAudit({ userId: user.id, action: "case_readmit", targetType: "Case", targetId: caseId });

  revalidatePath("/patients");
  revalidatePath("/patients/discharged");
}
