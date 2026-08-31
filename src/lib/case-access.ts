import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function requireCaseAccess(caseId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const caseRecord = await db.case.findUnique({ where: { id: caseId } });
  if (!caseRecord) redirect(user.role === "STUDENT" ? "/patients" : "/teacher/cases");

  if (user.role === "STUDENT") {
    const assigned = await db.caseAssignment.findUnique({
      where: { caseId_studentId: { caseId, studentId: user.id } },
    });
    if (!assigned) redirect("/patients");
  } else if (user.role === "TEACHER" && caseRecord!.createdByUserId !== user.id) {
    redirect("/teacher/cases");
  }

  return { user, case: caseRecord! };
}
