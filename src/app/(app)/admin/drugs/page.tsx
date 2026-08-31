import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime } from "@/lib/format";
import { ConfirmButton } from "@/components/ConfirmButton";
import { createDrug, deleteDrug, updateDrug } from "./actions";

const COLS = "1fr 1.4fr 0.9fr 1fr 0.7fr 0.9fr 0.9fr auto";

export default async function AdminDrugsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const { error } = await searchParams;

  const drugs = await db.drugMaster.findMany({ orderBy: { name: "asc" } });

  return (
    <>
      <div className="topbar">
        <h1>薬剤マスター</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        {error === "in_use" && (
          <div className="banner-error" style={{ marginBottom: 14 }}>
            この薬剤は既にオーダーで使用されているため削除できません。
          </div>
        )}

        <div className="card">
          <div className="card-h">登録済み薬剤（{drugs.length}件）</div>
          <div className="mrow-wrap">
            <div className="mrow head" style={{ gridTemplateColumns: COLS }}>
              <div>HOTコード</div>
              <div>薬剤名</div>
              <div>カテゴリ</div>
              <div>既定用量</div>
              <div>単位</div>
              <div>投与経路</div>
              <div>区分</div>
              <div></div>
            </div>
            {drugs.map((d) => (
              <form key={d.id} className="mrow" style={{ gridTemplateColumns: COLS }} action={updateDrug.bind(null, d.id)}>
                <input name="hotCode" defaultValue={d.hotCode} required />
                <input name="name" defaultValue={d.name} required />
                <input name="category" defaultValue={d.category ?? ""} />
                <input name="defaultDose" defaultValue={d.defaultDose ?? ""} />
                <input name="unit" defaultValue={d.unit ?? ""} />
                <input name="route" defaultValue={d.route ?? ""} />
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                  <input type="checkbox" name="isInjectable" defaultChecked={d.isInjectable} />
                  注射・点滴
                </label>
                <div className="actions">
                  <button type="submit" className="btn">
                    更新
                  </button>
                  <ConfirmButton
                    formAction={deleteDrug.bind(null, d.id)}
                    confirmText={`「${d.name}」を削除しますか？`}
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
          <div className="card-h">新規薬剤を登録</div>
          <div className="card-b">
            <form action={createDrug} className="form-grid">
              <div className="field">
                <label htmlFor="hotCode">HOTコード</label>
                <input id="hotCode" name="hotCode" required placeholder="例: HOT-100006" />
              </div>
              <div className="field">
                <label htmlFor="name">薬剤名</label>
                <input id="name" name="name" required placeholder="例: アセトアミノフェン錠 500mg" />
              </div>
              <div className="field">
                <label htmlFor="category">カテゴリ</label>
                <input id="category" name="category" placeholder="例: 抗菌薬 / 利尿薬 / 輸液" />
              </div>
              <div className="field">
                <label htmlFor="defaultDose">既定用量</label>
                <input id="defaultDose" name="defaultDose" placeholder="例: 1錠 発熱時" />
              </div>
              <div className="field">
                <label htmlFor="unit">単位</label>
                <input id="unit" name="unit" placeholder="例: 錠" />
              </div>
              <div className="field">
                <label htmlFor="route">投与経路</label>
                <input id="route" name="route" placeholder="例: 内服 / 点滴静注 / 皮下注射" />
              </div>
              <div className="field">
                <label>オーダー区分</label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, padding: "8px 0" }}>
                  <input type="checkbox" name="isInjectable" />
                  注射・点滴オーダーの対象にする（未チェックなら処方オーダーの対象）
                </label>
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
