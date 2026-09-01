import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime, formatRelative } from "@/lib/format";
import { redirect } from "next/navigation";
import { reconcileCasesForStudent } from "@/lib/engine";

export default async function PatientsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  await reconcileCasesForStudent(user.id);

  const cases = await db.case.findMany({
    where: { status: { not: "DRAFT" }, assignments: { some: { studentId: user.id } } },
    include: {
      problems: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 1 },
      orders: { orderBy: { orderedAt: "desc" }, take: 20 },
      karteEntries: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  const unreadNotifications = await db.notification.count({
    where: { userId: user.id, isRead: false },
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const ordersToday = await db.order.count({
    where: {
      orderedByUserId: user.id,
      orderedAt: { gte: todayStart },
    },
  });

  const simulationCount = cases.filter((c) => c.caseType === "SIMULATION").length;

  function statusBadge(c: (typeof cases)[number]) {
    if (c.status === "SIMULATING") {
      return <span className="badge blue">演習中</span>;
    }
    if (c.orders.some((o) => o.status === "RESULT_AVAILABLE")) {
      return <span className="badge red">新規結果あり</span>;
    }
    if (c.orders.some((o) => o.status === "RESULT_PENDING")) {
      return <span className="badge amber">結果待ちあり</span>;
    }
    return <span className="badge teal">安定</span>;
  }

  function lastUpdated(c: (typeof cases)[number]) {
    const dates = [c.updatedAt, ...c.orders.map((o) => o.orderedAt), ...c.karteEntries.map((s) => s.createdAt)];
    const latest = dates.reduce((a, b) => (b > a ? b : a));
    return c.timeProgressMode === "MANUAL" ? "手動進行" : formatRelative(latest);
  }

  return (
    <>
      <div className="topbar">
        <h1>担当患者一覧</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <div className="stat-row">
          <div className="stat">
            <div className="n">{cases.length}</div>
            <div className="l">担当患者数</div>
          </div>
          <div className="stat">
            <div className="n">{unreadNotifications}</div>
            <div className="l">未確認の新規結果</div>
          </div>
          <div className="stat">
            <div className="n">{ordersToday}</div>
            <div className="l">本日のオーダー件数</div>
          </div>
          <div className="stat">
            <div className="n">{simulationCount}</div>
            <div className="l">シミュレーション症例</div>
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            担当患者
            <Link href="/patients/pool" className="btn ghost" style={{ fontSize: 11 }}>
              ＋ 症例プールから追加
            </Link>
          </div>
          <div className="card-b" style={{ padding: 0 }}>
            {cases.length === 0 ? (
              <div className="empty-note">担当患者はまだいません。「症例プールから追加」から症例を選んでください。</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>患者ID</th>
                    <th>氏名（模擬）</th>
                    <th>年齢/性別</th>
                    <th>病棟/床</th>
                    <th>主なプロブレム</th>
                    <th>状態</th>
                    <th>最終更新</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr className="row" key={c.id}>
                      <td>
                        <Link href={`/patients/${c.id}`}>{c.caseCode}</Link>
                      </td>
                      <td>
                        <Link href={`/patients/${c.id}`}>{c.patientName}</Link>
                      </td>
                      <td>
                        {c.patientAge}歳/{c.patientGender}
                      </td>
                      <td>
                        {c.ward ?? "—"} {c.bed ? `/ ${c.bed}` : ""}
                      </td>
                      <td>{c.problems[0]?.label ?? "—"}</td>
                      <td>{statusBadge(c)}</td>
                      <td>{lastUpdated(c)}</td>
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
