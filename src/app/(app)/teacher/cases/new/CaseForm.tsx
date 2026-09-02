"use client";

import { useState } from "react";
import { createCase } from "./actions";
import { DEFAULT_PHYSIOLOGY_PARAMS, IMAGING_PATTERNS, type PhysiologyParams } from "@/lib/physiology";
import { PhysiologySliders } from "@/components/PhysiologySliders";
import { caseTypeLabel } from "@/lib/labels";
import type { CaseType } from "@prisma/client";

type Template = {
  id: string;
  name: string;
  description: string | null;
  defaultParams: PhysiologyParams;
};

const CASE_TYPES: CaseType[] = ["SIMULATION", "ROUTINE_COMMON", "ROUTINE_PATIENT"];

export function CaseForm({ templates }: { templates: Template[] }) {
  const [caseType, setCaseType] = useState<CaseType>("SIMULATION");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(templates[0]?.id ?? null);
  const [resultTiming, setResultTiming] = useState<"IMMEDIATE" | "DELAYED">("IMMEDIATE");
  const [imagingPattern, setImagingPattern] = useState(IMAGING_PATTERNS[1].key);
  const [sharingMode, setSharingMode] = useState<"SOLO" | "TEAM">("TEAM");

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const sliderDefaults: PhysiologyParams = selectedTemplate?.defaultParams ?? DEFAULT_PHYSIOLOGY_PARAMS;

  return (
    <form action={createCase}>
      <div className="card">
        <div className="card-h">基本情報</div>
        <div className="card-b form-grid">
          <div className="field">
            <label htmlFor="title">症例名</label>
            <input id="title" name="title" required placeholder="例: 市中肺炎（敗血症疑い）69歳男性" />
          </div>
          <div className="field">
            <label htmlFor="caseType">症例区分</label>
            <select id="caseType" name="caseType" value={caseType} onChange={(e) => setCaseType(e.target.value as CaseType)}>
              {CASE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {caseTypeLabel[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="patientName">模擬患者：氏名</label>
            <input id="patientName" name="patientName" required placeholder="例: 模擬 太郎" />
          </div>
          <div className="field">
            <label>模擬患者：年齢/性別</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input name="patientAge" type="number" min={0} max={120} required placeholder="年齢" style={{ width: "50%" }} />
              <select name="patientGender" defaultValue="男性" style={{ width: "50%" }}>
                <option value="男性">男性</option>
                <option value="女性">女性</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="ward">病棟/床（任意）</label>
            <input id="ward" name="ward" placeholder="例: 3階東" />
          </div>
          <div className="field">
            <label htmlFor="bed">床番号（任意）</label>
            <input id="bed" name="bed" placeholder="例: 312" />
          </div>
          <div className="field">
            <label htmlFor="visibilityScope">公開範囲</label>
            <input id="visibilityScope" name="visibilityScope" placeholder="例: 消化器内科ローテーション学生" />
          </div>
          <div className="field">
            <label htmlFor="problems">プロブレム（カンマ区切りで複数入力可）</label>
            <input id="problems" name="problems" placeholder="例: 市中肺炎, 疑い敗血症" />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">病態テンプレート</div>
        <div className="card-b">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginBottom: 16 }}>
            {templates.map((t) => (
              <div
                key={t.id}
                className={`tpl-card${selectedTemplateId === t.id ? " on" : ""}`}
                onClick={() => setSelectedTemplateId(t.id)}
              >
                <div className="t">{t.name}</div>
                <div className="d">{t.description}</div>
              </div>
            ))}
          </div>
          <input type="hidden" name="diseaseTemplateId" value={selectedTemplateId ?? ""} />

          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700, marginBottom: 6 }}>
            テンプレートを微調整
          </div>
          <PhysiologySliders key={selectedTemplateId} initial={sliderDefaults} />
        </div>
      </div>

      <div className="card">
        <div className="card-h">問診・身体診察AIの台本</div>
        <div className="card-b form-grid">
          <div className="field">
            <label htmlFor="historyScript">問診シナリオ（現病歴・既往歴・アレルギー・生活歴など）</label>
            <textarea
              id="historyScript"
              name="historyScript"
              placeholder="例: 3日前から38℃台の発熱と咳嗽。既往に糖尿病。喫煙歴20本/日×30年。アレルギーなし。"
              style={{ minHeight: 120 }}
            />
          </div>
          <div className="field">
            <label htmlFor="examScript">身体診察所見（視診・触診・打診・聴診など系統別）</label>
            <textarea
              id="examScript"
              name="examScript"
              placeholder="例: 右下肺野で断続性ラ音を聴取。腹部は平坦・軟、圧痛なし。下腿浮腫なし。"
              style={{ minHeight: 120 }}
            />
          </div>
          <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "var(--ink-soft)" }}>
            ここに記載した内容がAI（模擬患者役）の応答の根拠になります。空欄の場合はプロブレムやバイタルと矛盾しない範囲でAIが即興で応答します。
          </div>
        </div>
      </div>

      <div className="split">
        <div className="card">
          <div className="card-h">時間進行・結果反映設定</div>
          <div className="card-b">
            <div className="field" style={{ marginBottom: 12 }}>
              <label>検査結果の取得タイミング</label>
              <div className="radio2">
                <div className={resultTiming === "IMMEDIATE" ? "on" : ""} onClick={() => setResultTiming("IMMEDIATE")}>
                  即時型
                </div>
                <div className={resultTiming === "DELAYED" ? "on" : ""} onClick={() => setResultTiming("DELAYED")}>
                  遅延型
                </div>
              </div>
              <input type="hidden" name="resultTiming" value={resultTiming} />
            </div>
            <div className="field">
              <label htmlFor="imagingPattern">画像所見の出し分け</label>
              <select id="imagingPattern" name="imagingPattern" value={imagingPattern} onChange={(e) => setImagingPattern(e.target.value)}>
                {IMAGING_PATTERNS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-h">複数学生の共有設定</div>
          <div className="card-b">
            <div className="field" style={{ marginBottom: 12 }}>
              <label>担当形態</label>
              <div className="radio2">
                <div className={sharingMode === "SOLO" ? "on" : ""} onClick={() => setSharingMode("SOLO")}>
                  単一学生専用
                </div>
                <div className={sharingMode === "TEAM" ? "on" : ""} onClick={() => setSharingMode("TEAM")}>
                  チームで共有
                </div>
              </div>
              <input type="hidden" name="sharingMode" value={sharingMode} />
            </div>
            <div className="field">
              <label htmlFor="assigneeLoginIds">担当学生のログインID（カンマ区切り・任意、公開時のみ反映）</label>
              <input id="assigneeLoginIds" name="assigneeLoginIds" placeholder="例: student1, student2" />
            </div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: "right", marginTop: 14 }}>
        <button type="submit" name="intent" value="draft" className="btn ghost">
          下書き保存
        </button>{" "}
        <button type="submit" name="intent" value="publish" className="btn primary">
          症例を公開
        </button>
      </div>
    </form>
  );
}
