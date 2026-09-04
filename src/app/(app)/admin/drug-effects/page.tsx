import type { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime } from "@/lib/format";
import { ConfirmButton } from "@/components/ConfirmButton";
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

  const categoryById = new Map<string, CategoryRow>(categories.map((c) => [c.id, c]));
  const rulesByCategory = new Map<string, RuleRow[]>();
  for (const r of rules) {
    if (!rulesByCategory.has(r.categoryId)) rulesByCategory.set(r.categoryId, []);
    rulesByCategory.get(r.categoryId)!.push(r);
  }
  const groups = Array.from(rulesByCategory.entries())
    .map(([categoryId, categoryRules]) => ({ category: categoryById.get(categoryId), rules: categoryRules }))
    .filter((g): g is { category: CategoryRow; rules: RuleRow[] } => g.category !== undefined)
    .sort((a, b) => categoryLabel(a.category).localeCompare(categoryLabel(b.category), "ja"));

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

        {groups.map(({ category, rules: categoryRules }) => (
          <div className="card" style={{ marginBottom: 14 }} key={category.id}>
            <div className="card-h">
              {categoryLabel(category)}
              <span style={{ marginLeft: 8, fontSize: 11, color: "var(--ink-soft)", fontWeight: 400 }}>
                分類済み薬剤 {category._count.links}件
              </span>
            </div>
            <div className="card-b">
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
            </div>
          </div>
        ))}

        <div className="card">
          <div className="card-h">新しいカテゴリへルールを追加</div>
          <div className="card-b">
            <form action={createDrugEffectRule} className="form-grid" style={{ alignItems: "end", flexWrap: "wrap" }}>
              <div className="field" style={{ minWidth: 260 }}>
                <label>薬効カテゴリ</label>
                <select name="categoryId" required defaultValue="" style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)" }}>
                  <option value="" disabled>
                    選択してください
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {categoryLabel(c)}（分類済み{c._count.links}件）
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>種別</label>
                <select name="targetType" defaultValue="lab" style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--line)" }}>
                  <option value="lab">検査値</option>
                  <option value="vital">バイタル</option>
                </select>
              </div>
              <div className="field">
                <label>対象</label>
                <input name="target" placeholder="検査コード or バイタル項目名" required style={{ width: 160 }} />
              </div>
              <div className="field">
                <label>加算量</label>
                <input name="shiftValue" type="number" step="any" style={{ width: 90 }} />
              </div>
              <div className="field">
                <label>発現まで(時間)</label>
                <input name="onsetDelayHours" type="number" step="any" min="0" defaultValue={0} style={{ width: 100 }} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label>メモ</label>
                <input name="note" placeholder="医学的根拠など(任意)" />
              </div>
              <div>
                <button type="submit" className="btn primary">
                  追加
                </button>
              </div>
            </form>
            <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 10 }}>
              「対象」は種別が検査値なら検査項目コード(例: 3H015)、バイタルなら次のいずれかを入力する:{" "}
              {VITAL_FIELDS.map((f) => `${f.key}(${f.label})`).join(" / ")}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
