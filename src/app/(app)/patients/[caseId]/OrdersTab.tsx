import { db } from "@/lib/db";
import { formatJaDateTimeShort } from "@/lib/format";
import { orderStatusBadgeClass, orderStatusLabel, orderTypeLabel } from "@/lib/labels";
import { OrderCard } from "./OrderCard";

function parseOrderComment(detail: string | null): string | null {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail) as { comment?: string };
    return parsed.comment ?? null;
  } catch {
    return null;
  }
}

export async function OrdersTab({ caseId }: { caseId: string }) {
  const [labItems, usageTemplates, orders, caseRecord] = await Promise.all([
    db.labItemMaster.findMany({ orderBy: [{ category: "asc" }, { subcategory: "asc" }, { name: "asc" }] }),
    db.usageTemplate.findMany({ orderBy: { sortOrder: "asc" } }),
    db.order.findMany({ where: { caseId }, orderBy: { orderedAt: "desc" } }),
    db.case.findUnique({ where: { id: caseId } }),
  ]);

  return (
    <div className="split">
      <div className="card">
        <div className="card-h">オーダー履歴</div>
        <div className="card-b">
          {orders.length === 0 ? (
            <div className="empty-note">オーダーはまだありません。</div>
          ) : (
            orders.map((o) => {
              const comment = parseOrderComment(o.detail);
              return (
                <div className="order-item" key={o.id}>
                  <div>
                    <div className="name">{o.label}</div>
                    <div className="sub">
                      {orderTypeLabel[o.orderType]}　{formatJaDateTimeShort(o.orderedAt)}
                      {comment && <>　/　{comment}</>}
                    </div>
                  </div>
                  <span className={`badge ${orderStatusBadgeClass[o.status]}`}>{orderStatusLabel[o.status]}</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      <OrderCard caseId={caseId} labItems={labItems} usageTemplates={usageTemplates} immediate={caseRecord?.resultTiming === "IMMEDIATE"} />
    </div>
  );
}
