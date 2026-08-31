import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime } from "@/lib/format";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PhysiologySliders } from "@/components/PhysiologySliders";
import { DEFAULT_PHYSIOLOGY_PARAMS } from "@/lib/physiology";
import { getTemplateConfig, parsePhysiologyParams } from "@/lib/physiology-engine";
import { createTemplate, deleteTemplate, updateTemplate } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  in_use: "このテンプレートは既に症例で使用されているため削除できません。",
  duplicate_key: "そのキーは既に使われています。別のキーを指定してください。",
};

export default async function AdminTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { error } = await searchParams;

  const templates = await db.diseaseTemplate.findMany({ orderBy: { createdAt: "asc" } });

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
          が付いたテンプレートは、キーに対応する重症度計算ロジックがまだ実装されていないため、症例作成時にスライダーは表示されますが動的なバイタル・所見の変化には反映されません（開発側でのロジック追加が必要です）。
        </div>

        {templates.map((t) => {
          const engineReady = !!getTemplateConfig(t.key);
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
