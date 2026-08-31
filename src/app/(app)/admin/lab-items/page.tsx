import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime } from "@/lib/format";
import { ConfirmButton } from "@/components/ConfirmButton";
import { isEngineLinkedLabCode } from "@/lib/physiology-engine";
import { createLabItem, deleteLabItem, updateLabItem } from "./actions";

const COLS = "0.9fr 1.3fr 1fr 1fr 0.6fr 1.8fr auto";

export default async function AdminLabItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { error } = await searchParams;

  const labItems = await db.labItemMaster.findMany({ orderBy: { name: "asc" } });

  return (
    <>
      <div className="topbar">
        <h1>検査項目マスター</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        {error === "in_use" && (
          <div className="banner-error" style={{ marginBottom: 14 }}>
            この検査項目は既にオーダーで使用されているため削除できません。
          </div>
        )}

        <div className="card">
          <div className="card-h">登録済み検査項目（{labItems.length}件）</div>
          <div style={{ padding: "10px 16px 0", fontSize: 11.5, color: "var(--ink-soft)" }}>
            <span className="badge blue" style={{ marginRight: 6 }}>
              連動
            </span>
            は病態テンプレートの動的な所見文で使われている項目です。コードや意味合いを変えると症例エンジンの表示が変わります。
          </div>
          <div className="mrow-wrap">
            <div className="mrow head" style={{ gridTemplateColumns: COLS }}>
              <div>コード</div>
              <div>項目名</div>
              <div>カテゴリ</div>
              <div>サブカテゴリ</div>
              <div>単位</div>
              <div>模擬結果文（既定）</div>
              <div></div>
            </div>
            {labItems.map((item) => (
              <form key={item.id} className="mrow" style={{ gridTemplateColumns: COLS }} action={updateLabItem.bind(null, item.id)}>
                <div>
                  <input name="code" defaultValue={item.code} required />
                  {isEngineLinkedLabCode(item.code) && (
                    <span className="badge blue" style={{ marginTop: 4, display: "inline-block" }}>
                      連動
                    </span>
                  )}
                </div>
                <input name="name" defaultValue={item.name} required />
                <input name="category" defaultValue={item.category} required />
                <input name="subcategory" defaultValue={item.subcategory ?? ""} />
                <input name="unit" defaultValue={item.unit ?? ""} />
                <input name="sampleResult" defaultValue={item.sampleResult ?? ""} />
                <div className="actions">
                  <button type="submit" className="btn">
                    更新
                  </button>
                  <ConfirmButton
                    formAction={deleteLabItem.bind(null, item.id)}
                    confirmText={`「${item.name}」を削除しますか？`}
                    className="btn danger"
                  >
                    削除
                  </ConfirmButton>
                </div>
              </form>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-h">新規検査項目を登録</div>
          <div className="card-b">
            <form action={createLabItem} className="form-grid">
              <div className="field">
                <label htmlFor="code">コード</label>
                <input id="code" name="code" required placeholder="例: C3002（JLAC11測定物コード等）" />
              </div>
              <div className="field">
                <label htmlFor="name">項目名</label>
                <input id="name" name="name" required placeholder="例: プロカルシトニン" />
              </div>
              <div className="field">
                <label htmlFor="category">カテゴリ</label>
                <input id="category" name="category" required placeholder="例: 検体・生理検査 / 画像検査" />
              </div>
              <div className="field">
                <label htmlFor="subcategory">サブカテゴリ（任意）</label>
                <input id="subcategory" name="subcategory" placeholder="例: 血算 / 生化学 / 単純写真 / CT" />
              </div>
              <div className="field">
                <label htmlFor="unit">単位（任意）</label>
                <input id="unit" name="unit" placeholder="例: ng/mL" />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="sampleResult">模擬結果文（既定・任意）</label>
                <input id="sampleResult" name="sampleResult" placeholder="例: 0.05 ng/mL未満（基準範囲内）" />
              </div>
              <div style={{ gridColumn: "1 / -1", textAlign: "right" }}>
                <button type="submit" className="btn primary">
                  登録
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
