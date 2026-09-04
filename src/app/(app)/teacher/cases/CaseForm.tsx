"use client";

import { useRef, useState } from "react";
import {
  DEFAULT_PHYSIOLOGY_PARAMS,
  sliderToSeverityLabel,
  sliderToSpeedLabel,
  sliderToSpo2,
  sliderToTemp,
  type PhysiologyParams,
} from "@/lib/physiology";
import { PhysiologySliders } from "@/components/PhysiologySliders";
import { caseTypeLabel } from "@/lib/labels";
import type { CaseStatus, CaseType, CrisisMode } from "@prisma/client";

type Template = {
  id: string;
  name: string;
  description: string | null;
  defaultParams: PhysiologyParams;
  isInfectious: boolean;
};

type Pathogen = { id: string; name: string };

export type CaseFormInitial = {
  status: CaseStatus;
  caseType: CaseType;
  title: string;
  patientName: string;
  patientAge: number;
  patientGender: string;
  ward: string;
  bed: string;
  visibilityScope: string;
  problems: string;
  historyScript: string;
  examScript: string;
  diseaseTemplateIds: string[];
  primaryTemplateId: string | null;
  resultTiming: "IMMEDIATE" | "DELAYED";
  sharingMode: "SOLO" | "TEAM";
  crisisMode: CrisisMode;
  physiologyParamsByTemplate: Record<string, PhysiologyParams>;
  pathogenIdByTemplate: Record<string, string>;
  assigneeLoginIds: string;
};

const CASE_TYPES: CaseType[] = ["SIMULATION", "ROUTINE_COMMON", "ROUTINE_PATIENT"];

const CRISIS_MODES: { value: CrisisMode; label: string }[] = [
  { value: "OFF", label: "危機シナリオなし" },
  { value: "REVERSIBLE", label: "危機シナリオあり（死亡なし）" },
  { value: "LETHAL", label: "危機シナリオあり（死亡あり）" },
];

export function CaseForm({
  templates,
  pathogens,
  mode = "create",
  action,
  initial,
}: {
  templates: Template[];
  pathogens: Pathogen[];
  mode?: "create" | "edit";
  action: (formData: FormData) => void | Promise<void>;
  initial?: CaseFormInitial;
}) {
  const [caseType] = useState<CaseType>(initial?.caseType ?? "SIMULATION");
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>(
    initial?.diseaseTemplateIds ?? (templates[0] ? [templates[0].id] : [])
  );
  const [primaryTemplateId, setPrimaryTemplateId] = useState<string | null>(
    initial?.primaryTemplateId ?? templates[0]?.id ?? null
  );
  const [resultTiming, setResultTiming] = useState<"IMMEDIATE" | "DELAYED">(initial?.resultTiming ?? "IMMEDIATE");
  const [sharingMode, setSharingMode] = useState<"SOLO" | "TEAM">(initial?.sharingMode ?? "TEAM");
  const [crisisMode, setCrisisMode] = useState<CrisisMode>(initial?.crisisMode ?? "LETHAL");

  // 疾患ごとのスライダー値。編集時は保存済みの値を、新規選択時はそのテンプレートの既定値を初期値にする。
  const [physiologyValuesByTemplate, setPhysiologyValuesByTemplate] = useState<Record<string, PhysiologyParams>>(
    () => initial?.physiologyParamsByTemplate ?? {}
  );
  // 感染症エンジン: isInfectiousなテンプレートごとに割り当てる「真の原因菌」。未選択は空文字（=未割り当て）。
  const [pathogenIdByTemplate, setPathogenIdByTemplate] = useState<Record<string, string>>(
    () => initial?.pathogenIdByTemplate ?? {}
  );

  const formRef = useRef<HTMLFormElement>(null);
  const [copiedKind, setCopiedKind] = useState<"history" | "exam" | null>(null);
  const [promptPreview, setPromptPreview] = useState<{ kind: "history" | "exam"; text: string } | null>(null);

  function toggleTemplate(templateId: string) {
    setSelectedTemplateIds((prev) => {
      const isSelected = prev.includes(templateId);
      const next = isSelected ? prev.filter((id) => id !== templateId) : [...prev, templateId];

      if (!isSelected) {
        // 新規選択: まだ値を持っていなければそのテンプレートの既定値で初期化する
        setPhysiologyValuesByTemplate((values) =>
          values[templateId]
            ? values
            : { ...values, [templateId]: templates.find((t) => t.id === templateId)?.defaultParams ?? DEFAULT_PHYSIOLOGY_PARAMS }
        );
        if (!primaryTemplateId) setPrimaryTemplateId(templateId);
      } else if (primaryTemplateId === templateId) {
        // 主病態を解除した場合、残りの選択肢の先頭を新たな主病態にする
        setPrimaryTemplateId(next[0] ?? null);
      }

      return next;
    });
  }

  function buildCaseContext() {
    const fd = new FormData(formRef.current ?? undefined);
    const title = String(fd.get("title") || "").trim() || "(未入力)";
    const patientName = String(fd.get("patientName") || "").trim() || "(未入力)";
    const patientAge = String(fd.get("patientAge") || "").trim() || "(未入力)";
    const patientGender = String(fd.get("patientGender") || "").trim() || "(未入力)";
    const problems = String(fd.get("problems") || "").trim() || "(未入力)";
    const selectedTemplates = templates.filter((t) => selectedTemplateIds.includes(t.id));
    const templateSummary =
      selectedTemplates.length > 0
        ? selectedTemplates.map((t) => `${t.name}${t.description ? `（${t.description}）` : ""}`).join("、")
        : "(未選択)";
    const primaryValues = primaryTemplateId ? physiologyValuesByTemplate[primaryTemplateId] : undefined;
    const physiologyLine = primaryValues
      ? `主病態の重症度: ${sliderToSeverityLabel(primaryValues.severitySlider)} / 体温: ${sliderToTemp(primaryValues.initialTempSlider)}℃ / SpO2: ${sliderToSpo2(primaryValues.initialSpo2Slider)}% / 改善速度: ${sliderToSpeedLabel(primaryValues.improvementSpeedSlider)}`
      : "";
    return [
      `症例名: ${title}`,
      `模擬患者: ${patientName}（${patientAge}歳・${patientGender}）`,
      `プロブレム: ${problems}`,
      `想定疾患テンプレート: ${templateSummary}`,
      physiologyLine,
    ]
      .filter(Boolean)
      .join("\n");
  }

  function buildPrompt(kind: "history" | "exam") {
    const context = buildCaseContext();
    if (kind === "history") {
      return `あなたは医学教育用の模擬患者シナリオを作成する専門家です。以下の症例設定に基づいて、学生が医療面接（問診）を行う際にAI模擬患者が回答の根拠にできる「問診シナリオ」を作成してください。

【症例設定】
${context}

【出力してほしい内容】
現病歴（発症時期・経過・随伴症状）、既往歴、内服薬・アレルギー、生活歴（喫煙・飲酒・職業など）、家族歴を、自然な文章で300〜500字程度にまとめてください。学生からのどんな質問にも一貫して答えられるよう、具体的な数値や時期を含めてください。
出力は見出しや箇条書きを付けず、そのまま模擬患者の設定として使える文章だけを返してください。`;
    }
    return `あなたは医学教育用の模擬患者シナリオを作成する専門家です。以下の症例設定に基づいて、学生が身体診察を行った際にAIが回答の根拠にできる「身体診察所見」を作成してください。

【症例設定】
${context}

【出力してほしい内容】
バイタルサイン・重症度と矛盾しないように、視診・触診・打診・聴診の所見を系統別（頭頸部/胸部・呼吸音/心音/腹部/四肢・浮腫/神経学的所見など）に、カルテ記載のような簡潔な文章でまとめてください。
出力は見出しや箇条書きを付けず、そのまま模擬患者の設定として使える文章だけを返してください。`;
  }

  async function handleGeneratePrompt(kind: "history" | "exam") {
    const text = buildPrompt(kind);
    setPromptPreview({ kind, text });
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKind(kind);
      setTimeout(() => setCopiedKind((k) => (k === kind ? null : k)), 2000);
    } catch {
      // クリップボード書き込み不可の場合は下のプレビュー欄から手動でコピーする
    }
  }

  const canPublish = mode === "create" || initial?.status === "DRAFT";

  return (
    <form action={action} ref={formRef}>
      <div className="card">
        <div className="card-h">基本情報</div>
        <div className="card-b form-grid">
          <div className="field">
            <label htmlFor="title">症例名</label>
            <input id="title" name="title" required defaultValue={initial?.title} placeholder="例: 市中肺炎（敗血症疑い）69歳男性" />
          </div>
          <div className="field">
            <label htmlFor="caseType">症例区分</label>
            {mode === "edit" ? (
              <>
                <input value={caseTypeLabel[caseType]} disabled />
                <input type="hidden" name="caseType" value={caseType} />
              </>
            ) : (
              <select id="caseType" name="caseType" defaultValue={caseType}>
                {CASE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {caseTypeLabel[t]}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="field">
            <label htmlFor="patientName">模擬患者：氏名</label>
            <input id="patientName" name="patientName" required defaultValue={initial?.patientName} placeholder="例: 模擬 太郎" />
          </div>
          <div className="field">
            <label>模擬患者：年齢/性別</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                name="patientAge"
                type="number"
                min={0}
                max={120}
                required
                defaultValue={initial?.patientAge}
                placeholder="年齢"
                style={{ width: "50%" }}
              />
              <select name="patientGender" defaultValue={initial?.patientGender ?? "男性"} style={{ width: "50%" }}>
                <option value="男性">男性</option>
                <option value="女性">女性</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="ward">病棟/床（任意）</label>
            <input id="ward" name="ward" defaultValue={initial?.ward} placeholder="例: 3階東" />
          </div>
          <div className="field">
            <label htmlFor="bed">床番号（任意）</label>
            <input id="bed" name="bed" defaultValue={initial?.bed} placeholder="例: 312" />
          </div>
          <div className="field">
            <label htmlFor="visibilityScope">公開範囲</label>
            <input id="visibilityScope" name="visibilityScope" defaultValue={initial?.visibilityScope} placeholder="例: 消化器内科ローテーション学生" />
          </div>
          <div className="field">
            <label htmlFor="problems">プロブレム（カンマ区切りで複数入力可）</label>
            <input id="problems" name="problems" defaultValue={initial?.problems} placeholder="例: 市中肺炎, 疑い敗血症" />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">病態テンプレート（複数選択可）</div>
        <div className="card-b">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginBottom: 16 }}>
            {templates.map((t) => {
              const isSelected = selectedTemplateIds.includes(t.id);
              const isPrimary = primaryTemplateId === t.id;
              return (
                <div key={t.id} className={`tpl-card${isSelected ? " on" : ""}`} onClick={() => toggleTemplate(t.id)}>
                  <div className="t" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {t.name}
                    {isPrimary && <span className="badge teal" style={{ fontSize: 10 }}>主病態</span>}
                  </div>
                  <div className="d">{t.description}</div>
                  {isSelected && !isPrimary && (
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ fontSize: 10.5, padding: "2px 8px", marginTop: 6 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPrimaryTemplateId(t.id);
                      }}
                    >
                      主病態にする
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {selectedTemplateIds.map((id) => (
            <input key={id} type="hidden" name="diseaseTemplateIds" value={id} />
          ))}
          <input type="hidden" name="primaryTemplateId" value={primaryTemplateId ?? ""} />

          <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700, marginBottom: 6 }}>
            疾患ごとに微調整
          </div>
          {selectedTemplateIds.length === 0 ? (
            <div className="empty-note">病態テンプレートを1つ以上選択してください。</div>
          ) : (
            templates
              .filter((t) => selectedTemplateIds.includes(t.id))
              .map((t) => (
                <div key={t.id} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                    {t.name}
                    {primaryTemplateId === t.id && <span className="badge teal" style={{ fontSize: 10 }}>主病態</span>}
                  </div>
                  {t.isInfectious && (
                    <div className="field" style={{ marginBottom: 8, maxWidth: 360 }}>
                      <label>原因菌（感染症エンジン。任意）</label>
                      <select
                        name={`tpl_${t.id}_pathogenId`}
                        value={pathogenIdByTemplate[t.id] ?? ""}
                        onChange={(e) => setPathogenIdByTemplate((prev) => ({ ...prev, [t.id]: e.target.value }))}
                      >
                        <option value="">未設定（従来通りの固定サンプル結果）</option>
                        {pathogens.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 4 }}>
                        設定すると、培養系検査（血液培養等）がこの原因菌に基づく速報→確定の2段階結果（感受性検査つき）を返すようになります。
                      </div>
                    </div>
                  )}
                  <PhysiologySliders
                    initial={physiologyValuesByTemplate[t.id] ?? t.defaultParams}
                    namePrefix={`tpl_${t.id}_`}
                    onChange={(values) => setPhysiologyValuesByTemplate((prev) => ({ ...prev, [t.id]: values }))}
                  />
                </div>
              ))
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h">問診・身体診察AIの台本</div>
        <div className="card-b form-grid">
          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 8 }}>
              <label htmlFor="historyScript" style={{ marginBottom: 0 }}>
                問診シナリオ（現病歴・既往歴・アレルギー・生活歴など）
              </label>
              <button
                type="button"
                className="btn ghost"
                style={{ fontSize: 11, padding: "3px 10px", whiteSpace: "nowrap" }}
                onClick={() => handleGeneratePrompt("history")}
              >
                {copiedKind === "history" ? "✓ コピーしました" : "Gemini用プロンプトをコピー"}
              </button>
            </div>
            <textarea
              id="historyScript"
              name="historyScript"
              defaultValue={initial?.historyScript}
              placeholder="例: 3日前から38℃台の発熱と咳嗽。既往に糖尿病。喫煙歴20本/日×30年。アレルギーなし。"
              style={{ minHeight: 120, marginTop: 4 }}
            />
            {promptPreview?.kind === "history" && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ fontSize: 11, color: "var(--ink-soft)", cursor: "pointer" }}>
                  生成したプロンプトを確認・手動コピー
                </summary>
                <textarea
                  readOnly
                  value={promptPreview.text}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ minHeight: 160, marginTop: 4, fontSize: 11.5, color: "var(--ink-soft)" }}
                />
              </details>
            )}
          </div>
          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 8 }}>
              <label htmlFor="examScript" style={{ marginBottom: 0 }}>
                身体診察所見（視診・触診・打診・聴診など系統別）
              </label>
              <button
                type="button"
                className="btn ghost"
                style={{ fontSize: 11, padding: "3px 10px", whiteSpace: "nowrap" }}
                onClick={() => handleGeneratePrompt("exam")}
              >
                {copiedKind === "exam" ? "✓ コピーしました" : "Gemini用プロンプトをコピー"}
              </button>
            </div>
            <textarea
              id="examScript"
              name="examScript"
              defaultValue={initial?.examScript}
              placeholder="例: 右下肺野で断続性ラ音を聴取。腹部は平坦・軟、圧痛なし。下腿浮腫なし。"
              style={{ minHeight: 120, marginTop: 4 }}
            />
            {promptPreview?.kind === "exam" && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ fontSize: 11, color: "var(--ink-soft)", cursor: "pointer" }}>
                  生成したプロンプトを確認・手動コピー
                </summary>
                <textarea
                  readOnly
                  value={promptPreview.text}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ minHeight: 160, marginTop: 4, fontSize: 11.5, color: "var(--ink-soft)" }}
                />
              </details>
            )}
          </div>
          <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "var(--ink-soft)" }}>
            「Gemini用プロンプトをコピー」→Gemini等に貼り付けて生成→出力された文章をそのまま下の欄に貼り付けてください。ここに記載した内容がAI（模擬患者役）の応答の根拠になります。空欄の場合はプロブレムやバイタルと矛盾しない範囲でAIが即興で応答します。
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
              <label htmlFor="crisisMode">重症化した場合の危機シナリオ</label>
              <select id="crisisMode" name="crisisMode" value={crisisMode} onChange={(e) => setCrisisMode(e.target.value as CrisisMode)}>
                {CRISIS_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 4 }}>
                重症度・バイタルが一定以上悪化すると、通常の病態モデルと異なる急変挙動に切り替わります。
              </div>
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
              <label htmlFor="assigneeLoginIds">
                担当学生のログインID（カンマ区切り・任意{mode === "create" ? "、公開時のみ反映" : ""}）
              </label>
              <input
                id="assigneeLoginIds"
                name="assigneeLoginIds"
                defaultValue={initial?.assigneeLoginIds}
                placeholder="例: student1, student2"
              />
            </div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: "right", marginTop: 14 }}>
        {canPublish ? (
          <>
            <button type="submit" name="intent" value="draft" className="btn ghost">
              下書き保存
            </button>{" "}
            <button type="submit" name="intent" value="publish" className="btn primary">
              症例を公開
            </button>
          </>
        ) : (
          <button type="submit" name="intent" value="draft" className="btn primary">
            保存
          </button>
        )}
      </div>
    </form>
  );
}
