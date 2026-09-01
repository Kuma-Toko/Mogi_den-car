"use client";

import { useRef, useState } from "react";
import { orderTypeLabel } from "@/lib/labels";
import type { CartItem } from "./actions";

type LabItem = { id: string; name: string; category: string; subcategory: string | null };

function groupLabItems(items: LabItem[]): [string, [string, LabItem[]][]][] {
  const byCategory = new Map<string, Map<string, LabItem[]>>();
  for (const item of items) {
    const sub = item.subcategory ?? "その他";
    if (!byCategory.has(item.category)) byCategory.set(item.category, new Map());
    const subMap = byCategory.get(item.category)!;
    const list = subMap.get(sub) ?? [];
    list.push(item);
    subMap.set(sub, list);
  }
  return [...byCategory.entries()].map(([category, subMap]) => [category, [...subMap.entries()]]);
}

export function LabOrderDialog({ labItems, onAdd }: { labItems: LabItem[]; onAdd: (items: CartItem[]) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const groups = groupLabItems(labItems);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string>(groups[0]?.[0] ?? "");

  const activeGroup = groups.find(([category]) => category === activeCategory) ?? groups[0];

  function resetForm() {
    setSelectedIds(new Set());
    setActiveCategory(groups[0]?.[0] ?? "");
  }

  function openDialog() {
    resetForm();
    dialogRef.current?.showModal();
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addSelectedToCart() {
    if (selectedIds.size === 0) return;
    const additions: CartItem[] = labItems
      .filter((l) => selectedIds.has(l.id))
      .map((l) => ({
        kind: "LAB" as const,
        labItemId: l.id,
        label: l.name,
      }));
    onAdd(additions);
    resetForm();
    dialogRef.current?.close();
  }

  return (
    <>
      <div onClick={openDialog}>＋ {orderTypeLabel.LAB}</div>
      <dialog
        ref={dialogRef}
        className="order-dialog order-dialog-lg"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="order-dialog-inner">
          <div className="order-dialog-body">
            <div className="order-dialog-title">{orderTypeLabel.LAB}オーダー</div>
            <div className="lab-tab-strip">
              {groups.map(([category, subGroups]) => {
                const total = subGroups.reduce((sum, [, items]) => sum + items.length, 0);
                const selected = subGroups.reduce(
                  (sum, [, items]) => sum + items.filter((item) => selectedIds.has(item.id)).length,
                  0
                );
                return (
                  <div
                    key={category}
                    className={`lab-tab${category === activeCategory ? " active" : ""}`}
                    onClick={() => setActiveCategory(category)}
                  >
                    {category}
                    <span className="lab-tab-count">{selected > 0 ? `${selected}/${total}` : total}</span>
                  </div>
                );
              })}
            </div>
            {activeGroup?.[1].map(([sub, items]) => (
              <div key={sub} style={{ marginBottom: 10 }}>
                <div className="lab-group-sub">{sub}</div>
                <div className="chip-grid">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className={`chip-toggle${selectedIds.has(item.id) ? " on" : ""}`}
                      onClick={() => toggle(item.id)}
                    >
                      {item.name}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="order-dialog-footer">
            <button type="button" className="btn ghost" onClick={() => dialogRef.current?.close()}>
              閉じる
            </button>
            <button type="button" className="btn primary" disabled={selectedIds.size === 0} onClick={addSelectedToCart}>
              選択した{selectedIds.size}件をカートに追加
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
