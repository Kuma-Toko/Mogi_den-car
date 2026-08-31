import { db } from "@/lib/db";
import { formatJaDateTimeShort } from "@/lib/format";
import { orderStatusBadgeClass, orderStatusLabel, orderTypeLabel } from "@/lib/labels";

export async function SummaryTab({ caseId }: { caseId: string }) {
  const [problems, latestNote, recentOrders] = await Promise.all([
    db.problem.findMany({ where: { caseId }, orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] }),
    db.soapNote.findFirst({ where: { caseId }, orderBy: { createdAt: "desc" }, include: { author: true } }),
    db.order.findMany({ where: { caseId }, orderBy: { orderedAt: "desc" }, take: 5 }),
  ]);

  return (
    <div className="split">
      <div className="card">
        <div className="card-h">プロブレムリスト</div>
        <div className="card-b">
          {problems.length === 0 ? (
            <div className="empty-note">プロブレムは未登録です。</div>
          ) : (
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {problems.map((p) => (
                <li key={p.id} style={{ marginBottom: 6, fontSize: 12.5 }}>
                  {p.label}
                  {p.isPrimary && (
                    <span className="badge teal" style={{ marginLeft: 6 }}>
                      主病態
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card-h" style={{ borderTop: "1px solid var(--line-soft)" }}>
          直近のカルテ記載
        </div>
        <div className="card-b">
          {latestNote ? (
            <div style={{ fontSize: 12.5 }}>
              <div style={{ color: "var(--ink-soft)", fontSize: 11, marginBottom: 6 }}>
                {formatJaDateTimeShort(latestNote.createdAt)}　{latestNote.author.name}
              </div>
              {latestNote.subjective && <p style={{ marginBottom: 4 }}>S: {latestNote.subjective}</p>}
              {latestNote.objective && <p style={{ marginBottom: 4 }}>O: {latestNote.objective}</p>}
              {latestNote.assessment && <p style={{ marginBottom: 4 }}>A: {latestNote.assessment}</p>}
              {latestNote.plan && <p>P: {latestNote.plan}</p>}
            </div>
          ) : (
            <div className="empty-note">カルテ記載はまだありません。「カルテ記載」タブから記入してください。</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h">直近のオーダー</div>
        <div className="card-b">
          {recentOrders.length === 0 ? (
            <div className="empty-note">オーダーはまだありません。</div>
          ) : (
            recentOrders.map((o) => (
              <div className="order-item" key={o.id}>
                <div>
                  <div className="name">{o.label}</div>
                  <div className="sub">{orderTypeLabel[o.orderType]}</div>
                </div>
                <span className={`badge ${orderStatusBadgeClass[o.status]}`}>{orderStatusLabel[o.status]}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
