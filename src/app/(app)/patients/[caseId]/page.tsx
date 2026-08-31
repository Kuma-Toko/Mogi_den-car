import Link from "next/link";
import { requireCaseAccess } from "@/lib/case-access";
import { reconcileCase } from "@/lib/engine";
import { db } from "@/lib/db";
import { SummaryTab } from "./SummaryTab";
import { SoapTab } from "./SoapTab";
import { OrdersTab } from "./OrdersTab";
import { ResultsTab } from "./ResultsTab";
import { VitalsTab } from "./VitalsTab";
import { SimTimeControl } from "./SimTimeControl";

const TABS = [
  { key: "summary", label: "サマリ" },
  { key: "soap", label: "カルテ記載" },
  { key: "orders", label: "オーダー" },
  { key: "results", label: "検査結果" },
  { key: "vitals", label: "バイタル・経過" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function CaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { caseId } = await params;
  const { tab: tabParam } = await searchParams;
  const { case: caseRecord } = await requireCaseAccess(caseId);

  await reconcileCase(caseId);

  const primaryProblem = await db.problem.findFirst({
    where: { caseId },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
  });

  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "summary";

  return (
    <>
      <div className="topbar">
        <h1>
          {caseRecord.patientName}（{caseRecord.caseCode}）
        </h1>
        <div className="meta">
          {caseRecord.timeProgressMode === "MANUAL" ? "手動進行（シミュレーション）" : "実時間進行"}
        </div>
      </div>
      <div className="content">
        <div className="patient-strip">
          <div>
            <b>{caseRecord.patientName}</b>　{caseRecord.patientAge}歳 {caseRecord.patientGender}
          </div>
          <div>
            病棟：{caseRecord.ward ?? "—"} {caseRecord.bed ? `/ ${caseRecord.bed}` : ""}
          </div>
          <div>プロブレム：{primaryProblem?.label ?? "未登録"}</div>
        </div>

        <SimTimeControl caseId={caseId} caseRecord={caseRecord} />

        <div className="tabs">
          {TABS.map((t) => (
            <Link key={t.key} href={`/patients/${caseId}?tab=${t.key}`} className={tab === t.key ? "on" : ""}>
              {t.label}
            </Link>
          ))}
        </div>

        {tab === "summary" && <SummaryTab caseId={caseId} />}
        {tab === "soap" && <SoapTab caseId={caseId} />}
        {tab === "orders" && <OrdersTab caseId={caseId} />}
        {tab === "results" && <ResultsTab caseId={caseId} />}
        {tab === "vitals" && <VitalsTab caseId={caseId} />}
      </div>
    </>
  );
}
