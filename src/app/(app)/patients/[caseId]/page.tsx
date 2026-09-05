import Link from "next/link";
import { requireCaseAccess } from "@/lib/case-access";
import { findPrimaryDiseaseLink, getCurrentPrimarySeverity, reconcileCase } from "@/lib/engine";
import { db } from "@/lib/db";
import { CrisisBanner } from "./CrisisBanner";
import { SummaryTab } from "./SummaryTab";
import { KarteTab } from "./KarteTab";
import { KarteEntryTab } from "./KarteEntryTab";
import { EncounterTab } from "./EncounterTab";
import { KarteReferencePanel } from "./KarteReferencePanel";
import { OrdersTab } from "./OrdersTab";
import { ResultsTab } from "./ResultsTab";
import { VitalsTab } from "./VitalsTab";
import { SimTimeControl } from "./SimTimeControl";
import { DischargeTab } from "./DischargeTab";

const TABS = [
  { key: "summary", label: "サマリ" },
  { key: "encounter", label: "問診・診察" },
  { key: "karte", label: "カルテ" },
  { key: "karte-entry", label: "カルテ記載" },
  { key: "orders", label: "オーダー" },
  { key: "results", label: "検査結果" },
  { key: "vitals", label: "バイタル・経過" },
  { key: "discharge", label: "退院" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const ERROR_MESSAGES: Record<string, string> = {
  last_disease: "症例には最低1件の病態が必要なため、最後の病態は削除できません。",
};

export default async function CaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ tab?: string; error?: string }>;
}) {
  const { caseId } = await params;
  const { tab: tabParam, error } = await searchParams;
  const { user, case: caseRecord } = await requireCaseAccess(caseId);
  const canManage = user.role !== "STUDENT";

  await reconcileCase(caseId);

  // reconcileCase()がこのリクエスト中にcrisisStateを更新している可能性があるため、
  // requireCaseAccess()で取得した（reconcile前の）caseRecordとは別に最新状態を取り直す。
  const crisisCaseRecord = await db.case.findUnique({
    where: { id: caseId },
    include: { diseaseLinks: { include: { template: true }, orderBy: { sortOrder: "asc" } } },
  });
  const primaryDiseaseLink = crisisCaseRecord ? findPrimaryDiseaseLink(crisisCaseRecord.diseaseLinks) : null;
  // 危機病態も発火後は主病態そのものになるため、専用の名前フィールドは持たず主病態テンプレートの名前を使う。
  const crisisSeverity =
    crisisCaseRecord && crisisCaseRecord.crisisState !== "STABLE" ? await getCurrentPrimarySeverity(caseId) : null;

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
        {error && ERROR_MESSAGES[error] && (
          <div className="banner-error" style={{ marginBottom: 14 }}>
            {ERROR_MESSAGES[error]}
          </div>
        )}
        {crisisCaseRecord && crisisCaseRecord.crisisState !== "STABLE" && (
          <CrisisBanner
            crisisState={crisisCaseRecord.crisisState}
            crisisMode={crisisCaseRecord.crisisMode}
            scenarioName={primaryDiseaseLink?.template.name ?? "急変"}
            severity={crisisSeverity}
          />
        )}
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

        {tab === "summary" && <SummaryTab caseId={caseId} canManageDiseases={canManage} currentUserId={user.id} />}
        {tab === "karte" && <KarteTab caseId={caseId} />}
        {tab === "karte-entry" && (
          <div className="split">
            <KarteEntryTab caseId={caseId} />
            <KarteReferencePanel caseId={caseId} />
          </div>
        )}
        {tab === "encounter" && <EncounterTab caseId={caseId} />}
        {tab === "orders" && <OrdersTab caseId={caseId} />}
        {tab === "results" && <ResultsTab caseId={caseId} />}
        {tab === "vitals" && <VitalsTab caseId={caseId} />}
        {tab === "discharge" && (
          <DischargeTab caseId={caseId} currentUserId={user.id} currentUserRole={user.role} />
        )}
      </div>
    </>
  );
}
