"use client";

import { useRef, useState } from "react";
import { orderTypeLabel } from "@/lib/labels";
import type { CartItem, ImagingContext } from "./actions";

type LabItem = { id: string; name: string; category: string; subcategory: string | null };

const MRI_SUBCATEGORY = "MRI";

const MRI_SEQUENCE_OPTIONS = ["T1強調像（T1WI）", "T2強調像（T2WI）", "FLAIR", "拡散強調像（DWI）", "T2*/SWI（磁化率強調）", "造影後T1強調像"];

function groupBySubcategory(items: LabItem[]): [string, LabItem[]][] {
  const map = new Map<string, LabItem[]>();
  for (const item of items) {
    const sub = item.subcategory ?? "その他";
    const list = map.get(sub) ?? [];
    list.push(item);
    map.set(sub, list);
  }
  return [...map.entries()];
}

export function ImagingOrderDialog({ imagingItems, onAdd }: { imagingItems: LabItem[]; onAdd: (items: CartItem[]) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const groups = groupBySubcategory(imagingItems);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeModality, setActiveModality] = useState<string>(groups[0]?.[0] ?? "");
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [findings, setFindings] = useState("");
  const [purpose, setPurpose] = useState("");
  const [needsInterpretation, setNeedsInterpretation] = useState(true);
  const [mriSequences, setMriSequences] = useState<Set<string>>(new Set());

  const activeGroup = groups.find(([modality]) => modality === activeModality) ?? groups[0];
  const hasMriSelected = [...selectedIds].some(
    (id) => imagingItems.find((l) => l.id === id)?.subcategory === MRI_SUBCATEGORY
  );

  function resetForm() {
    setSelectedIds(new Set());
    setActiveModality(groups[0]?.[0] ?? "");
    setChiefComplaint("");
    setFindings("");
    setPurpose("");
    setNeedsInterpretation(true);
    setMriSequences(new Set());
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

  function toggleSequence(seq: string) {
    setMriSequences((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  }

  function addSelectedToCart() {
    if (selectedIds.size === 0) return;
    const imaging: ImagingContext = {
      chiefComplaint: chiefComplaint.trim(),
      findings: findings.trim(),
      purpose: purpose.trim(),
      needsInterpretation,
      mriSequences: hasMriSelected ? [...mriSequences] : undefined,
    };
    const additions: CartItem[] = imagingItems
      .filter((l) => selectedIds.has(l.id))
      .map((l) => ({
        kind: "LAB" as const,
        labItemId: l.id,
        label: l.name,
        imaging,
      }));
    onAdd(additions);
    resetForm();
    dialogRef.current?.close();
  }

  return (
    <>
      <div onClick={openDialog}>＋ {orderTypeLabel.IMAGING}</div>
      <dialog
        ref={dialogRef}
        className="order-dialog order-dialog-lg"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="order-dialog-inner">
          <div className="order-dialog-body">
            <div className="order-dialog-title">{orderTypeLabel.IMAGING}オーダー</div>
            <div className="lab-tab-strip">
              {groups.map(([modality, items]) => {
                const selected = items.filter((item) => selectedIds.has(item.id)).length;
                return (
                  <div
                    key={modality}
                    className={`lab-tab${modality === activeModality ? " active" : ""}`}
                    onClick={() => setActiveModality(modality)}
                  >
                    {modality}
                    <span className="lab-tab-count">{selected > 0 ? `${selected}/${items.length}` : items.length}</span>
                  </div>
                );
              })}
            </div>
            {activeGroup && (
              <div className="chip-grid" style={{ marginBottom: 10 }}>
                {activeGroup[1].map((item) => (
                  <div
                    key={item.id}
                    className={`chip-toggle${selectedIds.has(item.id) ? " on" : ""}`}
                    onClick={() => toggle(item.id)}
                  >
                    {item.name}
                  </div>
                ))}
              </div>
            )}

            {hasMriSelected && (
              <div className="imaging-context">
                <div className="lab-group-category">撮像シーケンス</div>
                <div className="chip-grid">
                  {MRI_SEQUENCE_OPTIONS.map((seq) => (
                    <div
                      key={seq}
                      className={`chip-toggle${mriSequences.has(seq) ? " on" : ""}`}
                      onClick={() => toggleSequence(seq)}
                    >
                      {seq}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="imaging-context">
              <div className="lab-group-category">画像検査の依頼情報</div>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>主訴</label>
                <input
                  value={chiefComplaint}
                  onChange={(e) => setChiefComplaint(e.target.value)}
                  placeholder="例: 発熱・咳嗽"
                />
              </div>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>臨床所見</label>
                <textarea
                  rows={2}
                  value={findings}
                  onChange={(e) => setFindings(e.target.value)}
                  placeholder="例: 右下肺野にcoarse crackles"
                />
              </div>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>検査目的</label>
                <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例: 肺炎の評価" />
              </div>
              <label className="imaging-context-check">
                <input
                  type="checkbox"
                  checked={needsInterpretation}
                  onChange={(e) => setNeedsInterpretation(e.target.checked)}
                />
                読影を依頼する
              </label>
            </div>
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
