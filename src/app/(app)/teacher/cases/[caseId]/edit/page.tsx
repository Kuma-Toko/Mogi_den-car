import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime } from "@/lib/format";
import { parsePhysiologyParams } from "@/lib/physiology-engine";
import { CaseForm, type CaseFormInitial } from "../../CaseForm";
import { updateCase } from "../../actions";

export default async function EditCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "STUDENT") redirect("/patients");

  const [caseRecord, templates] = await Promise.all([
    db.case.findUnique({
      where: { id: caseId },
      include: {
        problems: { orderBy: { sortOrder: "asc" } },
        assignments: { include: { student: true } },
        diseaseLinks: { orderBy: { sortOrder: "asc" } },
      },
    }),
    db.diseaseTemplate.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  if (!caseRecord) notFound();
  if (user.role === "TEACHER" && caseRecord.createdByUserId !== user.id) redirect("/teacher/cases");

  const templateProps = templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    defaultParams: parsePhysiologyParams(t.defaultParams),
  }));

  const primaryLink = caseRecord.diseaseLinks.find((l) => l.isPrimary) ?? caseRecord.diseaseLinks[0] ?? null;
  const physiologyParamsByTemplate = Object.fromEntries(
    caseRecord.diseaseLinks.map((l) => [l.templateId, parsePhysiologyParams(l.physiologyParams)])
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
    sharingMode: caseRecord.sharingMode === "TEAM" ? "TEAM" : "SOLO",
    crisisMode: caseRecord.crisisMode,
    physiologyParamsByTemplate,
    assigneeLoginIds: caseRecord.assignments.map((a) => a.student.loginId).join(", "),
  };

  return (
    <>
      <div className="topbar">
        <h1>症例編集：{caseRecord.title}</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <CaseForm templates={templateProps} mode="edit" action={updateCase.bind(null, caseId)} initial={initial} />
      </div>
    </>
  );
}
