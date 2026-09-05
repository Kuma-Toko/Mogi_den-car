"use client";

import { useRef, useState } from "react";
import type { OrderType } from "@prisma/client";
import { orderTypeLabel } from "@/lib/labels";
import { packageInsertSearchUrl } from "@/lib/packageInsert";
import { searchDrugs, type CartItem, type DrugSearchResult, type RpDrugLine } from "./actions";

// 処方は錠剤主体のため既定単位はT（錠）、注射はバイアル製剤が多いためV（バイアル）を既定にする。
const DOSE_UNITS_MEDICATION = ["T", "mg", "g", "mL", "単位", "包"];
const DOSE_UNITS_INJECTION = ["V", "mg", "g", "mL", "単位", "包"];

const DOSING_TYPES = ["定期", "頓用"] as const;
const ADMINISTRATION_TYPES = ["単回静注", "持続点滴"] as const;
const BOLUS_METHODS = ["フラッシュ", "○分かけて"] as const;
const DRIP_METHODS = ["○mL/hr", "○分かけて", "全開投与"] as const;

// マスターの既定用量（例: "1錠", "2g"）を数量＋単位の入力欄に分解する。「錠」はT表記に正規化する。
function parseDose(dose: string | null | undefined, units: string[]): { qty: string; unit: string } {
  if (!dose) return { qty: "", unit: units[0] };
  const m = dose.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { qty: "", unit: units[0] };
  const qty = m[1];
  const rawUnit = m[2].trim() === "錠" ? "T" : m[2].trim();
  const unit = units.includes(rawUnit) ? rawUnit : units[0];
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
  const [comment, setComment] = useState("");

  // 処方（MEDICATION）専用
  const [dosingType, setDosingType] = useState<(typeof DOSING_TYPES)[number]>("定期");
  const [durationQty, setDurationQty] = useState("");

  // 注射・点滴（INJECTION）専用
  const [administrationType, setAdministrationType] = useState<(typeof ADMINISTRATION_TYPES)[number]>("単回静注");
  const [bolusMethod, setBolusMethod] = useState<(typeof BOLUS_METHODS)[number]>("フラッシュ");
  const [bolusMinutes, setBolusMinutes] = useState("");
  const [dripMethod, setDripMethod] = useState<(typeof DRIP_METHODS)[number]>("○mL/hr");
  const [dripValue, setDripValue] = useState("");
  const [startNow, setStartNow] = useState(true);
  const [startTimes, setStartTimes] = useState<string[]>([]);

  const isInjection = orderType === "INJECTION";
  const doseUnits = isInjection ? DOSE_UNITS_INJECTION : DOSE_UNITS_MEDICATION;
  const datalistId = `usage-templates-${orderType}`;

  const rateValid = isInjection
    ? administrationType === "単回静注"
      ? bolusMethod === "フラッシュ" || bolusMinutes.trim() !== ""
      : dripMethod === "全開投与" || dripValue.trim() !== ""
    : true;
  const startTimeValid = isInjection ? startNow || startTimes.some((t) => t.trim() !== "") : true;
  const canSubmit = lines.length > 0 && (isInjection ? rateValid && startTimeValid : durationQty.trim() !== "");

  function resetDraft() {
    setQuery("");
    setResults([]);
    setSearched(false);
    setLines([]);
    setInstruction("");
    setComment("");
    setDosingType("定期");
    setDurationQty("");
    setAdministrationType("単回静注");
    setBolusMethod("フラッシュ");
    setBolusMinutes("");
    setDripMethod("○mL/hr");
    setDripValue("");
    setStartNow(true);
    setStartTimes([]);
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
    const parsed = parseDose(drug.defaultDose, doseUnits);
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

  function addTimeRow() {
    setStartTimes((prev) => [...prev, ""]);
  }

  function updateTimeRow(index: number, value: string) {
    setStartTimes((prev) => prev.map((t, i) => (i === index ? value : t)));
  }

  function removeTimeRow(index: number) {
    setStartTimes((prev) => prev.filter((_, i) => i !== index));
  }

  function buildRate(): string {
    if (administrationType === "単回静注") {
      return bolusMethod === "フラッシュ" ? "フラッシュ" : `${bolusMinutes.trim()}分かけて`;
    }
    if (dripMethod === "全開投与") return "全開投与";
    if (dripMethod === "○分かけて") return `${dripValue.trim()}分かけて`;
    return `${dripValue.trim()}mL/hr`;
  }

  function buildStartTime(): string {
    const parts: string[] = [];
    if (startNow) parts.push("今から");
    for (const t of startTimes) {
      if (t.trim()) parts.push(t.trim());
    }
    return parts.length > 0 ? `${parts.join("・")}開始` : "";
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
      onAdd({
        kind: "INJECTION_RP",
        drugs,
        administrationType,
        rate: buildRate(),
        startTime: buildStartTime(),
        comment: comment.trim(),
      });
    } else {
      const duration = durationQty.trim() ? `${durationQty.trim()}${dosingType === "定期" ? "日分" : "回分"}` : "";
      onAdd({
        kind: "MEDICATION_RP",
        drugs,
        instruction: instruction.trim(),
        dosingType,
        duration,
        comment: comment.trim(),
      });
    }
    resetDraft();
    dialogRef.current?.close();
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
                      <span className="drug-search-row-right">
                        {d.majorCategories.map((c) => (
                          <span key={c} className="cat-tag">
                            {c}
                          </span>
                        ))}
                        {d.category && <span className="cat">{d.category}</span>}
                        <a
                          className="insert-link"
                          href={packageInsertSearchUrl(d.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          添付文書 ↗
                        </a>
                      </span>
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
                      <a
                        className="insert-link"
                        href={packageInsertSearchUrl(l.label)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        添付文書 ↗
                      </a>
                    </div>
                    <div className="rp-draft-fields">
                      <input
                        style={{ width: 56 }}
                        value={l.countQty}
                        onChange={(e) => updateLine(l.key, { countQty: e.target.value })}
                        placeholder="個数"
                      />
                      <select value={l.countUnit} onChange={(e) => updateLine(l.key, { countUnit: e.target.value })}>
                        {doseUnits.map((u) => (
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
                  <label>投与方法</label>
                  <div className="radio2">
                    {ADMINISTRATION_TYPES.map((t) => (
                      <div key={t} className={administrationType === t ? "on" : ""} onClick={() => setAdministrationType(t)}>
                        {t}
                      </div>
                    ))}
                  </div>
                </div>

                {administrationType === "単回静注" ? (
                  <div className="field" style={{ marginBottom: 10 }}>
                    <label>投与速度（必須）</label>
                    <div className="radio2">
                      {BOLUS_METHODS.map((m) => (
                        <div key={m} className={bolusMethod === m ? "on" : ""} onClick={() => setBolusMethod(m)}>
                          {m}
                        </div>
                      ))}
                    </div>
                    {bolusMethod === "○分かけて" && (
                      <input
                        style={{ marginTop: 6, width: 120 }}
                        value={bolusMinutes}
                        onChange={(e) => setBolusMinutes(e.target.value)}
                        placeholder="分数（例: 5）"
                        inputMode="numeric"
                      />
                    )}
                  </div>
                ) : (
                  <div className="field" style={{ marginBottom: 10 }}>
                    <label>投与速度（必須）</label>
                    <div className="radio2">
                      {DRIP_METHODS.map((m) => (
                        <div key={m} className={dripMethod === m ? "on" : ""} onClick={() => setDripMethod(m)}>
                          {m}
                        </div>
                      ))}
                    </div>
                    {dripMethod !== "全開投与" && (
                      <input
                        style={{ marginTop: 6, width: 120 }}
                        value={dripValue}
                        onChange={(e) => setDripValue(e.target.value)}
                        placeholder={dripMethod === "○mL/hr" ? "例: 100" : "分数（例: 60）"}
                        inputMode="numeric"
                      />
                    )}
                  </div>
                )}

                <div className="field" style={{ marginBottom: 10 }}>
                  <label>開始時刻（必須、1つ以上）</label>
                  <div style={{ marginBottom: 6 }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 400 }}>
                      <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />
                      今から開始する
                    </label>
                  </div>
                  {startTimes.map((t, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <input type="time" value={t} onChange={(e) => updateTimeRow(i, e.target.value)} />
                      <button type="button" className="btn ghost" onClick={() => removeTimeRow(i)}>
                        ✕
                      </button>
                    </div>
                  ))}
                  <button type="button" className="btn ghost" onClick={addTimeRow}>
                    ＋ 時刻を追加
                  </button>
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
                  <label>用法区分</label>
                  <div className="radio2">
                    {DOSING_TYPES.map((t) => (
                      <div key={t} className={dosingType === t ? "on" : ""} onClick={() => setDosingType(t)}>
                        {t}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="field" style={{ marginBottom: 10 }}>
                  <label>{dosingType === "定期" ? "日数" : "回数"}（必須）</label>
                  <input
                    style={{ width: 120 }}
                    value={durationQty}
                    onChange={(e) => setDurationQty(e.target.value)}
                    placeholder={dosingType === "定期" ? "例: 5" : "例: 10"}
                    inputMode="numeric"
                  />
                </div>
                <div className="field" style={{ marginBottom: 10 }}>
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
