import type { Prisma, PhysiologyBaselineBand } from "@prisma/client";
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
  createCrisisRescueConfig,
  createCrisisTriggerScenario,
  createLabPattern,
  createPhysiologyBaselineBand,
  createTemplate,
  deleteCrisisRescueAction,
  deleteCrisisRescueConfig,
  deleteCrisisTrigger,
  deleteCrisisTriggerScenario,
  deleteLabPattern,
  deleteLabPatternValue,
  deletePhysiologyBaselineBand,
  deleteTemplate,
  updateAiEvaluationGuideline,
  updateCrisisRescueAction,
  updateCrisisRescueConfig,
  updateCrisisTrigger,
  updateCrisisTriggerScenario,
  updateLabPatternCode,
  updateLabPatternText,
  updateLabPatternValue,
  updateBasePhysiologyModel,
  updatePhysiologyBaselineBand,
  updateTemplate,
  updateTemplateEngineConfig,
} from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  in_use: "このテンプレートは既に症例で使用されているため削除できません。",
  duplicate_key: "そのキーは既に使われています。別のキーを指定してください。",
};

const TEMPLATE_INCLUDE = {
  labPatterns: { include: { values: { orderBy: { sortOrder: "asc" as const } } }, orderBy: { sortOrder: "asc" as const } },
  crisisTriggers: {
    include: {
      triggers: { orderBy: { sortOrder: "asc" as const } },
      targetTemplate: { select: { id: true, name: true } },
    },
    orderBy: { sortOrder: "asc" as const },
  },
  crisisRescue: { include: { rescueActions: { orderBy: { sortOrder: "asc" as const } } } },
} satisfies Prisma.DiseaseTemplateInclude;

type TemplateWithRelations = Prisma.DiseaseTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;

const TIER_LABELS: Record<string, string> = { mild: "軽症", moderate: "中等症", severe: "重症" };

// drugCategories/procedureKeywordsは常にJSON.stringify(string[])で保存される想定だが、
// 壊れた値が1件でも混ざると未ガードのJSON.parseがページ全体をクラッシュさせてしまうため防御的に扱う。
function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export default async function AdminTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { error } = await searchParams;

  const templates = await db.diseaseTemplate.findMany({ orderBy: { createdAt: "asc" }, include: TEMPLATE_INCLUDE });
  const basePhysiology = await db.basePhysiologyModel.findUnique({ where: { id: "default" } });
  const baselineBands = await db.physiologyBaselineBand.findMany({ orderBy: { sortOrder: "asc" } });

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

        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-h">基礎生理モデル</div>
          <div className="card-b">
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 8 }}>
              疾患が何もない状態でのバイタルの基準値。生理モデルはここへ、アタッチされた各病態テンプレートの
              「重症度100あたりの増減量」を自身の重症度に応じて単純加算し、最終的なバイタルを算出する。
            </div>
            <form action={updateBasePhysiologyModel}>
              <VitalPointGrid
                prefix="base"
                title="基準値"
                defaults={
                  basePhysiology
                    ? {
                        temperature: basePhysiology.temperature,
                        systolicBp: basePhysiology.systolicBp,
                        diastolicBp: basePhysiology.diastolicBp,
                        pulse: basePhysiology.pulse,
                        spo2: basePhysiology.spo2,
                        respRate: basePhysiology.respRate,
                      }
                    : undefined
                }
              />
              <div style={{ textAlign: "right", marginTop: 8 }}>
                <button type="submit" className="btn primary">
                  基礎生理モデルを保存
                </button>
              </div>
            </form>
          </div>
        </div>

        <PhysiologyBaselineBandSection bands={baselineBands} />

        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 14 }}>
          <span className="badge amber" style={{ marginRight: 6 }}>
            エンジン未対応
          </span>
          が付いたテンプレートは、「治療開始条件・バイタル係数」が未入力のため、症例作成時にスライダーは表示されますが動的なバイタル・所見の変化には反映されません。下のフォームから入力すると対応します。
        </div>

        {templates.map((t) => {
          const engineReady = !!t.vitalsConfig && !!t.treatmentConfig;
          const vitals = t.vitalsConfig ? (JSON.parse(t.vitalsConfig) as { perSeverity: Record<string, number> }) : null;
          const treatment = t.treatmentConfig ? (JSON.parse(t.treatmentConfig) as { drugCategories?: string[]; procedureKeywords?: string[] }) : null;

          return (
            <div className="card" key={t.id}>
              <div className="card-h">
                {t.name}
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span className="badge blue">{t.isCommon ? "共通" : "個別"}</span>
                  {t.isCrisisPathology && <span className="badge red">危機病態</span>}
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
                  <div className="field">
                    <label>感染症エンジン</label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, padding: "8px 0" }}>
                      <input type="checkbox" name="isInfectious" defaultChecked={t.isInfectious} />
                      症例作成画面で「真の原因菌」を選択できるようにする
                    </label>
                  </div>
                  <div className="field">
                    <label>危機病態</label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, padding: "8px 0" }}>
                      <input type="checkbox" name="isCrisisPathology" defaultChecked={t.isCrisisPathology} />
                      危機病態として扱う（急変シナリオのアタッチ先として使う）
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

                  <VitalPointGrid prefix="perSeverity" title="重症度100あたりの増減量（基礎生理モデルへ加算）" defaults={vitals?.perSeverity} />

                  <div style={{ textAlign: "right", marginTop: 10 }}>
                    <button type="submit" className="btn primary">
                      治療条件・バイタル係数を保存
                    </button>
                  </div>
                </form>
              </div>

              <AiEvaluationSection template={t} />
              <LabPatternsSection template={t} />
              <CrisisSection template={t} allTemplates={templates} />
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
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, padding: "8px 0" }}>
                  <input type="checkbox" name="isInfectious" />
                  症例作成画面で「真の原因菌」を選択できるようにする
                </label>
              </div>
              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, padding: "8px 0" }}>
                  <input type="checkbox" name="isCrisisPathology" />
                  危機病態として扱う（急変シナリオのアタッチ先として使う）
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

function PhysiologyBaselineBandSection({ bands }: { bands: PhysiologyBaselineBand[] }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-h">年齢・性別による基礎値の調整</div>
      <div className="card-b">
        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginBottom: 8 }}>
          症例の年齢・性別が該当する帯域があれば、上の基礎生理モデルの代わりにこちらの値を基準値として使う（該当する帯域が無ければ上へフォールバック）。
          年齢が複数の帯域に該当する場合、性別が完全一致する行を優先し、次に「共通」の行を使う。
          また、各病態テンプレートの「重症度100あたりの増減量」は上の基礎生理モデルを基準に定義されているため、実際の基礎値がそれと異なる場合は
          （実際の基礎値 ÷ 基礎生理モデルの値）の比率でスケーリングしてから加算する（例: 小児は基礎脈拍が高い分、同じ増減量でもより大きく変化する）。
        </div>

        {bands.length === 0 && (
          <div className="empty-note" style={{ marginBottom: 8 }}>
            帯域は未設定です（全症例が上の基礎生理モデルをそのまま使用します）。
          </div>
        )}

        {bands.map((b) => (
          <form
            key={b.id}
            action={updatePhysiologyBaselineBand.bind(null, b.id)}
            className="mrow-group"
            style={{ marginBottom: 10, border: "1px solid var(--line-soft)", borderRadius: 8, padding: 10 }}
          >
            <div className="form-grid" style={{ marginBottom: 8, alignItems: "end" }}>
              <div className="field">
                <label>ラベル</label>
                <input name="label" defaultValue={b.label} required />
              </div>
              <div className="field">
                <label>最小年齢</label>
                <input name="minAge" type="number" defaultValue={b.minAge} min={0} max={120} required />
              </div>
              <div className="field">
                <label>最大年齢</label>
                <input name="maxAge" type="number" defaultValue={b.maxAge} min={0} max={120} required />
              </div>
              <div className="field">
                <label>性別</label>
                <select name="gender" defaultValue={b.gender}>
                  <option value="共通">共通</option>
                  <option value="男性">男性</option>
                  <option value="女性">女性</option>
                </select>
              </div>
            </div>
            <VitalPointGrid
              prefix="band"
              title="基準値"
              defaults={{
                temperature: b.temperature,
                systolicBp: b.systolicBp,
                diastolicBp: b.diastolicBp,
                pulse: b.pulse,
                spo2: b.spo2,
                respRate: b.respRate,
              }}
            />
            <div style={{ textAlign: "right", marginTop: 8 }}>
              <button type="submit" className="btn primary" style={{ marginRight: 6 }}>
                保存
              </button>
              <ConfirmButton
                formAction={deletePhysiologyBaselineBand.bind(null, b.id)}
                confirmText={`「${b.label}」を削除しますか？`}
                className="btn danger"
              >
                削除
              </ConfirmButton>
            </div>
          </form>
        ))}

        <form action={createPhysiologyBaselineBand} style={{ background: "var(--line-soft)", padding: 10, borderRadius: 8 }}>
          <div className="form-grid" style={{ marginBottom: 8, alignItems: "end" }}>
            <div className="field">
              <label>ラベル</label>
              <input name="label" required placeholder="例: 幼児(1-5歳)" />
            </div>
            <div className="field">
              <label>最小年齢</label>
              <input name="minAge" type="number" min={0} max={120} required />
            </div>
            <div className="field">
              <label>最大年齢</label>
              <input name="maxAge" type="number" min={0} max={120} required />
            </div>
            <div className="field">
              <label>性別</label>
              <select name="gender" defaultValue="共通">
                <option value="共通">共通</option>
                <option value="男性">男性</option>
                <option value="女性">女性</option>
              </select>
            </div>
          </div>
          <VitalPointGrid prefix="band" title="基準値" />
          <div style={{ textAlign: "right", marginTop: 8 }}>
            <button type="submit" className="btn primary">
              帯域を追加
            </button>
          </div>
        </form>
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

function CrisisTriggerRowForm({
  action,
  defaults,
  onDelete,
}: {
  action: (formData: FormData) => void | Promise<void>;
  defaults?: { type: string; code: string | null; label: string | null; field: string | null; op: string; value: number };
  onDelete?: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="mrow" style={{ gridTemplateColumns: "0.8fr 1fr 1fr 0.7fr 0.8fr auto", minWidth: 560 }}>
      <select name="type" defaultValue={defaults?.type ?? "severity"}>
        <option value="severity">重症度</option>
        <option value="lab">検査値</option>
        <option value="vital">バイタル</option>
      </select>
      <input name="code" defaultValue={defaults?.code ?? ""} placeholder="検査コード(検査値のとき)" />
      <input name="label" defaultValue={defaults?.label ?? ""} placeholder="ラベル(任意、複数値の検査のとき)" />
      <select name="field" defaultValue={defaults?.field ?? ""}>
        <option value="">(バイタルのとき選択)</option>
        {VITAL_FIELDS.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
      <span style={{ display: "flex", gap: 4 }}>
        <select name="op" defaultValue={defaults?.op ?? ">="}>
          <option value=">=">以上</option>
          <option value="<=">以下</option>
        </select>
        <input name="value" type="number" step="any" defaultValue={defaults?.value} placeholder={defaults ? undefined : "閾値"} style={{ width: 70 }} required />
      </span>
      <span className="actions">
        <button type="submit" className="btn" style={{ padding: "4px 8px", fontSize: 11 }}>
          {defaults ? "保存" : "条件を追加"}
        </button>
        {onDelete && (
          <button type="submit" formAction={onDelete} className="btn danger" style={{ padding: "4px 8px", fontSize: 11 }}>
            削除
          </button>
        )}
      </span>
    </form>
  );
}

function CrisisSection({
  template,
  allTemplates,
}: {
  template: TemplateWithRelations;
  allTemplates: { id: string; name: string }[];
}) {
  const rescue = template.crisisRescue;

  return (
    <div className="card-b" style={{ borderTop: "1px solid var(--line-soft)" }}>
      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700, marginBottom: 6 }}>
        発火条件（この病態の状態を監視し、条件を満たすと指定した危機病態をアタッチ・主病態に昇格させる。複数の分岐を追加できる）
      </div>
      {template.crisisTriggers.length === 0 && (
        <div className="empty-note" style={{ marginBottom: 8 }}>
          発火条件は未設定です（この病態から急変は発生しません）。
        </div>
      )}

      {template.crisisTriggers.map((scenario) => (
        <div key={scenario.id} className="mrow-group" style={{ marginBottom: 10, border: "1px solid var(--line-soft)", borderRadius: 8, padding: 10 }}>
          <form action={updateCrisisTriggerScenario.bind(null, scenario.id)} style={{ marginBottom: 8 }}>
            <div className="form-grid" style={{ marginBottom: 8, alignItems: "end" }}>
              <div className="field">
                <label>危機病態（アタッチ先テンプレート）</label>
                <select name="targetTemplateId" defaultValue={scenario.targetTemplateId} required>
                  {allTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>持続時間（分）— この時間だけ発動条件が連続して満たされたらCRITICALへ</label>
                <input name="sustainMinutes" type="number" defaultValue={scenario.sustainMinutes} min={0} />
              </div>
              <div style={{ textAlign: "right" }}>
                <button type="submit" className="btn primary" style={{ marginRight: 6 }}>
                  保存
                </button>
                <ConfirmButton
                  formAction={deleteCrisisTriggerScenario.bind(null, scenario.id)}
                  confirmText={`「${scenario.targetTemplate.name}」への発火条件（この分岐）を削除しますか？`}
                  className="btn danger"
                >
                  分岐を削除
                </ConfirmButton>
              </div>
            </div>
          </form>

          <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 4 }}>発動条件（いずれか1つで発動）</div>
          {scenario.triggers.map((tr) => (
            <CrisisTriggerRowForm
              key={tr.id}
              action={updateCrisisTrigger.bind(null, tr.id)}
              defaults={tr}
              onDelete={deleteCrisisTrigger.bind(null, tr.id)}
            />
          ))}
          <CrisisTriggerRowForm action={addCrisisTrigger.bind(null, scenario.id)} />
        </div>
      ))}

      <form action={createCrisisTriggerScenario.bind(null, template.id)} className="form-grid" style={{ background: "var(--line-soft)", padding: 10, borderRadius: 8, alignItems: "end" }}>
        <div className="field">
          <label>危機病態（アタッチ先テンプレート）</label>
          <select name="targetTemplateId" required defaultValue="">
            <option value="" disabled>
              選択してください
            </option>
            {allTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>持続時間（分）</label>
          <input name="sustainMinutes" type="number" defaultValue={0} min={0} />
        </div>
        <div style={{ textAlign: "right" }}>
          <button type="submit" className="btn primary">
            分岐を追加
          </button>
        </div>
      </form>

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px dashed var(--line-soft)" }}>
        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
          救命設定（この病態が危機病態としてアタッチされた場合の性質）
          {rescue && rescue.rescueActions.length === 0 && <span className="badge red">救命アクション未設定（脱出不能）</span>}
        </div>

        {!rescue ? (
          <form action={createCrisisRescueConfig.bind(null, template.id)}>
            <div className="field" style={{ marginBottom: 8, maxWidth: 260 }}>
              <label>救命成功後の重症度（0-100）</label>
              <input name="postRescueSeverity" type="number" defaultValue={50} min={0} max={100} />
            </div>
            <div style={{ textAlign: "right" }}>
              <button type="submit" className="btn primary">
                救命設定を作成
              </button>
            </div>
          </form>
        ) : (
          <>
            <form action={updateCrisisRescueConfig.bind(null, rescue.id)} style={{ marginBottom: 12 }}>
              <div className="form-grid" style={{ marginBottom: 8, alignItems: "end" }}>
                <div className="field">
                  <label>救命成功後の重症度（0-100）</label>
                  <input name="postRescueSeverity" type="number" defaultValue={rescue.postRescueSeverity} min={0} max={100} />
                </div>
                <div style={{ textAlign: "right" }}>
                  <button type="submit" className="btn primary" style={{ marginRight: 6 }}>
                    保存
                  </button>
                  <ConfirmButton
                    formAction={deleteCrisisRescueConfig.bind(null, rescue.id)}
                    confirmText="救命設定を削除しますか？（救命アクションも全て削除されます）"
                    className="btn danger"
                  >
                    削除
                  </ConfirmButton>
                </div>
              </div>
            </form>

            <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 4 }}>救命アクション（いずれか1つのオーダーで脱出）</div>
            {rescue.rescueActions.map((ra) => (
              <form key={ra.id} action={updateCrisisRescueAction.bind(null, ra.id)} className="alias-add-form" style={{ marginBottom: 6 }}>
                <input name="label" defaultValue={ra.label} placeholder="表示名" style={{ width: 140 }} required />
                <input
                  name="drugCategories"
                  defaultValue={parseStringArray(ra.drugCategories).join(", ")}
                  placeholder="薬剤大分類(カンマ区切り)"
                  style={{ width: 160 }}
                />
                <input
                  name="procedureKeywords"
                  defaultValue={parseStringArray(ra.procedureKeywords).join(", ")}
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
            <form action={addCrisisRescueAction.bind(null, rescue.id)} className="alias-add-form">
              <input name="label" placeholder="表示名" style={{ width: 140 }} required />
              <input name="drugCategories" placeholder="薬剤大分類(カンマ区切り)" style={{ width: 160 }} />
              <input name="procedureKeywords" placeholder="処置キーワード(カンマ区切り)" style={{ width: 160 }} />
              <button type="submit" className="btn">
                救命アクションを追加
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
