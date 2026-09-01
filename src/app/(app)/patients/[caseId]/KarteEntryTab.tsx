"use client";

import { useState } from "react";
import type { KarteEntryType } from "@prisma/client";
import { karteEntryTypeLabel } from "@/lib/labels";
import { addKarteEntry } from "./actions";

const ENTRY_TYPES: KarteEntryType[] = ["SOAP", "NARRATIVE", "REFERRAL", "AMBULANCE"];

export function KarteEntryTab({ caseId }: { caseId: string }) {
  const [entryType, setEntryType] = useState<KarteEntryType>("SOAP");
  const saveEntry = addKarteEntry.bind(null, caseId);

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

        <form action={saveEntry} key={entryType}>
          <input type="hidden" name="entryType" value={entryType} />

          {entryType === "SOAP" && (
            <>
              <div className="soap-row">
                <div className="tag">S</div>
                <textarea name="subjective" placeholder="患者の訴え・自覚症状を記載" />
              </div>
              <div className="soap-row">
                <div className="tag">O</div>
                <textarea name="objective" placeholder="診察所見・検査結果を記載" />
              </div>
              <div className="soap-row">
                <div className="tag">A</div>
                <textarea name="assessment" placeholder="評価・アセスメントを記載" />
              </div>
              <div className="soap-row">
                <div className="tag">P</div>
                <textarea name="plan" placeholder="計画・プランを記載" />
              </div>
            </>
          )}

          {entryType === "NARRATIVE" && (
            <>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>表題（任意）</label>
                <input name="title" placeholder="例: 経過記録、退院時サマリ" />
              </div>
              <div className="field">
                <label>本文</label>
                <textarea name="narrative" placeholder="自由形式で記載してください" style={{ minHeight: 160 }} />
              </div>
            </>
          )}

          {entryType === "REFERRAL" && (
            <>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>紹介先医療機関・診療科</label>
                <input name="destination" placeholder="例: ○○大学病院 脳神経内科 御中" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>紹介元医師・医療機関</label>
                <input name="referringDoctor" placeholder="例: △△内科クリニック　医師 △△ △△" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>傷病名</label>
                <input name="diagnosis" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>紹介目的</label>
                <input name="purpose" placeholder="例: 精査加療のお願い" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>現病歴</label>
                <textarea name="presentIllness" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>既往歴</label>
                <textarea name="pastHistory" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>現在の処方・内服薬</label>
                <textarea name="medications" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>身体所見</label>
                <textarea name="physicalFindings" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>検査所見</label>
                <textarea name="testFindings" />
              </div>
              <div className="field">
                <label>備考</label>
                <textarea name="notes" />
              </div>
            </>
          )}

          {entryType === "AMBULANCE" && (
            <>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>搬送機関</label>
                <input name="agencyName" placeholder="例: ○○市消防局 △△救急隊" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>覚知時刻</label>
                <input name="callReceivedAt" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>現場到着時刻</label>
                <input name="sceneArrivalAt" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>病院到着時刻</label>
                <input name="hospitalArrivalAt" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>主訴</label>
                <input name="chiefComplaint" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>発症状況</label>
                <textarea name="onsetSituation" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>意識レベル</label>
                <input name="consciousness" placeholder="例: JCS I-1" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>現場観察時バイタル</label>
                <input name="vitalsOnScene" placeholder="例: 血圧172/96 脈拍96/分 SpO2 96% 呼吸18/分 体温36.4℃" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>既往歴・内服薬</label>
                <textarea name="pastHistory" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>搬送中の処置</label>
                <textarea name="treatmentEnRoute" />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>受入診療科</label>
                <input name="receivingDepartment" />
              </div>
              <div className="field">
                <label>特記事項</label>
                <textarea name="notes" />
              </div>
            </>
          )}

          <div style={{ textAlign: "right", marginTop: 14 }}>
            <button type="submit" className="btn primary">
              記録を保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
