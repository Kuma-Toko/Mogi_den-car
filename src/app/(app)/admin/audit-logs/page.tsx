import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime, formatJaDateTimeShort } from "@/lib/format";
import { auditActionLabel, auditTargetTypeLabel } from "@/lib/labels";

const COLS = "1fr 1fr 1.3fr 1.3fr 1.6fr";
const DISPLAY_LIMIT = 300;

export default async function AdminAuditLogsPage() {
  await requireAdmin();

  const logs = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: DISPLAY_LIMIT,
    include: { user: true },
  });

  return (
    <>
      <div className="topbar">
        <h1>監査ログ</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <div className="card">
          <div className="card-h">
            操作履歴（最新{logs.length}件{logs.length === DISPLAY_LIMIT ? `・上限${DISPLAY_LIMIT}件まで表示` : ""}）
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
              <div className="empty-note">記録はまだありません。</div>
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
        </div>
      </div>
    </>
  );
}
