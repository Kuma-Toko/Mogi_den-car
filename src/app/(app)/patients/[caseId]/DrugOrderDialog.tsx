"use client";

import { useRef, useState } from "react";
import type { OrderType } from "@prisma/client";
import { orderTypeLabel } from "@/lib/labels";
import { searchDrugs, type CartItem, type DrugSearchResult } from "./actions";

export function DrugOrderDialog({
  caseId,
  orderType,
  usageTemplates,
  onAdd,
}: {
  caseId: string;
  orderType: Extract<OrderType, "MEDICATION" | "INJECTION">;
  usageTemplates: { id: string; label: string }[];
  onAdd: (item: CartItem) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<DrugSearchResult[]>([]);
  const [selected, setSelected] = useState<DrugSearchResult | null>(null);
  const [dosage, setDosage] = useState("");
  const [usage, setUsage] = useState(""); // 処方: 用法
  const [rate, setRate] = useState(""); // 注射・点滴: 投与速度
  const [comment, setComment] = useState("");

  const isInjection = orderType === "INJECTION";
  const datalistId = `usage-templates-${orderType}`;

  function openDialog() {
    setQuery("");
    setResults([]);
    setSearched(false);
    setSelected(null);
    setDosage("");
    setUsage("");
    setRate("");
    setComment("");
    dialogRef.current?.showModal();
  }

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const found = await searchDrugs(caseId, isInjection, q);
      setResults(found);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  }

  function selectDrug(drug: DrugSearchResult) {
    setSelected(drug);
    setDosage(drug.defaultDose ?? "");
    setResults([]);
    setSearched(false);
  }

  function clearSelection() {
    setSelected(null);
    setDosage("");
    setUsage("");
    setRate("");
    setComment("");
  }

  function addToCart() {
    if (!selected) return;
    if (isInjection) {
      onAdd({
        kind: "INJECTION",
        drugId: selected.id,
        label: selected.name,
        dosage: dosage.trim(),
        rate: rate.trim(),
        comment: comment.trim(),
      });
    } else {
      onAdd({
        kind: "MEDICATION",
        drugId: selected.id,
        label: selected.name,
        dosage: dosage.trim(),
        usage: usage.trim(),
        comment: comment.trim(),
      });
    }
    setSelected(null);
    setDosage("");
    setUsage("");
    setRate("");
    setComment("");
    setQuery("");
  }

  return (
    <>
      <div onClick={openDialog}>＋ {orderTypeLabel[orderType]}</div>
      <dialog
        ref={dialogRef}
        className="order-dialog"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="order-dialog-inner">
          <div className="order-dialog-body">
            <div className="order-dialog-title">{orderTypeLabel[orderType]}オーダー</div>

            {!selected && (
              <>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>薬剤名（部分一致検索）</label>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void runSearch();
                      }
                    }}
                    placeholder="薬剤名を入力してEnterで検索"
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  className="btn"
                  style={{ marginBottom: 10 }}
                  onClick={runSearch}
                  disabled={!query.trim() || searching}
                >
                  {searching ? "検索中…" : "検索"}
                </button>

                {searched && (
                  <div className="drug-search-results">
                    {results.length === 0 ? (
                      <div className="empty-note">該当する薬剤がありません。</div>
                    ) : (
                      results.map((d) => (
                        <div key={d.id} className="drug-search-row" onClick={() => selectDrug(d)}>
                          <span>{d.name}</span>
                          <span className="cat">{d.category ?? ""}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </>
            )}

            {selected && (
              <>
                <div className="drug-selected">
                  <span className="name">{selected.name}</span>
                  <button type="button" className="btn ghost" onClick={clearSelection}>
                    薬剤を変更
                  </button>
                </div>
                <div className="field" style={{ marginBottom: 10 }}>
                  <label>投与方法</label>
                  <input value={selected.route ?? "—"} disabled />
                </div>
                <div className="field" style={{ marginBottom: 10 }}>
                  <label>用量（1日量）</label>
                  <input value={dosage} onChange={(e) => setDosage(e.target.value)} placeholder="例: 2g" />
                </div>
                {isInjection ? (
                  <div className="field" style={{ marginBottom: 10 }}>
                    <label>投与速度</label>
                    <input
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      placeholder="例: 100mL/時、または30分で投与"
                    />
                  </div>
                ) : (
                  <div className="field" style={{ marginBottom: 10 }}>
                    <label>用法</label>
                    <input
                      value={usage}
                      onChange={(e) => setUsage(e.target.value)}
                      placeholder="例: 分3　朝昼夕（一覧から選択も可）"
                      list={datalistId}
                    />
                    <datalist id={datalistId}>
                      {usageTemplates.map((t) => (
                        <option key={t.id} value={t.label} />
                      ))}
                    </datalist>
                  </div>
                )}
                <div className="field" style={{ marginBottom: 10 }}>
                  <label>コメント（任意）</label>
                  <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="補足事項があれば入力" />
                </div>
              </>
            )}
          </div>
          <div className="order-dialog-footer">
            <button type="button" className="btn ghost" onClick={() => dialogRef.current?.close()}>
              閉じる
            </button>
            <button type="button" className="btn primary" disabled={!selected} onClick={addToCart}>
              カートに追加
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
