"use client";

import { useEffect, useRef, useState } from "react";
import type { KarteEntryType } from "@prisma/client";
import { karteEntryTypeLabel } from "@/lib/labels";
import { addKarteEntry } from "./actions";
import { useNavigationBlocker } from "./NavigationBlockerContext";

const ENTRY_TYPES: KarteEntryType[] = ["SOAP", "NARRATIVE", "REFERRAL", "AMBULANCE"];

const FIELDS_BY_TYPE: Record<KarteEntryType, string[]> = {
  SOAP: ["subjective", "objective", "assessment", "plan"],
  NARRATIVE: ["title", "narrative"],
  REFERRAL: [
    "destination",
    "referringDoctor",
    "diagnosis",
    "purpose",
    "presentIllness",
    "pastHistory",
    "medications",
    "physicalFindings",
    "testFindings",
    "notes",
  ],
  AMBULANCE: [
    "agencyName",
    "callReceivedAt",
    "sceneArrivalAt",
    "hospitalArrivalAt",
    "chiefComplaint",
    "onsetSituation",
    "consciousness",
    "vitalsOnScene",
    "pastHistory",
    "treatmentEnRoute",
    "receivingDepartment",
    "notes",
  ],
};

type Drafts = Record<KarteEntryType, Record<string, string>>;

function emptyDrafts(): Drafts {
  const result = {} as Drafts;
  for (const type of ENTRY_TYPES) {
    result[type] = Object.fromEntries(FIELDS_BY_TYPE[type].map((f) => [f, ""]));
  }
  return result;
}

function hasAnyContent(drafts: Drafts): boolean {
  return ENTRY_TYPES.some((type) => Object.values(drafts[type]).some((v) => v.trim() !== ""));
}

function draftStorageKey(caseId: string) {
  return `karte-entry-draft:${caseId}`;
}

export function KarteEntryTab({ caseId }: { caseId: string }) {
  const { setIsBlocked } = useNavigationBlocker();
  const [entryType, setEntryType] = useState<KarteEntryType>("SOAP");
  const [drafts, setDrafts] = useState<Drafts>(emptyDrafts);
  const [saving, setSaving] = useState(false);
  const hydrated = useRef(false);

  // 下書きの復元（症例ごとにlocalStorageへ保存している）
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftStorageKey(caseId));
      if (raw) {
        const parsed = JSON.parse(raw) as { entryType?: KarteEntryType; drafts?: Partial<Drafts> };
        const merged = emptyDrafts();
        for (const type of ENTRY_TYPES) {
          Object.assign(merged[type], parsed.drafts?.[type]);
        }
        setDrafts(merged);
        if (parsed.entryType && ENTRY_TYPES.includes(parsed.entryType)) {
          setEntryType(parsed.entryType);
        }
      }
    } catch {
      // 壊れた下書きは無視する
    }
    hydrated.current = true;
    // caseIdは画面遷移のたびにコンポーネントごと再生成されるため初回のみでよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 下書きの自動保存
  useEffect(() => {
    if (!hydrated.current) return;
    const timer = setTimeout(() => {
      try {
        if (hasAnyContent(drafts)) {
          window.localStorage.setItem(draftStorageKey(caseId), JSON.stringify({ entryType, drafts }));
        } else {
          window.localStorage.removeItem(draftStorageKey(caseId));
        }
      } catch {
        // localStorageが使用できない環境では下書き保存を諦める
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [caseId, entryType, drafts]);

  // 離脱ガード：タブ切替（TabLink）とブラウザの再読み込み・クローズの両方に対応する
  const dirty = hasAnyContent(drafts);
  useEffect(() => {
    setIsBlocked(dirty);
    return () => setIsBlocked(false);
  }, [dirty, setIsBlocked]);

  useEffect(() => {
    if (!dirty) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function updateField(field: string, value: string) {
    setDrafts((prev) => ({ ...prev, [entryType]: { ...prev[entryType], [field]: value } }));
  }

  function fieldValue(field: string) {
    return drafts[entryType][field] ?? "";
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setSaving(true);
    try {
      await addKarteEntry(caseId, formData);
      setDrafts((prev) => ({
        ...prev,
        [entryType]: Object.fromEntries(FIELDS_BY_TYPE[entryType].map((f) => [f, ""])),
      }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="card-h">カルテ記載</div>
      <div className="card-b">
        <div className="field" style={{ marginBottom: 16 }}>
          <label>様式</label>
          <div className="radio2">
            {ENTRY_TYPES.map((t) => (
              <div key={t} className={entryType === t ? "on" : ""} onClick={() => setEntryType(t)}>
                {karteEntryTypeLabel[t]}
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <input type="hidden" name="entryType" value={entryType} />

          {entryType === "SOAP" && (
            <>
              <div className="soap-row">
                <div className="tag">S</div>
                <textarea
                  name="subjective"
                  placeholder="患者の訴え・自覚症状を記載"
                  value={fieldValue("subjective")}
                  onChange={(e) => updateField("subjective", e.target.value)}
                />
              </div>
              <div className="soap-row">
                <div className="tag">O</div>
                <textarea
                  name="objective"
                  placeholder="診察所見・検査結果を記載"
                  value={fieldValue("objective")}
                  onChange={(e) => updateField("objective", e.target.value)}
                />
              </div>
              <div className="soap-row">
                <div className="tag">A</div>
                <textarea
                  name="assessment"
                  placeholder="評価・アセスメントを記載"
                  value={fieldValue("assessment")}
                  onChange={(e) => updateField("assessment", e.target.value)}
                />
              </div>
              <div className="soap-row">
                <div className="tag">P</div>
                <textarea
                  name="plan"
                  placeholder="計画・プランを記載"
                  value={fieldValue("plan")}
                  onChange={(e) => updateField("plan", e.target.value)}
                />
              </div>
            </>
          )}

          {entryType === "NARRATIVE" && (
            <>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>表題（任意）</label>
                <input
                  name="title"
                  placeholder="例: 経過記録、退院時サマリ"
                  value={fieldValue("title")}
                  onChange={(e) => updateField("title", e.target.value)}
                />
              </div>
              <div className="field">
                <label>本文</label>
                <textarea
                  name="narrative"
                  placeholder="自由形式で記載してください"
                  style={{ minHeight: 160 }}
                  value={fieldValue("narrative")}
                  onChange={(e) => updateField("narrative", e.target.value)}
                />
              </div>
            </>
          )}

          {entryType === "REFERRAL" && (
            <>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>紹介先医療機関・診療科</label>
                <input
                  name="destination"
                  placeholder="例: ○○大学病院 脳神経内科 御中"
                  value={fieldValue("destination")}
                  onChange={(e) => updateField("destination", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>紹介元医師・医療機関</label>
                <input
                  name="referringDoctor"
                  placeholder="例: △△内科クリニック　医師 △△ △△"
                  value={fieldValue("referringDoctor")}
                  onChange={(e) => updateField("referringDoctor", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>傷病名</label>
                <input
                  name="diagnosis"
                  value={fieldValue("diagnosis")}
                  onChange={(e) => updateField("diagnosis", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>紹介目的</label>
                <input
                  name="purpose"
                  placeholder="例: 精査加療のお願い"
                  value={fieldValue("purpose")}
                  onChange={(e) => updateField("purpose", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>現病歴</label>
                <textarea
                  name="presentIllness"
                  value={fieldValue("presentIllness")}
                  onChange={(e) => updateField("presentIllness", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>既往歴</label>
                <textarea
                  name="pastHistory"
                  value={fieldValue("pastHistory")}
                  onChange={(e) => updateField("pastHistory", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>現在の処方・内服薬</label>
                <textarea
                  name="medications"
                  value={fieldValue("medications")}
                  onChange={(e) => updateField("medications", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>身体所見</label>
                <textarea
                  name="physicalFindings"
                  value={fieldValue("physicalFindings")}
                  onChange={(e) => updateField("physicalFindings", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>検査所見</label>
                <textarea
                  name="testFindings"
                  value={fieldValue("testFindings")}
                  onChange={(e) => updateField("testFindings", e.target.value)}
                />
              </div>
              <div className="field">
                <label>備考</label>
                <textarea
                  name="notes"
                  value={fieldValue("notes")}
                  onChange={(e) => updateField("notes", e.target.value)}
                />
              </div>
            </>
          )}

          {entryType === "AMBULANCE" && (
            <>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>搬送機関</label>
                <input
                  name="agencyName"
                  placeholder="例: ○○市消防局 △△救急隊"
                  value={fieldValue("agencyName")}
                  onChange={(e) => updateField("agencyName", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>覚知時刻</label>
                <input
                  name="callReceivedAt"
                  value={fieldValue("callReceivedAt")}
                  onChange={(e) => updateField("callReceivedAt", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>現場到着時刻</label>
                <input
                  name="sceneArrivalAt"
                  value={fieldValue("sceneArrivalAt")}
                  onChange={(e) => updateField("sceneArrivalAt", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>病院到着時刻</label>
                <input
                  name="hospitalArrivalAt"
                  value={fieldValue("hospitalArrivalAt")}
                  onChange={(e) => updateField("hospitalArrivalAt", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>主訴</label>
                <input
                  name="chiefComplaint"
                  value={fieldValue("chiefComplaint")}
                  onChange={(e) => updateField("chiefComplaint", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>発症状況</label>
                <textarea
                  name="onsetSituation"
                  value={fieldValue("onsetSituation")}
                  onChange={(e) => updateField("onsetSituation", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>意識レベル</label>
                <input
                  name="consciousness"
                  placeholder="例: JCS I-1"
                  value={fieldValue("consciousness")}
                  onChange={(e) => updateField("consciousness", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>現場観察時バイタル</label>
                <input
                  name="vitalsOnScene"
                  placeholder="例: 血圧172/96 脈拍96/分 SpO2 96% 呼吸18/分 体温36.4℃"
                  value={fieldValue("vitalsOnScene")}
                  onChange={(e) => updateField("vitalsOnScene", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>既往歴・内服薬</label>
                <textarea
                  name="pastHistory"
                  value={fieldValue("pastHistory")}
                  onChange={(e) => updateField("pastHistory", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>搬送中の処置</label>
                <textarea
                  name="treatmentEnRoute"
                  value={fieldValue("treatmentEnRoute")}
                  onChange={(e) => updateField("treatmentEnRoute", e.target.value)}
                />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>受入診療科</label>
                <input
                  name="receivingDepartment"
                  value={fieldValue("receivingDepartment")}
                  onChange={(e) => updateField("receivingDepartment", e.target.value)}
                />
              </div>
              <div className="field">
                <label>特記事項</label>
                <textarea
                  name="notes"
                  value={fieldValue("notes")}
                  onChange={(e) => updateField("notes", e.target.value)}
                />
              </div>
            </>
          )}

          <div style={{ textAlign: "right", marginTop: 14 }}>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? "保存中…" : "記録を保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
