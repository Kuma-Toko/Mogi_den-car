import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { formatJaDateTime, formatJaDateTimeShort } from "@/lib/format";
import { auditActionLabel, auditTargetTypeLabel } from "@/lib/labels";

const COLS = "1fr 1fr 1.3fr 1.3fr 1.6fr";
const PAGE_SIZE = 50;

function buildQueryString(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, value);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default async function AdminAuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; from?: string; to?: string; page?: string }>;
}) {
  await requireAdmin();
  const { q, from, to, page: pageParam } = await searchParams;

  const query = q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const where: Prisma.AuditLogWhereInput = {};

  if (query) {
    // 操作名は日本語ラベルと生のaction文字列のどちらでも検索できるようにする
    const matchingActions = Object.entries(auditActionLabel)
      .filter(([action, label]) => label.includes(query) || action.includes(query))
      .map(([action]) => action);

    where.OR = [
      { action: { contains: query } },
      ...(matchingActions.length > 0 ? [{ action: { in: matchingActions } }] : []),
      { targetId: { contains: query } },
      { user: { is: { OR: [{ name: { contains: query } }, { loginId: { contains: query } }] } } },
    ];
  }

  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(`${from}T00:00:00`);
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59.999`);
  }

  const [totalCount, logs] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const baseParams = { q: query || undefined, from, to };

  return (
    <>
      <div className="topbar">
        <h1>監査ログ</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <div className="card">
          <div className="card-h">
            操作履歴（全{totalCount.toLocaleString()}件中 {logs.length.toLocaleString()}件を表示・{page}/{totalPages}ページ）
          </div>
          <div className="card-b">
            <form method="get" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="text"
                name="q"
                defaultValue={query}
                placeholder="ユーザー名・ログインID・操作・対象IDで検索"
                style={{ flex: 1, minWidth: 220 }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                期間
                <input type="date" name="from" defaultValue={from ?? ""} />
                〜
                <input type="date" name="to" defaultValue={to ?? ""} />
              </label>
              <button type="submit" className="btn">
                検索
              </button>
              {(query || from || to) && (
                <a href="/admin/audit-logs" className="btn ghost">
                  条件をクリア
                </a>
              )}
            </form>
          </div>
          <div className="mrow-wrap">
            <div className="mrow head" style={{ gridTemplateColumns: COLS }}>
              <div>日時</div>
              <div>ユーザー</div>
              <div>操作</div>
              <div>対象</div>
              <div>詳細</div>
            </div>
            {logs.length === 0 ? (
              <div className="empty-note">条件に一致する記録がありません。</div>
            ) : (
              logs.map((log) => (
                <div className="mrow" key={log.id} style={{ gridTemplateColumns: COLS }}>
                  <div>{formatJaDateTimeShort(log.createdAt)}</div>
                  <div>{log.user ? `${log.user.name}（${log.user.loginId}）` : "—"}</div>
                  <div>{auditActionLabel[log.action] ?? log.action}</div>
                  <div>
                    {log.targetType ? (auditTargetTypeLabel[log.targetType] ?? log.targetType) : "—"}
                    {log.targetId && (
                      <span style={{ color: "var(--ink-soft)", fontSize: 10 }}> #{log.targetId.slice(-6)}</span>
                    )}
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--ink-soft)", wordBreak: "break-all" }}>
                    {log.detail ?? ""}
                  </div>
                </div>
              ))
            )}
          </div>
          {totalPages > 1 && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", padding: "12px 0" }}>
              <a
                href={`/admin/audit-logs${buildQueryString({ ...baseParams, page: String(Math.max(1, page - 1)) })}`}
                className={`btn ghost${page <= 1 ? " disabled" : ""}`}
                aria-disabled={page <= 1}
              >
                ← 前へ
              </a>
              <span style={{ fontSize: 12, color: "var(--ink-soft)", alignSelf: "center" }}>
                {page} / {totalPages}
              </span>
              <a
                href={`/admin/audit-logs${buildQueryString({ ...baseParams, page: String(Math.min(totalPages, page + 1)) })}`}
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
