import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime } from "@/lib/format";
import { CaseForm } from "../../cases/CaseForm";
import { createCaseTemplate } from "../actions";
import { parsePhysiologyParams } from "@/lib/physiology-engine";
import { sortTemplatesByCategory } from "@/lib/pathology-categories";

export default async function NewCaseTemplatePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "STUDENT") redirect("/patients");

  const [templatesUnsorted, pathogens] = await Promise.all([
    db.diseaseTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    db.pathogenMaster.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  const templates = sortTemplatesByCategory(templatesUnsorted);

  const templateProps = templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    defaultParams: parsePhysiologyParams(t.defaultParams),
    isInfectious: t.isInfectious,
  }));

  return (
    <>
      <div className="topbar">
        <h1>症例テンプレート作成</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <CaseForm templates={templateProps} pathogens={pathogens} variant="template" action={createCaseTemplate} />
      </div>
    </>
  );
}
