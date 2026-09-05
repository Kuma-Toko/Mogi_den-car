import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime, formatRelative } from "@/lib/format";
import { redirect } from "next/navigation";
import { reconcileCasesForStudent } from "@/lib/engine";
import { ConfirmButton } from "@/components/ConfirmButton";
import { dischargeCase } from "./actions";

const PAGE_SIZE = 20;

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  await reconcileCasesForStudent(user.id);

  const { q, page: pageParam } = await searchParams;
  const query = q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const baseWhere = {
    status: { not: "DRAFT" as const },
    assignments: { some: { studentId: user.id, dischargedAt: null } },
  };
  const where = query
    ? {
        ...baseWhere,
        OR: [
          { caseCode: { contains: query } },
          { patientName: { contains: query } },
          { ward: { contains: query } },
          { bed: { contains: query } },
        ],
      }
    : baseWhere;

  const [assignedCount, totalCount, cases] = await Promise.all([
    db.case.count({ where: baseWhere }),
    db.case.count({ where }),
    db.case.findMany({
      where,
      include: {
        problems: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 1 },
        orders: { orderBy: { orderedAt: "desc" }, take: 20 },
        karteEntries: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

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

  const simulationCount = await db.case.count({ where: { ...baseWhere, caseType: "SIMULATION" } });

  function statusBadge(c: (typeof cases)[number]) {
    if (c.status === "SIMULATING") {
      return <span className="badge blue">演習中</span>;
    }
    if (c.orders.some((o) => o.status === "RESULT_AVAILABLE" || o.status === "RESULT_PRELIMINARY")) {
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
            <div className="n">{assignedCount}</div>
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
            担当患者（全{totalCount.toLocaleString()}件中{cases.length.toLocaleString()}件を表示）
            <div style={{ display: "flex", gap: 6 }}>
              <Link href="/patients/discharged" className="btn ghost" style={{ fontSize: 11 }}>
                退院済み患者
              </Link>
              <Link href="/patients/pool" className="btn ghost" style={{ fontSize: 11 }}>
                ＋ 症例プールから追加
              </Link>
            </div>
          </div>
          <div className="card-b" style={{ paddingBottom: 0 }}>
            <form method="get" style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                name="q"
                defaultValue={query}
                placeholder="患者ID・氏名・病棟/床で検索"
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn">
                検索
              </button>
              {query && (
                <a href="/patients" className="btn ghost">
                  条件をクリア
                </a>
              )}
            </form>
          </div>
          <div className="card-b" style={{ padding: 0 }}>
            {cases.length === 0 ? (
              <div className="empty-note">
                {query ? "条件に一致する患者がいません。" : "担当患者はまだいません。「症例プールから追加」から症例を選んでください。"}
              </div>
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
                    <th>操作</th>
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
                      <td>
                        <form>
                          <ConfirmButton
                            formAction={dischargeCase.bind(null, c.id)}
                            confirmText={`${c.patientName}を退院させますか？（担当患者一覧から外れます）`}
                            className="btn ghost"
                            actionLabel="退院させる"
                            actionClassName="btn primary"
                          >
                            退院
                          </ConfirmButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {totalPages > 1 && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", padding: "12px 0" }}>
              <a
                href={`/patients?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(Math.max(1, page - 1)) })}`}
                className={`btn ghost${page <= 1 ? " disabled" : ""}`}
                aria-disabled={page <= 1}
              >
                ← 前へ
              </a>
              <span style={{ fontSize: 12, color: "var(--ink-soft)", alignSelf: "center" }}>
                {page} / {totalPages}
              </span>
              <a
                href={`/patients?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(Math.min(totalPages, page + 1)) })}`}
                className={`btn ghost${page >= totalPages ? " disabled" : ""}`}
                aria-disabled={page >= totalPages}
              >
                次へ →
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
