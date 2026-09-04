"use client";

import { useRef, useState } from "react";
import type { OrderType } from "@prisma/client";
import { updateDrugOrderRp, type UpdateRpLinePayload } from "./actions";

const DOSE_UNITS_MEDICATION = ["T", "mg", "g", "mL", "単位", "包"];
const DOSE_UNITS_INJECTION = ["V", "mg", "g", "mL", "単位", "包"];
const DOSING_TYPES = ["定期", "頓用"] as const;
const ADMINISTRATION_TYPES = ["単回静注", "持続点滴"] as const;
const BOLUS_METHODS = ["フラッシュ", "○分かけて"] as const;
const DRIP_METHODS = ["○mL/hr", "○分かけて", "全開投与"] as const;

type EditLine = { orderId: string; drugLabel: string; qty: string; unit: string; note: string };

// 既存のduration/rate/startTime文字列（DrugOrderDialog.tsxが生成した形式）を編集フォームの
// 構造化フィールドへ逆変換する。生成側の書式が唯一の情報源のため、正規表現で安全にパースできる。
function parseDurationQty(duration: string): string {
  const m = duration.match(/^(\d+)/);
  return m ? m[1] : "";
}

function parseRate(
  rate: string,
  administrationType: string
): {
  bolusMethod: (typeof BOLUS_METHODS)[number];
  bolusMinutes: string;
  dripMethod: (typeof DRIP_METHODS)[number];
  dripValue: string;
} {
  if (administrationType === "単回静注") {
    const m = rate.match(/^(\d+)分かけて$/);
    return m
      ? { bolusMethod: "○分かけて", bolusMinutes: m[1], dripMethod: "○mL/hr", dripValue: "" }
      : { bolusMethod: "フラッシュ", bolusMinutes: "", dripMethod: "○mL/hr", dripValue: "" };
  }
  if (rate === "全開投与") return { bolusMethod: "フラッシュ", bolusMinutes: "", dripMethod: "全開投与", dripValue: "" };
  const minuteMatch = rate.match(/^(\d+)分かけて$/);
  if (minuteMatch) {
    return { bolusMethod: "フラッシュ", bolusMinutes: "", dripMethod: "○分かけて", dripValue: minuteMatch[1] };
  }
  const mlMatch = rate.match(/^(\d+)mL\/hr$/);
  return { bolusMethod: "フラッシュ", bolusMinutes: "", dripMethod: "○mL/hr", dripValue: mlMatch ? mlMatch[1] : "" };
}

function parseStartTime(startTime: string): { startNow: boolean; startTimes: string[] } {
  const stripped = startTime.replace(/開始$/, "");
  if (!stripped) return { startNow: true, startTimes: [] };
  const tokens = stripped.split("・").filter(Boolean);
  return { startNow: tokens.includes("今から"), startTimes: tokens.filter((t) => t !== "今から") };
}

export function EditRpDialog({
  caseId,
  rpGroupId,
  orderType,
  rpLabel,
  lines: initialLines,
  instruction: initialInstruction,
  dosingType: initialDosingType,
  duration: initialDuration,
  administrationType: initialAdministrationType,
  rate: initialRate,
  startTime: initialStartTime,
  comment: initialComment,
}: {
  caseId: string;
  rpGroupId: string;
  orderType: Extract<OrderType, "MEDICATION" | "INJECTION">;
  rpLabel: string;
  lines: EditLine[];
  instruction: string;
  dosingType: "定期" | "頓用";
  duration: string;
  administrationType: "単回静注" | "持続点滴";
  rate: string;
  startTime: string;
  comment: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isInjection = orderType === "INJECTION";
  const doseUnits = isInjection ? DOSE_UNITS_INJECTION : DOSE_UNITS_MEDICATION;

  const [lines, setLines] = useState<EditLine[]>(initialLines);
  const [instruction, setInstruction] = useState(initialInstruction);
  const [comment, setComment] = useState(initialComment);
  const [dosingType, setDosingType] = useState(initialDosingType);
  const [durationQty, setDurationQty] = useState(() => parseDurationQty(initialDuration));
  const [administrationType, setAdministrationType] = useState(initialAdministrationType);
  const initialRateParsed = parseRate(initialRate, initialAdministrationType);
  const [bolusMethod, setBolusMethod] = useState(initialRateParsed.bolusMethod);
  const [bolusMinutes, setBolusMinutes] = useState(initialRateParsed.bolusMinutes);
  const [dripMethod, setDripMethod] = useState(initialRateParsed.dripMethod);
  const [dripValue, setDripValue] = useState(initialRateParsed.dripValue);
  const initialStartParsed = parseStartTime(initialStartTime);
  const [startNow, setStartNow] = useState(initialStartParsed.startNow);
  const [startTimes, setStartTimes] = useState<string[]>(initialStartParsed.startTimes);
  const [submitting, setSubmitting] = useState(false);

  function resetDraft() {
    setLines(initialLines);
    setInstruction(initialInstruction);
    setComment(initialComment);
    setDosingType(initialDosingType);
    setDurationQty(parseDurationQty(initialDuration));
    setAdministrationType(initialAdministrationType);
    const rp = parseRate(initialRate, initialAdministrationType);
    setBolusMethod(rp.bolusMethod);
    setBolusMinutes(rp.bolusMinutes);
    setDripMethod(rp.dripMethod);
    setDripValue(rp.dripValue);
    const sp = parseStartTime(initialStartTime);
    setStartNow(sp.startNow);
    setStartTimes(sp.startTimes);
  }

  function openDialog() {
    resetDraft();
    dialogRef.current?.showModal();
  }

  function updateLine(orderId: string, patch: Partial<EditLine>) {
    setLines((prev) => prev.map((l) => (l.orderId === orderId ? { ...l, ...patch } : l)));
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
    for (const t of startTimes) if (t.trim()) parts.push(t.trim());
    return parts.length > 0 ? `${parts.join("・")}開始` : "";
  }

  const rateValid = isInjection
    ? administrationType === "単回静注"
      ? bolusMethod === "フラッシュ" || bolusMinutes.trim() !== ""
      : dripMethod === "全開投与" || dripValue.trim() !== ""
    : true;
  const startTimeValid = isInjection ? startNow || startTimes.some((t) => t.trim() !== "") : true;
  const canSubmit = isInjection ? rateValid && startTimeValid : durationQty.trim() !== "";

  async function save() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const linePayload: UpdateRpLinePayload[] = lines.map((l) => ({
        orderId: l.orderId,
        countQty: l.qty,
        countUnit: l.unit,
        note: l.note,
      }));
      if (isInjection) {
        await updateDrugOrderRp(caseId, rpGroupId, {
          orderType: "INJECTION",
          administrationType,
          rate: buildRate(),
          startTime: buildStartTime(),
          comment,
          lines: linePayload,
        });
      } else {
        const duration = durationQty.trim() ? `${durationQty.trim()}${dosingType === "定期" ? "日分" : "回分"}` : "";
        await updateDrugOrderRp(caseId, rpGroupId, {
          orderType: "MEDICATION",
          instruction,
          dosingType,
          duration,
          comment,
          lines: linePayload,
        });
      }
      dialogRef.current?.close();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button type="button" className="btn ghost" onClick={openDialog}>
        編集
      </button>
      <dialog
        ref={dialogRef}
        className="order-dialog"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="order-dialog-inner">
          <div className="order-dialog-body">
            <div className="order-dialog-title">{rpLabel}を編集</div>

            <div className="rp-draft-list">
              {lines.map((l) => (
                <div className="rp-draft-row" key={l.orderId}>
                  <div className="rp-draft-name">{l.drugLabel}</div>
                  <div className="rp-draft-fields">
                    <input
                      style={{ width: 56 }}
                      value={l.qty}
                      onChange={(e) => updateLine(l.orderId, { qty: e.target.value })}
                      placeholder="個数"
                    />
                    <select value={l.unit} onChange={(e) => updateLine(l.orderId, { unit: e.target.value })}>
                      {doseUnits.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                    <input
                      style={{ flex: 1 }}
                      value={l.note}
                      onChange={(e) => updateLine(l.orderId, { note: e.target.value })}
                      placeholder="備考（任意）"
                    />
                  </div>
                </div>
              ))}
            </div>

            {isInjection ? (
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
              </>
            ) : (
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
                    placeholder="例: 分3　朝昼夕"
                  />
                </div>
              </>
            )}

            <div className="field" style={{ marginBottom: 10 }}>
              <label>コメント（任意）</label>
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="補足事項があれば入力" />
            </div>
          </div>
          <div className="order-dialog-footer">
            <button type="button" className="btn ghost" onClick={() => dialogRef.current?.close()}>
              閉じる
            </button>
            <button type="button" className="btn primary" disabled={!canSubmit || submitting} onClick={save}>
              {submitting ? "保存中…" : "保存する"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
