"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import type { Case, CaseType, CrisisMode } from "@prisma/client";

const CRISIS_MODES: CrisisMode[] = ["OFF", "REVERSIBLE", "LETHAL"];

function randomDigits(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
}

async function generateCaseCode(caseType: CaseType): Promise<string> {
  const prefix = caseType === "SIMULATION" ? "SIM" : "P";
  const digits = caseType === "SIMULATION" ? 2 : 4;
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = `${prefix}-${randomDigits(digits)}`;
    const exists = await db.case.findUnique({ where: { caseCode: code } });
    if (!exists) return code;
  }
  return `${prefix}-${Date.now()}`;
}

function timeProgressModeFor(caseType: CaseType) {
  return caseType === "SIMULATION" ? "MANUAL" : "REALTIME";
}

// 症例作成・編集フォームの共通フィールドをパースする。
function readCaseFields(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const caseType = String(formData.get("caseType") ?? "SIMULATION") as CaseType;
  const patientName = String(formData.get("patientName") ?? "").trim();
  const patientAge = Number(formData.get("patientAge") ?? 0) || 0;
  const patientGender = String(formData.get("patientGender") ?? "");
  const ward = String(formData.get("ward") ?? "").trim() || null;
  const bed = String(formData.get("bed") ?? "").trim() || null;
  const visibilityScope = String(formData.get("visibilityScope") ?? "").trim() || null;
  const historyScript = String(formData.get("historyScript") ?? "").trim() || null;
  const examScript = String(formData.get("examScript") ?? "").trim() || null;
  const problemsRaw = String(formData.get("problems") ?? "");
  const diseaseTemplateId = String(formData.get("diseaseTemplateId") ?? "") || null;
  const resultTiming = String(formData.get("resultTiming") ?? "IMMEDIATE");
  const crisisModeRaw = String(formData.get("crisisMode") ?? "LETHAL");
  const crisisMode = CRISIS_MODES.includes(crisisModeRaw as CrisisMode) ? (crisisModeRaw as CrisisMode) : "LETHAL";
  const sharingMode = String(formData.get("sharingMode") ?? "SOLO");
  const assigneeLoginIds = String(formData.get("assigneeLoginIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const problemLabels = problemsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const physiologyParams = {
    initialTempSlider: Number(formData.get("initialTempSlider") ?? 50),
    improvementSpeedSlider: Number(formData.get("improvementSpeedSlider") ?? 50),
    initialSpo2Slider: Number(formData.get("initialSpo2Slider") ?? 50),
    severitySlider: Number(formData.get("severitySlider") ?? 50),
  };

  return {
    title,
    caseType,
    patientName,
    patientAge,
    patientGender,
    ward,
    bed,
    visibilityScope,
    historyScript,
    examScript,
    problemLabels,
    diseaseTemplateId,
    resultTiming,
    crisisMode,
    sharingMode,
    assigneeLoginIds,
    physiologyParams,
  };
}

// 教員は自分が作成した症例のみ、管理者は全症例を編集・削除できる。
async function requireOwnedCase(caseId: string): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; caseRecord: Case }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "STUDENT") redirect("/patients");

  const caseRecord = await db.case.findUnique({ where: { id: caseId } });
  if (!caseRecord) redirect("/teacher/cases");
  if (user.role === "TEACHER" && caseRecord.createdByUserId !== user.id) redirect("/teacher/cases");

  return { user, caseRecord };
}

export async function createCase(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "STUDENT") redirect("/patients");

  const intent = String(formData.get("intent") ?? "draft");
  const {
    title,
    caseType,
    patientName,
    patientAge,
    patientGender,
    ward,
    bed,
    visibilityScope,
    historyScript,
    examScript,
    problemLabels,
    diseaseTemplateId,
    resultTiming,
    crisisMode,
    sharingMode,
    assigneeLoginIds,
    physiologyParams,
  } = readCaseFields(formData);

  if (!title || !patientName) return;

  const caseCode = await generateCaseCode(caseType);
  const isPublish = intent === "publish";

  const students =
    isPublish && assigneeLoginIds.length > 0
      ? await db.user.findMany({ where: { loginId: { in: assigneeLoginIds }, role: "STUDENT" } })
      : [];

  const created = await db.$transaction(async (tx) => {
    const created = await tx.case.create({
      data: {
        caseCode,
        title,
        caseType,
        status: isPublish ? (caseType === "SIMULATION" ? "SIMULATING" : "ACTIVE") : "DRAFT",
        timeProgressMode: timeProgressModeFor(caseType),
        sharingMode: sharingMode === "TEAM" ? "TEAM" : "SOLO",
        resultTiming: resultTiming === "DELAYED" ? "DELAYED" : "IMMEDIATE",
        patientName,
        patientAge,
        patientGender,
        ward,
        bed,
        visibilityScope,
        historyScript,
        examScript,
        diseaseTemplateId,
        physiologyParams: JSON.stringify(physiologyParams),
        crisisMode,
        createdByUserId: user.id,
        publishedAt: isPublish ? new Date() : null,
      },
    });

    if (problemLabels.length > 0) {
      await tx.problem.createMany({
        data: problemLabels.map((label, i) => ({
          caseId: created.id,
          label,
          isPrimary: i === 0,
          sortOrder: i,
        })),
      });
    }

    if (students.length > 0) {
      await tx.caseAssignment.createMany({
        data: students.map((s) => ({ caseId: created.id, studentId: s.id })),
      });
    }

    return created;
  });

  await logAudit({
    userId: user.id,
    action: isPublish ? "case_publish" : "case_draft_save",
    targetType: "Case",
    targetId: created.id,
  });

  redirect("/teacher/cases");
}

export async function updateCase(caseId: string, formData: FormData) {
  const { user, caseRecord } = await requireOwnedCase(caseId);

  const intent = String(formData.get("intent") ?? "draft");
  const {
    title,
    patientName,
    patientAge,
    patientGender,
    ward,
    bed,
    visibilityScope,
    historyScript,
    examScript,
    problemLabels,
    diseaseTemplateId,
    resultTiming,
    crisisMode,
    sharingMode,
    assigneeLoginIds,
    physiologyParams,
  } = readCaseFields(formData);
  // 区分（caseType）はcaseCode採番・時間進行モードと結びついているため作成後は変更不可。

  if (!title || !patientName) return;

  const isPublish = intent === "publish" && caseRecord.status === "DRAFT";

  const students =
    assigneeLoginIds.length > 0
      ? await db.user.findMany({ where: { loginId: { in: assigneeLoginIds }, role: "STUDENT" } })
      : [];
  const keepStudentIds = new Set(students.map((s) => s.id));

  await db.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: caseId },
      data: {
        title,
        sharingMode: sharingMode === "TEAM" ? "TEAM" : "SOLO",
        resultTiming: resultTiming === "DELAYED" ? "DELAYED" : "IMMEDIATE",
        patientName,
        patientAge,
        patientGender,
        ward,
        bed,
        visibilityScope,
        historyScript,
        examScript,
        // update()の生成型はdiseaseTemplateIdを直接受け付けない（create()と異なりネストしたrelation構文が必須）。
        diseaseTemplate: diseaseTemplateId ? { connect: { id: diseaseTemplateId } } : { disconnect: true },
        physiologyParams: JSON.stringify(physiologyParams),
        crisisMode,
        ...(isPublish
          ? { status: caseRecord.caseType === "SIMULATION" ? "SIMULATING" : "ACTIVE", publishedAt: new Date() }
          : {}),
      },
    });

    await tx.problem.deleteMany({ where: { caseId } });
    if (problemLabels.length > 0) {
      await tx.problem.createMany({
        data: problemLabels.map((label, i) => ({ caseId, label, isPrimary: i === 0, sortOrder: i })),
      });
    }

    const existingAssignments = await tx.caseAssignment.findMany({ where: { caseId } });
    const existingStudentIds = new Set(existingAssignments.map((a) => a.studentId));
    const toRemoveIds = existingAssignments.filter((a) => !keepStudentIds.has(a.studentId)).map((a) => a.id);
    const toAdd = students.filter((s) => !existingStudentIds.has(s.id));

    if (toRemoveIds.length > 0) {
      await tx.caseAssignment.deleteMany({ where: { id: { in: toRemoveIds } } });
    }
    if (toAdd.length > 0) {
      await tx.caseAssignment.createMany({ data: toAdd.map((s) => ({ caseId, studentId: s.id })) });
    }
  });

  await logAudit({
    userId: user.id,
    action: isPublish ? "case_publish" : "case_edit",
    targetType: "Case",
    targetId: caseId,
  });

  revalidatePath("/teacher/cases");
  redirect("/teacher/cases");
}

export async function deleteCase(caseId: string) {
  const { user } = await requireOwnedCase(caseId);

  await db.case.delete({ where: { id: caseId } });
  await logAudit({ userId: user.id, action: "case_delete", targetType: "Case", targetId: caseId });

  revalidatePath("/teacher/cases");
}
