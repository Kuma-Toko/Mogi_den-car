"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import type { Case, CaseType, CrisisMode } from "@prisma/client";
import type { PhysiologyParams } from "@/lib/physiology";
import { caseTypeSchema, clampPatientAge, clampSlider0to100, patientGenderSchema } from "@/lib/schemas";

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
  // Prisma/SQLiteのenumはCHECK制約を生成しないため、whitelist無しにキャストすると任意の文字列が
  // 永続化されうる（後続のRecord<CaseType, …>系ラベル参照が全てundefinedになる）。
  const caseTypeParsed = caseTypeSchema.safeParse(formData.get("caseType"));
  const caseType: CaseType = caseTypeParsed.success ? caseTypeParsed.data : "SIMULATION";
  const patientName = String(formData.get("patientName") ?? "").trim();
  // NaN・負数・小数・異常値が生理モデルの年齢帯マッチングへそのまま渡ると意図しない基準値が選ばれるため、
  // 0〜120歳の整数へクランプする（"Number(x) || 0"だとNaNが黙って0歳＝乳児帯になっていた）。
  const patientAge = clampPatientAge(Number(formData.get("patientAge")));
  const patientGenderParsed = patientGenderSchema.safeParse(String(formData.get("patientGender") ?? ""));
  const patientGender = patientGenderParsed.success ? patientGenderParsed.data : "男性";
  const ward = String(formData.get("ward") ?? "").trim() || null;
  const bed = String(formData.get("bed") ?? "").trim() || null;
  const visibilityScope = String(formData.get("visibilityScope") ?? "").trim() || null;
  const historyScript = String(formData.get("historyScript") ?? "").trim() || null;
  const examScript = String(formData.get("examScript") ?? "").trim() || null;
  const problemsRaw = String(formData.get("problems") ?? "");
  const diseaseTemplateIds = formData
    .getAll("diseaseTemplateIds")
    .map((v) => String(v))
    .filter(Boolean);
  const primaryTemplateIdRaw = String(formData.get("primaryTemplateId") ?? "") || null;
  const primaryTemplateId =
    primaryTemplateIdRaw && diseaseTemplateIds.includes(primaryTemplateIdRaw) ? primaryTemplateIdRaw : (diseaseTemplateIds[0] ?? null);
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
  const physiologyParamsByTemplate: Record<string, PhysiologyParams> = {};
  const pathogenIdByTemplate: Record<string, string | null> = {};
  const relevantSpecimenSitesByTemplate: Record<string, string[] | null> = {};
  for (const templateId of diseaseTemplateIds) {
    // "Number(x) ?? 50"は非数値文字列に対してNaNを返す（??はnullish coalescingでNaNを素通りさせる）ため、
    // JSON.stringify(NaN)がnullになって重症度カーブ全体がNaN化しうる。0〜100へ必ず数値クランプする。
    physiologyParamsByTemplate[templateId] = {
      initialTempSlider: clampSlider0to100(Number(formData.get(`tpl_${templateId}_initialTempSlider`))),
      improvementSpeedSlider: clampSlider0to100(Number(formData.get(`tpl_${templateId}_improvementSpeedSlider`))),
      initialSpo2Slider: clampSlider0to100(Number(formData.get(`tpl_${templateId}_initialSpo2Slider`))),
      severitySlider: clampSlider0to100(Number(formData.get(`tpl_${templateId}_severitySlider`))),
    };
    pathogenIdByTemplate[templateId] = String(formData.get(`tpl_${templateId}_pathogenId`) ?? "").trim() || null;
    // 検体部位制限: チェックボックスがONのときだけ配列（空配列もありうる）、OFFならnull（=制限なし、既存挙動）。
    const specimenSiteRestricted = formData.get(`tpl_${templateId}_specimenSiteRestricted`) != null;
    relevantSpecimenSitesByTemplate[templateId] = specimenSiteRestricted
      ? formData.getAll(`tpl_${templateId}_relevantSpecimenSites`).map((v) => String(v))
      : null;
  }

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
    diseaseTemplateIds,
    primaryTemplateId,
    resultTiming,
    crisisMode,
    sharingMode,
    assigneeLoginIds,
    physiologyParamsByTemplate,
    pathogenIdByTemplate,
    relevantSpecimenSitesByTemplate,
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
    diseaseTemplateIds,
    primaryTemplateId,
    resultTiming,
    crisisMode,
    sharingMode,
    assigneeLoginIds,
    physiologyParamsByTemplate,
    pathogenIdByTemplate,
    relevantSpecimenSitesByTemplate,
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
        crisisMode,
        createdByUserId: user.id,
        publishedAt: isPublish ? new Date() : null,
      },
    });

    if (diseaseTemplateIds.length > 0) {
      await tx.caseDiseaseLink.createMany({
        data: diseaseTemplateIds.map((templateId, i) => ({
          caseId: created.id,
          templateId,
          isPrimary: templateId === primaryTemplateId,
          physiologyParams: JSON.stringify(physiologyParamsByTemplate[templateId]),
          pathogenId: pathogenIdByTemplate[templateId] ?? null,
          relevantSpecimenSites:
            relevantSpecimenSitesByTemplate[templateId] != null ? JSON.stringify(relevantSpecimenSitesByTemplate[templateId]) : null,
          sortOrder: i,
        })),
      });
    }

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
    diseaseTemplateIds,
    primaryTemplateId,
    resultTiming,
    crisisMode,
    sharingMode,
    assigneeLoginIds,
    physiologyParamsByTemplate,
    pathogenIdByTemplate,
    relevantSpecimenSitesByTemplate,
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
        crisisMode,
        ...(isPublish
          ? { status: caseRecord.caseType === "SIMULATION" ? "SIMULATING" : "ACTIVE", publishedAt: new Date() }
          : {}),
      },
    });

    // 選択解除された疾患のリンクは削除。残った/新規の疾患はupsertする（既存分のseverityBaselineAt・
    // aiSeverityRatePerHourは更新対象に含めないので、他のフィールド編集で重症度進行がリセットされない）。
    await tx.caseDiseaseLink.deleteMany({ where: { caseId, templateId: { notIn: diseaseTemplateIds } } });
    for (let i = 0; i < diseaseTemplateIds.length; i++) {
      const templateId = diseaseTemplateIds[i];
      const isPrimary = templateId === primaryTemplateId;
      const physiologyParamsJson = JSON.stringify(physiologyParamsByTemplate[templateId]);
      const pathogenId = pathogenIdByTemplate[templateId] ?? null;
      const relevantSpecimenSites =
        relevantSpecimenSitesByTemplate[templateId] != null ? JSON.stringify(relevantSpecimenSitesByTemplate[templateId]) : null;
      await tx.caseDiseaseLink.upsert({
        where: { caseId_templateId: { caseId, templateId } },
        // update()はスカラーFKを受け付けないため（[[project_mogi_dencal_prisma7_notes]]参照）pathogenIdのみnested syntaxを使う。
        // relevantSpecimenSitesはFKではない素のString列なのでスカラーのまま渡せる。
        update: {
          isPrimary,
          physiologyParams: physiologyParamsJson,
          relevantSpecimenSites,
          sortOrder: i,
          pathogen: pathogenId ? { connect: { id: pathogenId } } : { disconnect: true },
        },
        create: { caseId, templateId, isPrimary, physiologyParams: physiologyParamsJson, pathogenId, relevantSpecimenSites, sortOrder: i },
      });
    }

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
