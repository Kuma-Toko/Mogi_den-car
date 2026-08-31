"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import type { CaseType } from "@prisma/client";

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

export async function createCase(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "STUDENT") redirect("/patients");

  const intent = String(formData.get("intent") ?? "draft");
  const title = String(formData.get("title") ?? "").trim();
  const caseType = String(formData.get("caseType") ?? "SIMULATION") as CaseType;
  const patientName = String(formData.get("patientName") ?? "").trim();
  const patientAge = Number(formData.get("patientAge") ?? 0) || 0;
  const patientGender = String(formData.get("patientGender") ?? "");
  const ward = String(formData.get("ward") ?? "").trim() || null;
  const bed = String(formData.get("bed") ?? "").trim() || null;
  const visibilityScope = String(formData.get("visibilityScope") ?? "").trim() || null;
  const problemsRaw = String(formData.get("problems") ?? "");
  const diseaseTemplateId = String(formData.get("diseaseTemplateId") ?? "") || null;
  const resultTiming = String(formData.get("resultTiming") ?? "IMMEDIATE");
  const imagingPattern = String(formData.get("imagingPattern") ?? "");
  const sharingMode = String(formData.get("sharingMode") ?? "SOLO");
  const assigneeLoginIds = String(formData.get("assigneeLoginIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const physiologyParams = {
    initialTempSlider: Number(formData.get("initialTempSlider") ?? 50),
    improvementSpeedSlider: Number(formData.get("improvementSpeedSlider") ?? 50),
    initialSpo2Slider: Number(formData.get("initialSpo2Slider") ?? 50),
    severitySlider: Number(formData.get("severitySlider") ?? 50),
  };

  if (!title || !patientName) return;

  const caseCode = await generateCaseCode(caseType);
  const isPublish = intent === "publish";

  const problemLabels = problemsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

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
        diseaseTemplateId,
        physiologyParams: JSON.stringify(physiologyParams),
        imagingPattern: imagingPattern || null,
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
