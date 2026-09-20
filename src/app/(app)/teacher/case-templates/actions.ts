"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import type { Case } from "@prisma/client";
import {
  allocateCaseCodes,
  caseCodePrefixFor,
  readCaseFields,
  requireOwnedCase,
  timeProgressModeFor,
} from "../cases/case-fields";

// テンプレートから一度に生成する症例数の上限。SQLiteの1トランザクションが肥大化しないよう分割する。
const GENERATE_BATCH_SIZE = 25;

const GENERATE_INTENTS = ["draft", "publish"] as const;
type GenerateIntent = (typeof GENERATE_INTENTS)[number];

// 症例テンプレート専用の所有権チェック。通常症例のrequireOwnedCase（案内先が/teacher/cases）とは
// エラー時の案内先が異なる（/teacher/case-templates）ため独自に持つ。あわせて対象がテンプレート本体
// （isTemplate=true）であることも確認する。
async function requireOwnedTemplate(
  caseId: string
): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; caseRecord: Case }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "STUDENT") redirect("/patients");

  const caseRecord = await db.case.findUnique({ where: { id: caseId } });
  if (!caseRecord || !caseRecord.isTemplate) redirect("/teacher/case-templates");
  if (user.role === "TEACHER" && caseRecord.createdByUserId !== user.id) redirect("/teacher/case-templates");

  return { user, caseRecord };
}

export async function createCaseTemplate(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "STUDENT") redirect("/patients");

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
    physiologyParamsByTemplate,
    pathogenIdByTemplate,
    relevantSpecimenSitesByTemplate,
  } = readCaseFields(formData);

  if (!title || !patientName) return;

  // テンプレート本体は患者ID（P-1042, SIM-07等）の名前空間を汚さないよう専用のTPL-プレフィックスを使う。
  const [caseCode] = await allocateCaseCodes("TPL", 4, 1);

  const created = await db.$transaction(async (tx) => {
    const created = await tx.case.create({
      data: {
        caseCode,
        title,
        caseType,
        status: "DRAFT",
        timeProgressMode: timeProgressModeFor(caseType),
        sharingMode: "SOLO",
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
        isTemplate: true,
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
        data: problemLabels.map((label, i) => ({ caseId: created.id, label, isPrimary: i === 0, sortOrder: i })),
      });
    }

    return created;
  });

  await logAudit({ userId: user.id, action: "case_template_create", targetType: "Case", targetId: created.id });

  redirect("/teacher/case-templates");
}

export async function updateCaseTemplate(caseId: string, formData: FormData) {
  const { user } = await requireOwnedTemplate(caseId);

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
    physiologyParamsByTemplate,
    pathogenIdByTemplate,
    relevantSpecimenSitesByTemplate,
  } = readCaseFields(formData);
  // 区分（caseType）はcaseCode採番・時間進行モードと結びついているため作成後は変更不可（通常症例と同様）。

  if (!title || !patientName) return;

  await db.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: caseId },
      data: {
        title,
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
      },
    });

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
  });

  await logAudit({ userId: user.id, action: "case_template_update", targetType: "Case", targetId: caseId });

  revalidatePath("/teacher/case-templates");
  redirect("/teacher/case-templates");
}

export async function deleteCaseTemplate(caseId: string) {
  const { user } = await requireOwnedTemplate(caseId);

  // 生成済み症例はCase.templateSourceIdがonDelete: SetNullのため、テンプレートを消しても残る
  // （生成済み症例が消えると学生の進行中のカルテが失われてしまうため）。
  await db.case.delete({ where: { id: caseId } });
  await logAudit({ userId: user.id, action: "case_template_delete", targetType: "Case", targetId: caseId });

  revalidatePath("/teacher/case-templates");
}

// 作り込み済みの通常症例（/teacher/cases）をテンプレートへ複製する。生成ロジックの逆方向。
export async function createTemplateFromCase(caseId: string) {
  const { user, caseRecord } = await requireOwnedCase(caseId);
  if (caseRecord.isTemplate) redirect("/teacher/cases");

  const [links, problems] = await Promise.all([
    db.caseDiseaseLink.findMany({ where: { caseId }, orderBy: { sortOrder: "asc" } }),
    db.problem.findMany({ where: { caseId }, orderBy: { sortOrder: "asc" } }),
  ]);

  const [caseCode] = await allocateCaseCodes("TPL", 4, 1);

  const created = await db.$transaction(async (tx) => {
    const created = await tx.case.create({
      data: {
        caseCode,
        title: `${caseRecord.title}（テンプレート）`,
        caseType: caseRecord.caseType,
        status: "DRAFT",
        timeProgressMode: timeProgressModeFor(caseRecord.caseType),
        sharingMode: "SOLO",
        resultTiming: caseRecord.resultTiming,
        patientName: caseRecord.patientName,
        patientAge: caseRecord.patientAge,
        patientGender: caseRecord.patientGender,
        ward: caseRecord.ward,
        bed: caseRecord.bed,
        visibilityScope: caseRecord.visibilityScope,
        historyScript: caseRecord.historyScript,
        examScript: caseRecord.examScript,
        crisisMode: caseRecord.crisisMode,
        createdByUserId: user.id,
        isTemplate: true,
      },
    });

    if (links.length > 0) {
      await tx.caseDiseaseLink.createMany({
        data: links.map((l) => ({
          caseId: created.id,
          templateId: l.templateId,
          isPrimary: l.isPrimary,
          physiologyParams: l.physiologyParams,
          pathogenId: l.pathogenId,
          relevantSpecimenSites: l.relevantSpecimenSites,
          sortOrder: l.sortOrder,
        })),
      });
    }
    if (problems.length > 0) {
      await tx.problem.createMany({
        data: problems.map((p) => ({ caseId: created.id, label: p.label, isPrimary: p.isPrimary, sortOrder: p.sortOrder })),
      });
    }

    return created;
  });

  await logAudit({
    userId: user.id,
    action: "case_template_from_case",
    targetType: "Case",
    targetId: created.id,
    detail: { sourceCaseId: caseId },
  });

  revalidatePath("/teacher/cases");
  revalidatePath("/teacher/case-templates");
  redirect("/teacher/case-templates");
}

// テンプレートから、指定した学年・所属に該当する学生全員分の症例を一括生成する中核処理。
export async function generateCasesFromTemplate(templateCaseId: string, formData: FormData) {
  const { user, caseRecord: template } = await requireOwnedTemplate(templateCaseId);

  const gradeRaw = String(formData.get("grade") ?? "").trim();
  const affiliationRaw = String(formData.get("affiliation") ?? "").trim();
  const intentRaw = String(formData.get("intent") ?? "draft");
  const intent: GenerateIntent = GENERATE_INTENTS.includes(intentRaw as GenerateIntent) ? (intentRaw as GenerateIntent) : "draft";
  const skipExisting = formData.get("skipExisting") === "on";
  const appendStudentName = formData.get("appendStudentName") === "on";
  const allStudents = formData.get("allStudents") === "on";

  // 学年・所属のどちらも指定が無く、かつ「全学生を対象にする」も未チェックなら誤爆防止のため中断する。
  if (!gradeRaw && !affiliationRaw && !allStudents) {
    redirect("/teacher/case-templates?error=no_filter");
  }

  const students = await db.user.findMany({
    where: {
      role: "STUDENT",
      ...(gradeRaw ? { grade: gradeRaw } : {}),
      ...(affiliationRaw ? { affiliation: affiliationRaw } : {}),
    },
    orderBy: { loginId: "asc" },
  });
  if (students.length === 0) {
    redirect("/teacher/case-templates?error=no_students");
  }

  let targets = students;
  let skippedCount = 0;
  if (skipExisting) {
    const already = await db.caseAssignment.findMany({
      where: { case: { templateSourceId: templateCaseId }, studentId: { in: students.map((s) => s.id) } },
      select: { studentId: true },
    });
    const alreadyIds = new Set(already.map((a) => a.studentId));
    targets = students.filter((s) => !alreadyIds.has(s.id));
    skippedCount = students.length - targets.length;
  }

  if (targets.length === 0) {
    revalidatePath("/teacher/case-templates");
    redirect(`/teacher/case-templates?generated=0&skipped=${skippedCount}`);
  }

  const [links, problems] = await Promise.all([
    db.caseDiseaseLink.findMany({ where: { caseId: templateCaseId }, orderBy: { sortOrder: "asc" } }),
    db.problem.findMany({ where: { caseId: templateCaseId }, orderBy: { sortOrder: "asc" } }),
  ]);

  const { prefix, digits } = caseCodePrefixFor(template.caseType);
  const codes = await allocateCaseCodes(prefix, digits, targets.length);

  const isPublish = intent === "publish";
  const now = new Date();

  for (let batchStart = 0; batchStart < targets.length; batchStart += GENERATE_BATCH_SIZE) {
    const batch = targets.slice(batchStart, batchStart + GENERATE_BATCH_SIZE);
    await db.$transaction(async (tx) => {
      for (let i = 0; i < batch.length; i++) {
        const student = batch[i];
        const caseCode = codes[batchStart + i];
        const title = appendStudentName ? `${template.title}（${student.name}）` : template.title;

        const created = await tx.case.create({
          data: {
            caseCode,
            title,
            caseType: template.caseType,
            status: isPublish ? (template.caseType === "SIMULATION" ? "SIMULATING" : "ACTIVE") : "DRAFT",
            timeProgressMode: timeProgressModeFor(template.caseType),
            sharingMode: "SOLO",
            resultTiming: template.resultTiming,
            patientName: template.patientName,
            patientAge: template.patientAge,
            patientGender: template.patientGender,
            ward: template.ward,
            bed: template.bed,
            visibilityScope: template.visibilityScope,
            historyScript: template.historyScript,
            examScript: template.examScript,
            crisisMode: template.crisisMode,
            crisisState: "STABLE",
            crisisStartedAt: null,
            simNowAt: null,
            createdByUserId: user.id,
            isTemplate: false,
            templateSourceId: templateCaseId,
            publishedAt: isPublish ? now : null,
          },
        });

        if (links.length > 0) {
          await tx.caseDiseaseLink.createMany({
            data: links.map((l) => ({
              caseId: created.id,
              templateId: l.templateId,
              isPrimary: l.isPrimary,
              physiologyParams: l.physiologyParams,
              pathogenId: l.pathogenId,
              relevantSpecimenSites: l.relevantSpecimenSites,
              sortOrder: l.sortOrder,
              // 生成のたびに重症度カーブの起点をこの瞬間へ揃える。テンプレート側のseverityBaselineAtを
              // そのまま引き継ぐと、テンプレート作成からの経過時間が未治療ドリフトとして積算されてしまう。
              severityBaselineAt: now,
              aiSeverityRatePerHour: null,
            })),
          });
        }
        if (problems.length > 0) {
          await tx.problem.createMany({
            data: problems.map((p) => ({ caseId: created.id, label: p.label, isPrimary: p.isPrimary, sortOrder: p.sortOrder })),
          });
        }
        await tx.caseAssignment.create({ data: { caseId: created.id, studentId: student.id } });
      }
    });
  }

  await logAudit({
    userId: user.id,
    action: "case_template_generate",
    targetType: "Case",
    targetId: templateCaseId,
    detail: { count: targets.length, skipped: skippedCount, intent, grade: gradeRaw || null, affiliation: affiliationRaw || null },
  });

  revalidatePath("/teacher/case-templates");
  revalidatePath("/teacher/cases");
  redirect(`/teacher/case-templates?generated=${targets.length}&skipped=${skippedCount}`);
}

// 下書きとして生成済みの症例をまとめて公開する。
export async function publishGeneratedCases(templateCaseId: string) {
  const { user } = await requireOwnedTemplate(templateCaseId);

  const draftCases = await db.case.findMany({
    where: { templateSourceId: templateCaseId, status: "DRAFT" },
    select: { id: true, caseType: true },
  });

  if (draftCases.length > 0) {
    const now = new Date();
    const ids = draftCases.map((c) => c.id);
    const simIds = draftCases.filter((c) => c.caseType === "SIMULATION").map((c) => c.id);
    const otherIds = draftCases.filter((c) => c.caseType !== "SIMULATION").map((c) => c.id);

    await db.$transaction(async (tx) => {
      if (simIds.length > 0) {
        await tx.case.updateMany({ where: { id: { in: simIds } }, data: { status: "SIMULATING", publishedAt: now } });
      }
      if (otherIds.length > 0) {
        await tx.case.updateMany({ where: { id: { in: otherIds } }, data: { status: "ACTIVE", publishedAt: now } });
      }
      // 公開の瞬間に重症度カーブ起点を揃える。理由・扱いはupdateCaseの公開処理と同じ
      // （下書き生成〜公開までの放置期間が未治療ドリフトとして積算されるのを防ぐ）。
      await tx.caseDiseaseLink.updateMany({ where: { caseId: { in: ids } }, data: { severityBaselineAt: now } });
    });

    await logAudit({
      userId: user.id,
      action: "case_template_publish_batch",
      targetType: "Case",
      targetId: templateCaseId,
      detail: { count: ids.length },
    });
  }

  revalidatePath("/teacher/case-templates");
  redirect(`/teacher/case-templates?published=${draftCases.length}`);
}
