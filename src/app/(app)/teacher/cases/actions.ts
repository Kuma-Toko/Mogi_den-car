"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { generateCaseCode, readCaseFields, requireOwnedCase, timeProgressModeFor } from "./case-fields";

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
  // 下書きで放置していた期間が未治療ドリフトとしてそのまま重症度カーブへ積算されてしまうのを防ぐため、
  // 公開時刻をここで確定し、疾患リンクのseverityBaselineAtをこの時刻へ揃える（下のupsertループの後）。
  const publishedAt = new Date();

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
          ? { status: caseRecord.caseType === "SIMULATION" ? "SIMULATING" : "ACTIVE", publishedAt }
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

    // 公開の瞬間に全疾患リンクの重症度カーブ起点を公開時刻へ揃える（下書き放置期間の未治療ドリフトが
    // 積算されたまま公開されるのを防ぐ）。upsertループの後に置くことで、新規作成リンクの
    // @default(now())な値もここで確実に揃う。aiSeverityRatePerHourは教員がサマリタブから手動設定して
    // いる可能性があるためリセットしない。
    if (isPublish) {
      await tx.caseDiseaseLink.updateMany({ where: { caseId }, data: { severityBaselineAt: publishedAt } });
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
