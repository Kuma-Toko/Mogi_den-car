import { db } from "@/lib/db";
import { formatJaDateTimeShort } from "@/lib/format";
import { orderStatusBadgeClass, orderStatusLabel, orderTypeLabel } from "@/lib/labels";
import { packageInsertSearchUrl } from "@/lib/packageInsert";
import { ConfirmButton } from "@/components/ConfirmButton";
import { OrderCard } from "./OrderCard";
import { EditRpDialog } from "./EditRpDialog";
import { discontinueOrder } from "./actions";

const DRUG_ORDER_TYPES = new Set(["MEDICATION", "INJECTION"]);
const ORDER_HISTORY_PAGE_SIZE = 20;

type OrderRow = Awaited<ReturnType<typeof loadOrders>>[number];

function loadOrders(caseId: string, query: string) {
  return db.order.findMany({
    where: query
      ? {
          caseId,
          OR: [{ label: { contains: query } }, { drug: { is: { name: { contains: query } } } }],
        }
      : { caseId },
    orderBy: { orderedAt: "desc" },
    include: { drug: { select: { name: true } }, orderedBy: { select: { name: true } } },
  });
}

type OrderDetail = {
  comment?: string;
  instruction?: string;
  rate?: string;
  note?: string;
  count?: string;
  dosingType?: string;
  duration?: string;
  administrationType?: string;
  startTime?: string;
};

// countは"${qty}${unit}"の形式でDrugOrderDialog.tsxが生成しているため、先頭の数値と単位に分解する。
function splitCount(count: string | undefined): { qty: string; unit: string } {
  if (!count) return { qty: "", unit: "" };
  const m = count.match(/^(\d+(?:\.\d+)?)(.*)$/);
  return m ? { qty: m[1], unit: m[2] } : { qty: "", unit: "" };
}

function parseDetail(detail: string | null): OrderDetail {
  if (!detail) return {};
  try {
    return JSON.parse(detail) as OrderDetail;
  } catch {
    return {};
  }
}

// Rp（rpGroupId）でまとめた薬剤オーダーは1ブロックとして表示し、それ以外（検査・一般指示・移行前データ）は
// 従来どおり1件ずつ表示する。
function groupOrders(orders: OrderRow[]): OrderRow[][] {
  const groups = new Map<string, OrderRow[]>();
  const keys: string[] = [];
  for (const o of orders) {
    const key = o.rpGroupId ?? `single-${o.id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      keys.push(key);
    }
    groups.get(key)!.push(o);
  }
  return keys.map((k) => groups.get(k)!);
}

// ConfirmButtonは確認状態で <button type="submit" formAction={...}> を描画するため、
// form の所有者が無いとクリックしても何も起きない（他のConfirmButton利用箇所も全て<form>で囲んでいる）。
function DiscontinueButton({ caseId, orderId }: { caseId: string; orderId: string }) {
  return (
    <form>
      <ConfirmButton
        formAction={discontinueOrder.bind(null, caseId, orderId)}
        confirmText="このオーダーを中止しますか？"
        className="btn ghost"
        actionLabel="中止する"
        actionClassName="btn danger"
      >
        中止
      </ConfirmButton>
    </form>
  );
}

export async function OrdersTab({
  caseId,
  query,
  page: pageParam,
}: {
  caseId: string;
  query?: string;
  page?: string;
}) {
  const q = query?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const [labItems, usageTemplates, orders, caseRecord] = await Promise.all([
    db.labItemMaster.findMany({ orderBy: { sortOrder: "asc" } }),
    db.usageTemplate.findMany({ orderBy: { sortOrder: "asc" } }),
    loadOrders(caseId, q),
    db.case.findUnique({ where: { id: caseId } }),
  ]);

  const allGroups = groupOrders(orders);
  const totalGroups = allGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalGroups / ORDER_HISTORY_PAGE_SIZE));
  const groups = allGroups.slice((page - 1) * ORDER_HISTORY_PAGE_SIZE, page * ORDER_HISTORY_PAGE_SIZE);

  function historyHref(params: { q?: string; page?: number }) {
    const sp = new URLSearchParams({ tab: "orders" });
    if (params.q) sp.set("oq", params.q);
    if (params.page && params.page > 1) sp.set("opage", String(params.page));
    return `/patients/${caseId}?${sp}`;
  }

  return (
    <div className="split">
      <OrderCard
        caseId={caseId}
        labItems={labItems}
        usageTemplates={usageTemplates}
        immediate={caseRecord?.resultTiming === "IMMEDIATE"}
        deceased={caseRecord?.crisisState === "DECEASED"}
      />

      <div className="card">
        <div className="card-h">オーダー履歴（全{totalGroups.toLocaleString()}件中{groups.length.toLocaleString()}件を表示）</div>
        <div className="card-b">
          <form method="get" action={`/patients/${caseId}`} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input type="hidden" name="tab" value="orders" />
            <input type="text" name="oq" defaultValue={q} placeholder="薬剤名・オーダー名で検索" style={{ flex: 1 }} />
            <button type="submit" className="btn">
              検索
            </button>
            {q && (
              <a href={historyHref({})} className="btn ghost">
                条件をクリア
              </a>
            )}
          </form>
          {orders.length === 0 ? (
            <div className="empty-note">{q ? "条件に一致するオーダーがありません。" : "オーダーはまだありません。"}</div>
          ) : (
            groups.map((group) => {
              const first = group[0];
              if (first.rpGroupId) {
                const { instruction, rate, comment, dosingType, duration, administrationType, startTime } = parseDetail(
                  first.detail
                );
                const shared =
                  first.orderType === "INJECTION" ? [rate, startTime].filter(Boolean).join("　") : instruction;
                const subTag =
                  first.orderType === "INJECTION"
                    ? administrationType
                    : [dosingType, duration].filter(Boolean).join("・");
                return (
                  <div className="rp-block" key={first.rpGroupId}>
                    <div className="rp-block-h">
                      {first.rpLabel}（{orderTypeLabel[first.orderType]}）　{formatJaDateTimeShort(first.orderedAt)}
                      　{first.orderedBy.name}
                      {subTag && <>　{subTag}</>}
                    </div>
                    {group.map((o) => {
                      const { note } = parseDetail(o.detail);
                      return (
                        <div className="rp-drug-item" key={o.id}>
                          <div className="order-item">
                            <div className="name">
                              {o.label}
                              <a
                                className="insert-link"
                                href={packageInsertSearchUrl(o.label)}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                添付文書 ↗
                              </a>
                            </div>
                            <span className={`badge ${orderStatusBadgeClass[o.status]}`}>{orderStatusLabel[o.status]}</span>
                            {DRUG_ORDER_TYPES.has(o.orderType) && !o.discontinuedAt && (
                              <DiscontinueButton caseId={caseId} orderId={o.id} />
                            )}
                          </div>
                          {note && <div className="rp-drug-note">{note}</div>}
                        </div>
                      );
                    })}
                    {(shared || comment) && (
                      <div className="rp-instruction">{[shared, comment].filter(Boolean).join("　/　")}</div>
                    )}
                    {DRUG_ORDER_TYPES.has(first.orderType) && group.every((o) => !o.discontinuedAt) && (
                      <div style={{ marginTop: 6 }}>
                        <EditRpDialog
                          caseId={caseId}
                          rpGroupId={first.rpGroupId}
                          orderType={first.orderType as "MEDICATION" | "INJECTION"}
                          rpLabel={first.rpLabel ?? orderTypeLabel[first.orderType]}
                          lines={group.map((o) => {
                            const d = parseDetail(o.detail);
                            const { qty, unit } = splitCount(d.count);
                            return { orderId: o.id, drugLabel: o.drug?.name ?? o.label, qty, unit, note: d.note ?? "" };
                          })}
                          instruction={instruction ?? ""}
                          dosingType={(dosingType as "定期" | "頓用") ?? "定期"}
                          duration={duration ?? ""}
                          administrationType={(administrationType as "単回静注" | "持続点滴") ?? "単回静注"}
                          rate={rate ?? ""}
                          startTime={startTime ?? ""}
                          comment={comment ?? ""}
                        />
                      </div>
                    )}
                  </div>
                );
              }

              const { comment } = parseDetail(first.detail);
              return (
                <div className="order-item" key={first.id}>
                  <div>
                    <div className="name">
                      {first.label}
                      {DRUG_ORDER_TYPES.has(first.orderType) && (
                        <a
                          className="insert-link"
                          href={packageInsertSearchUrl(first.label)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          添付文書 ↗
                        </a>
                      )}
                    </div>
                    <div className="sub">
                      {orderTypeLabel[first.orderType]}　{formatJaDateTimeShort(first.orderedAt)}　{first.orderedBy.name}
                      {comment && <>　/　{comment}</>}
                    </div>
                  </div>
                  <span className={`badge ${orderStatusBadgeClass[first.status]}`}>{orderStatusLabel[first.status]}</span>
                  {DRUG_ORDER_TYPES.has(first.orderType) && !first.discontinuedAt && (
                    <DiscontinueButton caseId={caseId} orderId={first.id} />
                  )}
                </div>
              );
            })
          )}
          {totalPages > 1 && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", padding: "12px 0" }}>
              <a
                href={historyHref({ q, page: Math.max(1, page - 1) })}
                className={`btn ghost${page <= 1 ? " disabled" : ""}`}
                aria-disabled={page <= 1}
              >
                ← 前へ
              </a>
              <span style={{ fontSize: 12, color: "var(--ink-soft)", alignSelf: "center" }}>
                {page} / {totalPages}
              </span>
              <a
                href={historyHref({ q, page: Math.min(totalPages, page + 1) })}
                className={`btn ghost${page >= totalPages ? " disabled" : ""}`}
                aria-disabled={page >= totalPages}
              >
                次へ →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
