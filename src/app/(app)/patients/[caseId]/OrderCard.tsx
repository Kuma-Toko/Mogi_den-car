"use client";

import { useState } from "react";
import { orderTypeLabel } from "@/lib/labels";
import { submitOrderBatch, type CartItem } from "./actions";
import { LabOrderDialog } from "./LabOrderDialog";
import { DrugOrderDialog } from "./DrugOrderDialog";
import { GeneralOrderDialog } from "./GeneralOrderDialog";

type LabItem = { id: string; name: string; category: string; subcategory: string | null };
type UsageTemplate = { id: string; label: string };

function cartItemLabel(item: CartItem): string {
  if (item.kind === "LAB") return item.label;
  if (item.kind === "GENERAL") {
    const primary = item.selection || item.comment;
    return primary ? `${item.category}：${primary}` : item.category;
  }
  const secondary = item.kind === "INJECTION" ? item.rate : item.usage;
  const detail = [item.dosage, secondary].filter(Boolean).join("　");
  return detail ? `${item.label}　${detail}` : item.label;
}

function cartItemSub(item: CartItem): string {
  if (item.kind === "LAB") return orderTypeLabel.LAB;
  if (item.kind === "GENERAL") {
    const subComment = item.selection ? item.comment : "";
    return subComment ? `${orderTypeLabel.GENERAL}　${subComment}` : orderTypeLabel.GENERAL;
  }
  const base = orderTypeLabel[item.kind];
  return item.comment ? `${base}　${item.comment}` : base;
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
            {cart.map((item, i) => (
              <div className="order-item" key={i}>
                <div>
                  <div className="name">{cartItemLabel(item)}</div>
                  <div className="sub">{cartItemSub(item)}</div>
                </div>
                <button type="button" className="btn ghost" onClick={() => removeFromCart(i)}>
                  ✕
                </button>
              </div>
            ))}
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
