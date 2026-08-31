import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime } from "@/lib/format";
import { CaseForm } from "./CaseForm";
import { parsePhysiologyParams } from "@/lib/physiology-engine";

export default async function NewCasePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "STUDENT") redirect("/patients");

  const templates = await db.diseaseTemplate.findMany({ orderBy: { createdAt: "asc" } });

  const templateProps = templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    defaultParams: parsePhysiologyParams(t.defaultParams),
  }));

  return (
    <>
      <div className="topbar">
        <h1>症例作成</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <CaseForm templates={templateProps} />
      </div>
    </>
  );
}
