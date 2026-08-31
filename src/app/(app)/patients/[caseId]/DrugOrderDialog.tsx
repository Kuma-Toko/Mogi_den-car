"use client";

import { useRef, useState } from "react";
import type { OrderType } from "@prisma/client";
import { orderTypeLabel } from "@/lib/labels";
import { searchDrugs, type CartItem, type DrugSearchResult, type RpDrugLine } from "./actions";

const DOSE_UNITS = ["T", "mg", "g", "mL", "単位", "包"];

// マスターの既定用量（例: "1錠", "2g"）を数量＋単位の入力欄に分解する。「錠」はT表記に正規化する。
function parseDose(dose: string | null | undefined): { qty: string; unit: string } {
  if (!dose) return { qty: "", unit: DOSE_UNITS[0] };
  const m = dose.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { qty: "", unit: DOSE_UNITS[0] };
  const qty = m[1];
  const rawUnit = m[2].trim() === "錠" ? "T" : m[2].trim();
  const unit = DOSE_UNITS.includes(rawUnit) ? rawUnit : DOSE_UNITS[0];
  return { qty, unit };
}

type DraftLine = RpDrugLine & { key: string; countQty: string; countUnit: string; route: string | null };

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
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [instruction, setInstruction] = useState(""); // 処方: 用法・投与方法
  const [rate, setRate] = useState(""); // 注射・点滴: 投与速度（必須）
  const [comment, setComment] = useState("");

  const isInjection = orderType === "INJECTION";
  const datalistId = `usage-templates-${orderType}`;
  const canSubmit = lines.length > 0 && (!isInjection || rate.trim() !== "");

  function resetDraft() {
    setQuery("");
    setResults([]);
    setSearched(false);
    setLines([]);
    setInstruction("");
    setRate("");
    setComment("");
  }

  function openDialog() {
    resetDraft();
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

  function addLine(drug: DrugSearchResult) {
    const parsed = parseDose(drug.defaultDose);
    setLines((prev) => [
      ...prev,
      {
        key: `${drug.id}-${prev.length}-${Date.now()}`,
        drugId: drug.id,
        label: drug.name,
        route: drug.route,
        note: "",
        count: "",
        countQty: parsed.qty || "1",
        countUnit: parsed.unit,
      },
    ]);
    setQuery("");
    setResults([]);
    setSearched(false);
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function addRpToCart() {
    if (!canSubmit) return;
    const drugs = lines.map((l) => ({
      drugId: l.drugId,
      label: l.label,
      note: l.note.trim(),
      count: l.countQty.trim() ? `${l.countQty.trim()}${l.countUnit}` : "",
    }));
    if (isInjection) {
      onAdd({ kind: "INJECTION_RP", drugs, rate: rate.trim(), comment: comment.trim() });
    } else {
      onAdd({ kind: "MEDICATION_RP", drugs, instruction: instruction.trim(), comment: comment.trim() });
    }
    resetDraft();
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
            <div className="order-dialog-title">{orderTypeLabel[orderType]}オーダー（Rp）</div>

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
                    <div key={d.id} className="drug-search-row" onClick={() => addLine(d)}>
                      <span>
                        {d.name}
                        {d.matchedAlias && <span className="alias-hint"> (「{d.matchedAlias}」で一致)</span>}
                      </span>
                      <span className="cat">{d.category ?? ""}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {lines.length > 0 && (
              <div className="rp-draft-list">
                <div className="rp-draft-title">Rp.1　{lines.length}剤</div>
                {lines.map((l) => (
                  <div className="rp-draft-row" key={l.key}>
                    <div className="rp-draft-name">
                      {l.label}
                      {l.route && <span className="route">{l.route}</span>}
                    </div>
                    <div className="rp-draft-fields">
                      <input
                        style={{ width: 56 }}
                        value={l.countQty}
                        onChange={(e) => updateLine(l.key, { countQty: e.target.value })}
                        placeholder="個数"
                      />
                      <select value={l.countUnit} onChange={(e) => updateLine(l.key, { countUnit: e.target.value })}>
                        {DOSE_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                      <input
                        style={{ flex: 1 }}
                        value={l.note}
                        onChange={(e) => updateLine(l.key, { note: e.target.value })}
                        placeholder="備考（任意）"
                      />
                      <button type="button" className="btn ghost" onClick={() => removeLine(l.key)}>
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {lines.length > 0 && isInjection && (
              <>
                <div className="field" style={{ marginTop: 10, marginBottom: 10 }}>
                  <label>投与速度（必須、Rp共通）</label>
                  <input
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    placeholder="例: 30分かけて投与、または100mL/hr"
                  />
                </div>
                <div className="field" style={{ marginBottom: 10 }}>
                  <label>備考（任意）</label>
                  <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="補足事項があれば入力" />
                </div>
              </>
            )}

            {lines.length > 0 && !isInjection && (
              <>
                <div className="field" style={{ marginTop: 10, marginBottom: 10 }}>
                  <label>指示（用法・投与方法など、Rp共通）</label>
                  <input
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="例: 分3　朝昼夕（一覧から選択も可）"
                    list={datalistId}
                  />
                  <datalist id={datalistId}>
                    {usageTemplates.map((t) => (
                      <option key={t.id} value={t.label} />
                    ))}
                  </datalist>
                </div>
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
            <button type="button" className="btn primary" disabled={!canSubmit} onClick={addRpToCart}>
              Rpをカートに追加（{lines.length}剤）
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
