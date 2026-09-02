import type { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime } from "@/lib/format";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PhysiologySliders } from "@/components/PhysiologySliders";
import { DEFAULT_PHYSIOLOGY_PARAMS } from "@/lib/physiology";
import { parsePhysiologyParams } from "@/lib/physiology-engine";
import { VITAL_FIELDS } from "@/lib/vital-fields";
import {
  addCrisisRescueAction,
  addCrisisTrigger,
  addLabPatternValue,
  createCrisisScenario,
  createLabPattern,
  createTemplate,
  deleteCrisisRescueAction,
  deleteCrisisScenario,
  deleteCrisisTrigger,
  deleteLabPattern,
  deleteLabPatternValue,
  deleteTemplate,
  updateAiEvaluationGuideline,
  updateCrisisRescueAction,
  updateCrisisScenario,
  updateCrisisTrigger,
  updateLabPatternCode,
  updateLabPatternText,
  updateLabPatternValue,
  updateTemplate,
  updateTemplateEngineConfig,
} from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  in_use: "このテンプレートは既に症例で使用されているため削除できません。",
  duplicate_key: "そのキーは既に使われています。別のキーを指定してください。",
};

const TEMPLATE_INCLUDE = {
  labPatterns: { include: { values: { orderBy: { sortOrder: "asc" as const } } }, orderBy: { sortOrder: "asc" as const } },
  crisis: {
    include: {
      triggers: { orderBy: { sortOrder: "asc" as const } },
      rescueActions: { orderBy: { sortOrder: "asc" as const } },
    },
  },
} satisfies Prisma.DiseaseTemplateInclude;

type TemplateWithRelations = Prisma.DiseaseTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;

const TIER_LABELS: Record<string, string> = { mild: "軽症", moderate: "中等症", severe: "重症" };

export default async function AdminTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { error } = await searchParams;

  const templates = await db.diseaseTemplate.findMany({ orderBy: { createdAt: "asc" }, include: TEMPLATE_INCLUDE });

  return (
    <>
      <div className="topbar">
        <h1>病態テンプレート</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        {error && ERROR_MESSAGES[error] && (
          <div className="banner-error" style={{ marginBottom: 14 }}>
            {ERROR_MESSAGES[error]}
          </div>
        )}

        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 14 }}>
          <span className="badge amber" style={{ marginRight: 6 }}>
            エンジン未対応
          </span>
          が付いたテンプレートは、「治療開始条件・バイタル係数」が未入力のため、症例作成時にスライダーは表示されますが動的なバイタル・所見の変化には反映されません。下のフォームから入力すると対応します。
        </div>

        {templates.map((t) => {
          const engineReady = !!t.vitalsConfig && !!t.treatmentConfig;
          const vitals = t.vitalsConfig ? (JSON.parse(t.vitalsConfig) as { base: Record<string, number>; perSeverity: Record<string, number> }) : null;
          const treatment = t.treatmentConfig ? (JSON.parse(t.treatmentConfig) as { drugCategories?: string[]; procedureKeywords?: string[] }) : null;

          return (
            <div className="card" key={t.id}>
              <div className="card-h">
                {t.name}
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span className="badge blue">{t.isCommon ? "共通" : "個別"}</span>
                  {!engineReady && <span className="badge amber">エンジン未対応</span>}
                  <span style={{ fontSize: 11, color: "var(--ink-soft)", fontWeight: 400 }}>key: {t.key}</span>
                </span>
              </div>
              <form action={updateTemplate.bind(null, t.id)} className="card-b">
                <div className="form-grid" style={{ marginBottom: 14 }}>
                  <div className="field">
                    <label htmlFor={`name-${t.id}`}>テンプレート名</label>
                    <input id={`name-${t.id}`} name="name" defaultValue={t.name} required />
                  </div>
                  <div className="field">
                    <label>担当形態</label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, padding: "8px 0" }}>
                      <input type="checkbox" name="isCommon" defaultChecked={t.isCommon} />
                      共通テンプレートとして全教員に公開する
                    </label>
                  </div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label htmlFor={`description-${t.id}`}>説明</label>
                    <input id={`description-${t.id}`} name="description" defaultValue={t.description ?? ""} />
                  </div>
                </div>

                <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700, marginBottom: 6 }}>
                  既定パラメータ（症例作成時の初期スライダー位置）
                </div>
                <PhysiologySliders initial={parsePhysiologyParams(t.defaultParams)} />

                <div style={{ textAlign: "right", marginTop: 12 }}>
                  <button type="submit" className="btn primary">
                    更新
                  </button>{" "}
                  <ConfirmButton
                    formAction={deleteTemplate.bind(null, t.id)}
                    confirmText={`「${t.name}」を削除しますか？`}
                    className="btn danger"
                  >
                    削除
                  </ConfirmButton>
                </div>
              </form>

              <div className="card-b" style={{ borderTop: "1px solid var(--line-soft)" }}>
                <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700, marginBottom: 6 }}>
                  治療開始条件・バイタル係数
                </div>
                <form action={updateTemplateEngineConfig.bind(null, t.id)}>
                  <div className="form-grid" style={{ marginBottom: 10 }}>
                    <div className="field">
                      <label htmlFor={`drugCategories-${t.id}`}>治療とみなす薬剤大分類（カンマ区切り）</label>
                      <input
                        id={`drugCategories-${t.id}`}
                        name="drugCategories"
                        defaultValue={treatment?.drugCategories?.join(", ") ?? ""}
                        placeholder="例: 抗菌薬, 輸液"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`procedureKeywords-${t.id}`}>治療とみなす処置キーワード（カンマ区切り・部分一致）</label>
                      <input
                        id={`procedureKeywords-${t.id}`}
                        name="procedureKeywords"
                        defaultValue={treatment?.procedureKeywords?.join(", ") ?? ""}
                        placeholder="例: 気管挿管"
                      />
                    </div>
                  </div>

                  <VitalPointGrid prefix="base" title="基準値（重症度0）" defaults={vitals?.base} />
                  <VitalPointGrid prefix="perSeverity" title="重症度100あたりの増減量" defaults={vitals?.perSeverity} />

                  <div style={{ textAlign: "right", marginTop: 10 }}>
                    <button type="submit" className="btn primary">
                      治療条件・バイタル係数を保存
                    </button>
                  </div>
                </form>
              </div>

              <AiEvaluationSection template={t} />
              <LabPatternsSection template={t} />
              <CrisisSection template={t} />
            </div>
          );
        })}

        <div className="card">
          <div className="card-h">新規テンプレートを登録</div>
          <form action={createTemplate} className="card-b">
            <div className="form-grid" style={{ marginBottom: 14 }}>
              <div className="field">
                <label htmlFor="key">キー（半角英数・アンダースコア、後から変更不可）</label>
                <input id="key" name="key" required placeholder="例: copd" pattern="[a-z0-9_]+" />
              </div>
              <div className="field">
                <label htmlFor="new-name">テンプレート名</label>
                <input id="new-name" name="name" required placeholder="例: COPD増悪" />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="new-description">説明</label>
                <input id="new-description" name="description" placeholder="例: 呼吸困難・SpO2低下の経時変化" />
              </div>
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, padding: "8px 0" }}>
                  <input type="checkbox" name="isCommon" defaultChecked />
                  共通テンプレートとして全教員に公開する
                </label>
              </div>
            </div>

            <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700, marginBottom: 6 }}>
              既定パラメータ
            </div>
            <PhysiologySliders initial={DEFAULT_PHYSIOLOGY_PARAMS} />

            <div style={{ textAlign: "right", marginTop: 12 }}>
              <button type="submit" className="btn primary">
                登録
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

function VitalPointGrid({
  prefix,
  title,
  defaults,
}: {
  prefix: string;
  title: string;
  defaults?: Record<string, number>;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 4 }}>{title}</div>
      <div className="form-grid" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
        {VITAL_FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label>
              {f.label}（{f.unit}）
            </label>
            <input
              type="number"
              step={f.step}
              name={`${prefix}_${f.key}`}
              defaultValue={defaults?.[f.key] ?? 0}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function AiEvaluationSection({ template }: { template: TemplateWithRelations }) {
  return (
    <div className="card-b" style={{ borderTop: "1px solid var(--line-soft)" }}>
      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        AI治療評価ルーブリック
        {!template.aiEvaluationGuideline && <span className="badge amber">未設定（AI評価は発生しません）</span>}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 8 }}>
        学生が治療系オーダー（処方・注射・処置）を提出するたびに、ここに書いた基準に沿ってGeminiが治療内容を採点します。
        評価は重症度を直接ジャンプさせるのではなく「今の治療方針が続いた場合の時間あたりの改善/悪化の速さ」として反映されるため、
        無害なオーダーが何度混ざっても改善が二重に計上されることはありません。ただし、禁忌薬剤の使用など重大な問題をルーブリックで
        明記しておくと、それに該当した場合はその場で一気に重症化します（急変シナリオの発生中は反映されません）。
        空欄のままだとこのテンプレートではAI評価は動作しません。
      </div>
      <form action={updateAiEvaluationGuideline.bind(null, template.id)}>
        <div className="field">
          <label htmlFor={`aiEvaluationGuideline-${template.id}`}>期待される治療方針・採点基準</label>
          <textarea
            id={`aiEvaluationGuideline-${template.id}`}
            name="aiEvaluationGuideline"
            defaultValue={template.aiEvaluationGuideline ?? ""}
            rows={6}
            placeholder={"例:\n・第一選択は○○系抗菌薬の早期投与\n・輸液蘇生（細胞外液）が発症3時間以内に開始されていれば高評価\n・禁忌薬剤（△△）の使用は大幅減点"}
          />
        </div>
        <div style={{ textAlign: "right", marginTop: 8 }}>
          <button type="submit" className="btn primary">
            ルーブリックを保存
          </button>
        </div>
      </form>
    </div>
  );
}

function LabPatternsSection({ template }: { template: TemplateWithRelations }) {
  return (
    <div className="card-b" style={{ borderTop: "1px solid var(--line-soft)" }}>
      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700, marginBottom: 6 }}>
        検査所見パターン（重症度に応じた検査結果の出し分け）
      </div>

      {template.labPatterns.map((p) => (
        <div key={p.id} className="mrow-group" style={{ marginBottom: 10, border: "1px solid var(--line-soft)", borderRadius: 8 }}>
          {p.kind === "text" ? (
            <form action={updateLabPatternText.bind(null, p.id)} style={{ padding: 10 }}>
              <div className="form-grid" style={{ marginBottom: 6 }}>
                <div className="field">
                  <label>検査項目コード</label>
                  <input name="labItemCode" defaultValue={p.labItemCode} required />
                </div>
                <div className="field">
                  <label>種別</label>
                  <div style={{ padding: "8px 0", fontSize: 12 }}>
                    <span className="badge blue">定性所見（テキスト）</span>
                  </div>
                </div>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>軽症</label>
                  <textarea name="mildText" defaultValue={p.mildText ?? ""} rows={2} />
                </div>
                <div className="field">
                  <label>中等症</label>
                  <textarea name="moderateText" defaultValue={p.moderateText ?? ""} rows={2} />
                </div>
                <div className="field">
                  <label>重症</label>
                  <textarea name="severeText" defaultValue={p.severeText ?? ""} rows={2} />
                </div>
              </div>
              <div style={{ textAlign: "right", marginTop: 8 }}>
                <button type="submit" className="btn">
                  保存
                </button>{" "}
                <ConfirmButton
                  formAction={deleteLabPattern.bind(null, p.id)}
                  confirmText={`検査所見パターン「${p.labItemCode}」を削除しますか？`}
                  className="btn danger"
                >
                  削除
                </ConfirmButton>
              </div>
            </form>
          ) : (
            <div style={{ padding: 10 }}>
              <form action={updateLabPatternCode.bind(null, p.id)}>
                <div className="form-grid" style={{ marginBottom: 6, alignItems: "end" }}>
                  <div className="field">
                    <label>検査項目コード</label>
                    <input name="labItemCode" defaultValue={p.labItemCode} required />
                  </div>
                  <div className="field">
                    <label>種別</label>
                    <div style={{ padding: "8px 0", fontSize: 12 }}>
                      <span className="badge teal">数値所見（1コードで複数値可）</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <button type="submit" className="btn">
                      コードを保存
                    </button>{" "}
                    <ConfirmButton
                      formAction={deleteLabPattern.bind(null, p.id)}
                      confirmText={`検査所見パターン「${p.labItemCode}」を削除しますか？`}
                      className="btn danger"
                    >
                      削除
                    </ConfirmButton>
                  </div>
                </div>
              </form>

              {(["mild", "moderate", "severe"] as const).map((tier) => (
                <div key={tier} className="alias-row" style={{ minWidth: 0, padding: "6px 0" }}>
                  <span className="alias-row-label">{TIER_LABELS[tier]}:</span>
                  {p.values
                    .filter((v) => v.tier === tier)
                    .map((v) => (
                      <form
                        key={v.id}
                        action={updateLabPatternValue.bind(null, v.id)}
                        className="alias-chip"
                        style={{ borderRadius: 6, gap: 6 }}
                      >
                        <input name="label" defaultValue={v.label} style={{ width: 72 }} required />
                        <input name="value" type="number" step="any" defaultValue={v.value} style={{ width: 70 }} required />
                        <input name="unit" defaultValue={v.unit} style={{ width: 56 }} />
                        <input name="note" defaultValue={v.note ?? ""} placeholder="補足" style={{ width: 90 }} />
                        <button type="submit" className="btn" style={{ padding: "3px 8px", fontSize: 11 }}>
                          保存
                        </button>
                        <button
                          type="submit"
                          formAction={deleteLabPatternValue.bind(null, v.id)}
                          className="alias-chip-remove"
                          aria-label="削除"
                        >
                          ×
                        </button>
                      </form>
                    ))}
                  <form action={addLabPatternValue.bind(null, p.id, tier)} className="alias-add-form">
                    <input name="label" placeholder="項目名" style={{ width: 72 }} required />
                    <input name="value" type="number" step="any" placeholder="値" style={{ width: 70 }} required />
                    <input name="unit" placeholder="単位" style={{ width: 56 }} />
                    <input name="note" placeholder="補足(任意)" style={{ width: 90 }} />
                    <button type="submit" className="btn">
                      追加
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <form action={createLabPattern.bind(null, template.id)} className="alias-add-form" style={{ flexWrap: "wrap" }}>
        <input name="labItemCode" placeholder="検査項目コード（例: 5C070）" required />
        <select name="kind" defaultValue="values" style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--line)" }}>
          <option value="values">数値所見</option>
          <option value="text">定性所見（テキスト）</option>
        </select>
        <button type="submit" className="btn">
          検査所見パターンを追加
        </button>
      </form>
    </div>
  );
}

function CrisisSection({ template }: { template: TemplateWithRelations }) {
  const crisis = template.crisis;

  if (!crisis) {
    return (
      <div className="card-b" style={{ borderTop: "1px solid var(--line-soft)" }}>
        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700, marginBottom: 6 }}>
          急変シナリオ（未設定 — このテンプレートでは急変は発生しません）
        </div>
        <form action={createCrisisScenario.bind(null, template.id)}>
          <div className="form-grid" style={{ marginBottom: 8 }}>
            <div className="field">
              <label>シナリオ名</label>
              <input name="name" required placeholder="例: 敗血症性ショック・心停止" />
            </div>
            <div className="field">
              <label>猶予時間（分）</label>
              <input name="windowMinutes" type="number" defaultValue={480} min={1} />
            </div>
            <div className="field">
              <label>救命成功後の重症度（0-100）</label>
              <input name="postRescueSeverity" type="number" defaultValue={50} min={0} max={100} />
            </div>
          </div>
          <VitalPointGrid prefix="crisisVitals" title="急変中に固定表示するバイタル" />
          <div style={{ textAlign: "right", marginTop: 8 }}>
            <button type="submit" className="btn primary">
              急変シナリオを作成
            </button>
          </div>
        </form>
      </div>
    );
  }

  const crisisVitals = JSON.parse(crisis.crisisVitals) as Record<string, number>;

  return (
    <div className="card-b" style={{ borderTop: "1px solid var(--line-soft)" }}>
      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        急変シナリオ
        {crisis.rescueActions.length === 0 && (
          <span className="badge red">救命アクション未設定（脱出不能）</span>
        )}
        {crisis.triggers.length === 0 && <span className="badge amber">発動条件未設定（発生しません）</span>}
      </div>

      <form action={updateCrisisScenario.bind(null, crisis.id)} style={{ marginBottom: 12 }}>
        <div className="form-grid" style={{ marginBottom: 8 }}>
          <div className="field">
            <label>シナリオ名</label>
            <input name="name" defaultValue={crisis.name} required />
          </div>
          <div className="field">
            <label>猶予時間（分）</label>
            <input name="windowMinutes" type="number" defaultValue={crisis.windowMinutes} min={1} />
          </div>
          <div className="field">
            <label>救命成功後の重症度（0-100）</label>
            <input name="postRescueSeverity" type="number" defaultValue={crisis.postRescueSeverity} min={0} max={100} />
          </div>
        </div>
        <VitalPointGrid prefix="crisisVitals" title="急変中に固定表示するバイタル" defaults={crisisVitals} />
        <div style={{ textAlign: "right", marginTop: 8 }}>
          <button type="submit" className="btn primary">
            シナリオを保存
          </button>{" "}
          <ConfirmButton
            formAction={deleteCrisisScenario.bind(null, crisis.id)}
            confirmText={`「${crisis.name}」を削除しますか？（発動条件・救命アクションも全て削除されます）`}
            className="btn danger"
          >
            シナリオを削除
          </ConfirmButton>
        </div>
      </form>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 4 }}>発動条件（いずれか1つで発動）</div>
        {crisis.triggers.map((tr) => (
          <form
            key={tr.id}
            action={updateCrisisTrigger.bind(null, tr.id)}
            className="mrow"
            style={{ gridTemplateColumns: "0.8fr 1fr 1fr 0.7fr 0.8fr auto", minWidth: 560 }}
          >
            <select name="type" defaultValue={tr.type}>
              <option value="severity">重症度</option>
              <option value="lab">検査値</option>
              <option value="vital">バイタル</option>
            </select>
            <input name="code" defaultValue={tr.code ?? ""} placeholder="検査コード(検査値のとき)" />
            <input name="label" defaultValue={tr.label ?? ""} placeholder="ラベル(任意、複数値の検査のとき)" />
            <select name="field" defaultValue={tr.field ?? ""}>
              <option value="">(バイタルのとき選択)</option>
              {VITAL_FIELDS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            <span style={{ display: "flex", gap: 4 }}>
              <select name="op" defaultValue={tr.op}>
                <option value=">=">以上</option>
                <option value="<=">以下</option>
              </select>
              <input name="value" type="number" step="any" defaultValue={tr.value} style={{ width: 70 }} required />
            </span>
            <span className="actions">
              <button type="submit" className="btn" style={{ padding: "4px 8px", fontSize: 11 }}>
                保存
              </button>
              <button
                type="submit"
                formAction={deleteCrisisTrigger.bind(null, tr.id)}
                className="btn danger"
                style={{ padding: "4px 8px", fontSize: 11 }}
              >
                削除
              </button>
            </span>
          </form>
        ))}
        <form
          action={addCrisisTrigger.bind(null, crisis.id)}
          className="mrow"
          style={{ gridTemplateColumns: "0.8fr 1fr 1fr 0.7fr 0.8fr auto", minWidth: 560, background: "var(--line-soft)" }}
        >
          <select name="type" defaultValue="severity">
            <option value="severity">重症度</option>
            <option value="lab">検査値</option>
            <option value="vital">バイタル</option>
          </select>
          <input name="code" placeholder="検査コード(検査値のとき)" />
          <input name="label" placeholder="ラベル(任意)" />
          <select name="field" defaultValue="">
            <option value="">(バイタルのとき選択)</option>
            {VITAL_FIELDS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          <span style={{ display: "flex", gap: 4 }}>
            <select name="op" defaultValue=">=">
              <option value=">=">以上</option>
              <option value="<=">以下</option>
            </select>
            <input name="value" type="number" step="any" placeholder="閾値" style={{ width: 70 }} required />
          </span>
          <span className="actions">
            <button type="submit" className="btn">
              条件を追加
            </button>
          </span>
        </form>
      </div>

      <div>
        <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 4 }}>救命アクション（いずれか1つのオーダーで脱出）</div>
        {crisis.rescueActions.map((ra) => (
          <form key={ra.id} action={updateCrisisRescueAction.bind(null, ra.id)} className="alias-add-form" style={{ marginBottom: 6 }}>
            <input name="label" defaultValue={ra.label} placeholder="表示名" style={{ width: 140 }} required />
            <input
              name="drugCategories"
              defaultValue={(JSON.parse(ra.drugCategories) as string[]).join(", ")}
              placeholder="薬剤大分類(カンマ区切り)"
              style={{ width: 160 }}
            />
            <input
              name="procedureKeywords"
              defaultValue={(JSON.parse(ra.procedureKeywords) as string[]).join(", ")}
              placeholder="処置キーワード(カンマ区切り)"
              style={{ width: 160 }}
            />
            <button type="submit" className="btn">
              保存
            </button>
            <button type="submit" formAction={deleteCrisisRescueAction.bind(null, ra.id)} className="btn danger">
              削除
            </button>
          </form>
        ))}
        <form action={addCrisisRescueAction.bind(null, crisis.id)} className="alias-add-form">
          <input name="label" placeholder="表示名" style={{ width: 140 }} required />
          <input name="drugCategories" placeholder="薬剤大分類(カンマ区切り)" style={{ width: 160 }} />
          <input name="procedureKeywords" placeholder="処置キーワード(カンマ区切り)" style={{ width: 160 }} />
          <button type="submit" className="btn">
            救命アクションを追加
          </button>
        </form>
      </div>
    </div>
  );
}
