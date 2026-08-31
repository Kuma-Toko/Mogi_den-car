"use client";

import { useState } from "react";
import { orderTypeLabel } from "@/lib/labels";
import { submitOrderBatch, type CartItem } from "./actions";
import { LabOrderDialog } from "./LabOrderDialog";
import { DrugOrderDialog } from "./DrugOrderDialog";
import { GeneralOrderDialog } from "./GeneralOrderDialog";

type LabItem = { id: string; name: string; category: string; subcategory: string | null };
type UsageTemplate = { id: string; label: string };

function cartItemLabel(item: Extract<CartItem, { kind: "LAB" | "GENERAL" }>): string {
  if (item.kind === "LAB") return item.label;
  const primary = item.selection || item.comment;
  return primary ? `${item.category}：${primary}` : item.category;
}

function cartItemSub(item: Extract<CartItem, { kind: "LAB" | "GENERAL" }>): string {
  if (item.kind === "LAB") return orderTypeLabel.LAB;
  const subComment = item.selection ? item.comment : "";
  return subComment ? `${orderTypeLabel.GENERAL}　${subComment}` : orderTypeLabel.GENERAL;
}

// カート内での同種Rp（処方Rp／注射Rp）の何番目かを、その種類のRp登場順から求める
function rpNumberFor(cart: CartItem[], index: number): number {
  const kind = cart[index].kind;
  let n = 0;
  for (let i = 0; i <= index; i++) {
    if (cart[i].kind === kind) n++;
  }
  return n;
}

export function OrderCard({
  caseId,
  labItems,
  usageTemplates,
  immediate,
}: {
  caseId: string;
  labItems: LabItem[];
  usageTemplates: UsageTemplate[];
  immediate: boolean;
}) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function addToCart(item: CartItem | CartItem[]) {
    setCart((prev) => [...prev, ...(Array.isArray(item) ? item : [item])]);
  }

  function removeFromCart(index: number) {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }

  async function confirmOrders() {
    if (cart.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await submitOrderBatch(caseId, cart);
      setCart([]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">オーダー入力</div>
      <div className="card-b">
        <div className="field" style={{ marginBottom: 12 }}>
          <label>結果取得タイミング（症例側の設定）</label>
          <div className="badge blue">
            {immediate ? "即時型：確定後すぐに結果が反映されます" : "遅延型：しばらくしてから結果が反映されます"}
          </div>
        </div>

        <div className="order-types">
          <LabOrderDialog labItems={labItems} onAdd={addToCart} />
          <DrugOrderDialog caseId={caseId} orderType="MEDICATION" usageTemplates={usageTemplates} onAdd={addToCart} />
          <DrugOrderDialog caseId={caseId} orderType="INJECTION" usageTemplates={usageTemplates} onAdd={addToCart} />
          <GeneralOrderDialog onAdd={addToCart} />
        </div>

        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700, margin: "14px 0 6px" }}>
          発行前のオーダー（{cart.length}件）
        </div>
        {cart.length === 0 ? (
          <div className="empty-note">上のボタンからオーダーを追加してください。</div>
        ) : (
          <>
            {cart.map((item, i) => {
              if (item.kind === "MEDICATION_RP" || item.kind === "INJECTION_RP") {
                const rpNumber = rpNumberFor(cart, i);
                const typeLabel = orderTypeLabel[item.kind === "INJECTION_RP" ? "INJECTION" : "MEDICATION"];
                const shared = item.kind === "INJECTION_RP" ? item.rate : item.instruction;
                return (
                  <div className="order-item rp-cart-item" key={i}>
                    <div>
                      <div className="name">
                        Rp.{rpNumber}（{typeLabel}）
                      </div>
                      {item.drugs.map((d, di) => (
                        <div className="sub" key={di}>
                          {[d.label, d.count, d.note].filter(Boolean).join("　")}
                        </div>
                      ))}
                      {(shared || item.comment) && (
                        <div className="sub">{[shared, item.comment].filter(Boolean).join("　/　")}</div>
                      )}
                    </div>
                    <button type="button" className="btn ghost" onClick={() => removeFromCart(i)}>
                      ✕
                    </button>
                  </div>
                );
              }
              return (
                <div className="order-item" key={i}>
                  <div>
                    <div className="name">{cartItemLabel(item)}</div>
                    <div className="sub">{cartItemSub(item)}</div>
                  </div>
                  <button type="button" className="btn ghost" onClick={() => removeFromCart(i)}>
                    ✕
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="btn primary"
              style={{ width: "100%", marginTop: 10 }}
              disabled={submitting}
              onClick={confirmOrders}
            >
              {submitting ? "発行中…" : `オーダーを確定する（${cart.length}件）`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
