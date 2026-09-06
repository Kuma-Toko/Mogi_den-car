import type { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime } from "@/lib/format";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Modal } from "@/components/Modal";
import { VITAL_FIELDS } from "@/lib/vital-fields";
import { createDrugEffectRule, deleteDrugEffectRule, updateDrugEffectRule } from "./actions";

const CATEGORY_SELECT = {
  id: true,
  majorCategory: true,
  subCategory: true,
  _count: { select: { links: true } },
} satisfies Prisma.DrugCategoryMasterSelect;

type CategoryRow = Prisma.DrugCategoryMasterGetPayload<{ select: typeof CATEGORY_SELECT }>;
type RuleRow = Awaited<ReturnType<typeof db.drugEffectRule.findMany>>[number];

function categoryLabel(c: { majorCategory: string; subCategory: string | null }): string {
  return c.subCategory ? `${c.majorCategory} / ${c.subCategory}` : c.majorCategory;
}

export default async function AdminDrugEffectsPage() {
  await requireAdmin();

  const [rules, categories] = await Promise.all([
    db.drugEffectRule.findMany({ orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }] }),
    db.drugCategoryMaster.findMany({ orderBy: [{ majorCategory: "asc" }, { subCategory: "asc" }], select: CATEGORY_SELECT }),
  ]);

  const rulesByCategory = new Map<string, RuleRow[]>();
  for (const r of rules) {
    if (!rulesByCategory.has(r.categoryId)) rulesByCategory.set(r.categoryId, []);
    rulesByCategory.get(r.categoryId)!.push(r);
  }
  // ルールが1件も無いカテゴリもテーブルの行として表示する（そのポップアップから最初のルールを追加できる）。
  const groups: { category: CategoryRow; rules: RuleRow[] }[] = categories.map((category) => ({
    category,
    rules: rulesByCategory.get(category.id) ?? [],
  }));

  return (
    <>
      <div className="topbar">
        <h1>薬剤影響ルール</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-h">概要</div>
          <div className="card-b" style={{ fontSize: 12, color: "var(--ink-soft)" }}>
            薬効カテゴリ（薬剤マスターで分類済みのもの）ごとに、検査値・バイタルへの影響を定義する。
            該当カテゴリの処方・注射オーダーが「発現まで」の時間を経過し、かつ中止されていない間、
            疾患由来の値へこの加算量を単純加算する（用量非依存の二値効果。薬剤どうしの相互作用は考慮しない）。
          </div>
        </div>

        <div className="card">
          <div className="card-h">薬効カテゴリ一覧</div>
          <div className="card-b" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>薬効カテゴリ</th>
                  <th>分類済み薬剤</th>
                  <th>ルール数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(({ category, rules: categoryRules }) => (
                  <tr className="row" key={category.id}>
                    <td>{categoryLabel(category)}</td>
                    <td>{category._count.links}件</td>
                    <td>{categoryRules.length}件</td>
                    <td>
                      <Modal trigger="編集" triggerClassName="btn ghost" title={categoryLabel(category)}>
                        {categoryRules.map((r) => (
                          <form
                            action={updateDrugEffectRule.bind(null, r.id)}
                            key={r.id}
                            className="form-grid"
                            style={{ alignItems: "end", marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid var(--line-soft)" }}
                          >
                            <div className="field">
                              <label>種別</label>
                              <select name="targetType" defaultValue={r.targetType} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)" }}>
                                <option value="lab">検査値</option>
                                <option value="vital">バイタル</option>
                              </select>
                            </div>
                            <div className="field">
                              <label>対象</label>
                              <input name="target" defaultValue={r.target} required style={{ width: 110 }} />
                            </div>
                            <div className="field">
                              <label>加算量</label>
                              <input name="shiftValue" type="number" step="any" defaultValue={r.shiftValue ?? ""} style={{ width: 90 }} />
                            </div>
                            <div className="field">
                              <label>発現まで(時間)</label>
                              <input name="onsetDelayHours" type="number" step="any" min="0" defaultValue={r.onsetDelayHours} style={{ width: 80 }} />
                            </div>
                            <div className="field">
                              <label>所見文(任意)</label>
                              <input name="effectText" defaultValue={r.effectText ?? ""} style={{ width: 160 }} />
                            </div>
                            <div className="field" style={{ flex: 1, minWidth: 140 }}>
                              <label>メモ</label>
                              <input name="note" defaultValue={r.note ?? ""} />
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button type="submit" className="btn">
                                保存
                              </button>
                              <ConfirmButton
                                formAction={deleteDrugEffectRule.bind(null, r.id)}
                                confirmText={`ルール「${r.target}」を削除しますか？`}
                                className="btn ghost"
                              >
                                削除
                              </ConfirmButton>
                            </div>
                          </form>
                        ))}

                        <form action={createDrugEffectRule} className="alias-add-form" style={{ flexWrap: "wrap" }}>
                          <input type="hidden" name="categoryId" value={category.id} />
                          <select name="targetType" defaultValue="lab" style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--line)" }}>
                            <option value="lab">検査値</option>
                            <option value="vital">バイタル</option>
                          </select>
                          <input name="target" placeholder="検査コード or バイタル項目名" required style={{ width: 150 }} />
                          <input name="shiftValue" type="number" step="any" placeholder="加算量" style={{ width: 90 }} />
                          <input name="onsetDelayHours" type="number" step="any" min="0" placeholder="発現まで(時間)" style={{ width: 110 }} />
                          <input name="note" placeholder="メモ(任意)" style={{ width: 140 }} />
                          <button type="submit" className="btn">
                            このカテゴリへ追加
                          </button>
                        </form>
                        <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 10 }}>
                          「対象」は種別が検査値なら検査項目コード(例: 3H015)、バイタルなら次のいずれかを入力する:{" "}
                          {VITAL_FIELDS.map((f) => `${f.key}(${f.label})`).join(" / ")}
                        </div>
                      </Modal>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
