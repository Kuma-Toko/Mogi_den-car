import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime } from "@/lib/format";
import { ConfirmButton } from "@/components/ConfirmButton";
import { createPathogen, updatePathogen, deletePathogen, addSusceptibility, updateSusceptibility, deleteSusceptibility } from "./actions";

const SUSCEPTIBILITY_LABEL: Record<string, string> = { S: "S（感受性あり）", I: "I（中間）", R: "R（耐性）" };
const SUSCEPTIBILITY_BADGE_CLASS: Record<string, string> = { S: "badge teal", I: "badge", R: "badge red" };

export default async function AdminPathogensPage() {
  await requireAdmin();

  const [pathogens, antibioticCategories] = await Promise.all([
    db.pathogenMaster.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        susceptibilities: { include: { category: true }, orderBy: { category: { sortOrder: "asc" } } },
      },
    }),
    db.drugCategoryMaster.findMany({ where: { majorCategory: "抗菌薬" }, orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <>
      <div className="topbar">
        <h1>原因菌マスター</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <div style={{ marginBottom: 14, fontSize: 11.5, color: "var(--ink-soft)" }}>
          感染症エンジンが症例の「真の原因菌」として扱う候補と、抗菌薬の系統ごとの感受性データです。感受性データが無い(菌,系統)の組は「カバーしない」として扱われます。ここに登録した感受性は標準的な教科書的知識をもとにした参考値であり、医学監修は受けていません。
        </div>

        {pathogens.map((pathogen) => {
          const usedCategoryIds = new Set(pathogen.susceptibilities.map((s) => s.categoryId));
          const remainingCategories = antibioticCategories.filter((c) => !usedCategoryIds.has(c.id));

          return (
            <div className="card" key={pathogen.id} style={{ marginBottom: 14 }}>
              <div className="card-b">
                <form action={updatePathogen.bind(null, pathogen.id)} className="form-grid" style={{ alignItems: "end" }}>
                  <div className="field">
                    <label>菌名</label>
                    <input name="name" defaultValue={pathogen.name} required />
                  </div>
                  <div className="field">
                    <label>グラム染色区分（任意）</label>
                    <input name="gramStain" defaultValue={pathogen.gramStain ?? ""} placeholder="例: グラム陽性球菌" />
                  </div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label>補足（任意）</label>
                    <input name="note" defaultValue={pathogen.note ?? ""} placeholder="臨床像・好発部位など" />
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <button type="submit" className="btn">
                      保存
                    </button>{" "}
                    <ConfirmButton
                      formAction={deletePathogen.bind(null, pathogen.id)}
                      confirmText={`「${pathogen.name}」を削除しますか？`}
                      className="btn danger"
                    >
                      削除
                    </ConfirmButton>
                  </div>
                </form>

                <div className="alias-row" style={{ minWidth: 0, padding: "10px 0 0" }}>
                  <span className="alias-row-label">感受性:</span>
                  {pathogen.susceptibilities.map((s) => (
                    <form key={s.id} action={updateSusceptibility.bind(null, s.id)} className="alias-chip" style={{ borderRadius: 6, gap: 6 }}>
                      <span
                        className={SUSCEPTIBILITY_BADGE_CLASS[s.susceptibility] ?? "badge"}
                        style={{ marginRight: 2 }}
                      >
                        {s.category.subCategory ?? s.category.majorCategory}
                      </span>
                      <select name="susceptibility" defaultValue={s.susceptibility} style={{ padding: "3px 4px", borderRadius: 6, border: "1px solid var(--line)" }}>
                        {(["S", "I", "R"] as const).map((lv) => (
                          <option key={lv} value={lv}>
                            {SUSCEPTIBILITY_LABEL[lv]}
                          </option>
                        ))}
                      </select>
                      <input name="note" defaultValue={s.note ?? ""} placeholder="補足" style={{ width: 90 }} />
                      <button type="submit" className="btn" style={{ padding: "3px 8px", fontSize: 11 }}>
                        保存
                      </button>
                      <button
                        type="submit"
                        formAction={deleteSusceptibility.bind(null, s.id)}
                        className="alias-chip-remove"
                        aria-label="削除"
                      >
                        ×
                      </button>
                    </form>
                  ))}
                  {remainingCategories.length > 0 && (
                    <form action={addSusceptibility.bind(null, pathogen.id)} className="alias-add-form">
                      <select name="categoryId" style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--line)" }} required>
                        {remainingCategories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.subCategory ?? c.majorCategory}
                          </option>
                        ))}
                      </select>
                      <select name="susceptibility" defaultValue="S" style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--line)" }}>
                        {(["S", "I", "R"] as const).map((lv) => (
                          <option key={lv} value={lv}>
                            {SUSCEPTIBILITY_LABEL[lv]}
                          </option>
                        ))}
                      </select>
                      <input name="note" placeholder="補足(任意)" style={{ width: 90 }} />
                      <button type="submit" className="btn">
                        追加
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div className="card">
          <div className="card-h">新規原因菌を登録</div>
          <div className="card-b">
            <form action={createPathogen} className="form-grid">
              <div className="field">
                <label htmlFor="name">菌名</label>
                <input id="name" name="name" required placeholder="例: 肺炎球菌 (Streptococcus pneumoniae)" />
              </div>
              <div className="field">
                <label htmlFor="gramStain">グラム染色区分（任意）</label>
                <input id="gramStain" name="gramStain" placeholder="例: グラム陽性球菌" />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="note">補足（任意）</label>
                <input id="note" name="note" placeholder="臨床像・好発部位など" />
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
