import Link from "next/link";
import { redirect } from "next/navigation";
import type { CaseStatus, CrisisState } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime, formatRelative } from "@/lib/format";
import { findPrimaryDiseaseLink, getCurrentPrimarySeverity, reconcileCase } from "@/lib/engine";
import { getSeverityTier, type SeverityTier } from "@/lib/physiology-engine";

const CRISIS_LABEL: Record<CrisisState, string> = {
  STABLE: "安定",
  CRITICAL: "🚨 急変中",
  DECEASED: "死亡確認",
};
const CRISIS_BADGE: Record<CrisisState, string> = {
  STABLE: "teal",
  CRITICAL: "red",
  DECEASED: "dark",
};
const TIER_LABEL: Record<SeverityTier, string> = { mild: "軽症", moderate: "中等症", severe: "重症" };
const TIER_COLOR: Record<SeverityTier, string> = { mild: "var(--teal)", moderate: "var(--amber)", severe: "var(--red)" };

// 危機中(CRITICAL)を最優先、次に死亡(DECEASED)、その後は安定症例を重症度の高い順に並べる。
const CRISIS_SORT_RANK: Record<CrisisState, number> = { CRITICAL: 0, DECEASED: 1, STABLE: 2 };

export default async function TeacherDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "STUDENT") redirect("/patients");

  const caseWhere = {
    status: { in: ["ACTIVE", "SIMULATING"] as CaseStatus[] },
    ...(user.role === "ADMIN" ? {} : { createdByUserId: user.id }),
  };

  // 表示のたびに最新の重症度・急変状態を反映するため、対象症例を先に再計算する。
  const targetIds = await db.case.findMany({ where: caseWhere, select: { id: true } });
  for (const { id } of targetIds) {
    await reconcileCase(id);
  }

  const cases = await db.case.findMany({
    where: caseWhere,
    include: {
      diseaseLinks: { include: { template: true }, orderBy: { sortOrder: "asc" } },
      assignments: { include: { student: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = await Promise.all(
    cases.map(async (c) => {
      const primaryLink = findPrimaryDiseaseLink(c.diseaseLinks);
      const severity = await getCurrentPrimarySeverity(c.id);
      const tier = severity !== null ? getSeverityTier(severity) : null;
      return { case: c, primaryLink, severity, tier };
    })
  );

  rows.sort((a, b) => {
    const rankDiff = CRISIS_SORT_RANK[a.case.crisisState] - CRISIS_SORT_RANK[b.case.crisisState];
    if (rankDiff !== 0) return rankDiff;
    return (b.severity ?? -1) - (a.severity ?? -1);
  });

  const criticalCount = rows.filter((r) => r.case.crisisState === "CRITICAL").length;
  const deceasedCount = rows.filter((r) => r.case.crisisState === "DECEASED").length;
  const severeCount = rows.filter((r) => r.case.crisisState === "STABLE" && r.tier === "severe").length;

  return (
    <>
      <div className="topbar">
        <h1>重症度モニタ</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <div className="stat-row">
          <div className="stat">
            <div className="n">{rows.length}</div>
            <div className="l">進行中の症例数</div>
          </div>
          <div className="stat">
            <div className="n" style={{ color: criticalCount > 0 ? "var(--red)" : undefined }}>
              {criticalCount}
            </div>
            <div className="l">急変中</div>
          </div>
          <div className="stat">
            <div className="n">{severeCount}</div>
            <div className="l">重症（安定状態）</div>
          </div>
          <div className="stat">
            <div className="n">{deceasedCount}</div>
            <div className="l">死亡</div>
          </div>
        </div>

        <div className="card">
          <div className="card-h">症例別 重症度・状況</div>
          <div className="card-b" style={{ padding: 0 }}>
            {rows.length === 0 ? (
              <div className="empty-note">進行中（公開中・演習中）の症例はありません。</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>患者ID</th>
                    <th>患者名</th>
                    <th>主病態</th>
                    <th>状況</th>
                    <th>重症度</th>
                    <th>担当学生</th>
                    <th>最終更新</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ case: c, primaryLink, severity, tier }) => (
                    <tr className="row" key={c.id}>
                      <td>
                        <Link href={`/patients/${c.id}`}>{c.caseCode}</Link>
                      </td>
                      <td>
                        <Link href={`/patients/${c.id}`}>{c.patientName}</Link>
                      </td>
                      <td>{primaryLink?.template.name ?? "—"}</td>
                      <td>
                        <span className={`badge ${CRISIS_BADGE[c.crisisState]}`}>{CRISIS_LABEL[c.crisisState]}</span>
                      </td>
                      <td>
                        {severity !== null && tier ? (
                          <div className="severity-meter">
                            <div className="bar">
                              <span style={{ width: `${Math.round(severity)}%`, background: TIER_COLOR[tier] }} />
                            </div>
                            <span className="n">{Math.round(severity)}</span>
                            <span className="badge" style={{ background: "transparent", color: TIER_COLOR[tier], padding: 0 }}>
                              {TIER_LABEL[tier]}
                            </span>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{c.assignments.map((a) => a.student.name).join("、") || "—"}</td>
                      <td>{formatRelative(c.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
