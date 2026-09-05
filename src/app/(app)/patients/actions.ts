"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireCaseAccess } from "@/lib/case-access";
import { logAudit } from "@/lib/audit";
import { runDischargeFeedback } from "@/lib/engine";

export async function dischargeCase(caseId: string) {
  const { user } = await requireCaseAccess(caseId);

  await db.caseAssignment.update({
    where: { caseId_studentId: { caseId, studentId: user.id } },
    data: { dischargedAt: new Date() },
  });
  await logAudit({ userId: user.id, action: "case_discharge", targetType: "Case", targetId: caseId });

  // 退院ボタンを押した直後にその画面で結果を見せるため、後回しにせず同期的に生成する。
  await runDischargeFeedback(caseId, user.id);

  revalidatePath("/patients");
  revalidatePath("/patients/discharged");
  revalidatePath(`/patients/${caseId}`);
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
