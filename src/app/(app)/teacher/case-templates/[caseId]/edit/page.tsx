import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime } from "@/lib/format";
import { parsePhysiologyParams } from "@/lib/physiology-engine";
import { CaseForm, type CaseFormInitial } from "../../../cases/CaseForm";
import { updateCaseTemplate } from "../../actions";
import { sortTemplatesByCategory } from "@/lib/pathology-categories";

export default async function EditCaseTemplatePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "STUDENT") redirect("/patients");

  const [caseRecord, templates, pathogens] = await Promise.all([
    db.case.findUnique({
      where: { id: caseId },
      include: {
        problems: { orderBy: { sortOrder: "asc" } },
        diseaseLinks: { orderBy: { sortOrder: "asc" } },
      },
    }),
    db.diseaseTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    db.pathogenMaster.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!caseRecord || !caseRecord.isTemplate) notFound();
  if (user.role === "TEACHER" && caseRecord.createdByUserId !== user.id) redirect("/teacher/case-templates");

  const templateProps = sortTemplatesByCategory(templates).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    defaultParams: parsePhysiologyParams(t.defaultParams),
    isInfectious: t.isInfectious,
  }));

  const primaryLink = caseRecord.diseaseLinks.find((l) => l.isPrimary) ?? caseRecord.diseaseLinks[0] ?? null;
  const physiologyParamsByTemplate = Object.fromEntries(
    caseRecord.diseaseLinks.map((l) => [l.templateId, parsePhysiologyParams(l.physiologyParams)])
  );
  const pathogenIdByTemplate = Object.fromEntries(
    caseRecord.diseaseLinks.filter((l) => l.pathogenId).map((l) => [l.templateId, l.pathogenId as string])
  );
  const relevantSpecimenSitesByTemplate: Record<string, string[] | null> = Object.fromEntries(
    caseRecord.diseaseLinks
      .filter((l) => l.relevantSpecimenSites)
      .map((l) => {
        try {
          const parsed = JSON.parse(l.relevantSpecimenSites as string);
          return [l.templateId, Array.isArray(parsed) ? (parsed as string[]) : null];
        } catch {
          return [l.templateId, null];
        }
      })
  );

  const initial: CaseFormInitial = {
    status: caseRecord.status,
    caseType: caseRecord.caseType,
    title: caseRecord.title,
    patientName: caseRecord.patientName,
    patientAge: caseRecord.patientAge,
    patientGender: caseRecord.patientGender,
    ward: caseRecord.ward ?? "",
    bed: caseRecord.bed ?? "",
    visibilityScope: caseRecord.visibilityScope ?? "",
    problems: caseRecord.problems.map((p) => p.label).join(", "),
    historyScript: caseRecord.historyScript ?? "",
    examScript: caseRecord.examScript ?? "",
    diseaseTemplateIds: caseRecord.diseaseLinks.map((l) => l.templateId),
    primaryTemplateId: primaryLink?.templateId ?? null,
    resultTiming: caseRecord.resultTiming === "DELAYED" ? "DELAYED" : "IMMEDIATE",
    sharingMode: "SOLO",
    crisisMode: caseRecord.crisisMode,
    physiologyParamsByTemplate,
    pathogenIdByTemplate,
    relevantSpecimenSitesByTemplate,
    assigneeLoginIds: "",
  };

  return (
    <>
      <div className="topbar">
        <h1>症例テンプレート編集：{caseRecord.title}</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <CaseForm
          templates={templateProps}
          pathogens={pathogens}
          mode="edit"
          variant="template"
          action={updateCaseTemplate.bind(null, caseId)}
          initial={initial}
        />
      </div>
    </>
  );
}
