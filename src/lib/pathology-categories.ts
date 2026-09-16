// 病態テンプレートの臓器系分類（DiseaseTemplate.category）。一覧・症例作成フォームのグループ見出しに使う。
// prisma/pathology-catalog/types.ts からも参照する（カタログ側の正本と表示順を一致させるため）。
export const CATEGORY_ORDER = [
  "循環器",
  "呼吸器",
  "消化器",
  "腎・電解質",
  "内分泌・代謝",
  "神経",
  "感染症・全身",
  "血液・腫瘍",
  "救急・中毒・環境",
  "外傷・外科",
  "産婦人科・小児",
  "急変",
] as const;

export type CatalogCategory = (typeof CATEGORY_ORDER)[number];

const CATEGORY_RANK = new Map<string, number>(CATEGORY_ORDER.map((c, i) => [c, i]));

// DiseaseTemplate.categoryはDB上ではアルファベット順にならない任意の分類名なので、CATEGORY_ORDER
// （臨床的にまとまった表示順）に沿って並べ替える。未分類(null)・CATEGORY_ORDER外の値は末尾にまとめる。
// 呼び出し側は事前に sortOrder 昇順（同カテゴリ内の順）で取得しておくこと（このソートは安定ソート前提）。
export function sortTemplatesByCategory<T extends { category: string | null; sortOrder: number }>(templates: T[]): T[] {
  return [...templates].sort((a, b) => {
    const rankA = a.category ? (CATEGORY_RANK.get(a.category) ?? CATEGORY_ORDER.length) : CATEGORY_ORDER.length + 1;
    const rankB = b.category ? (CATEGORY_RANK.get(b.category) ?? CATEGORY_ORDER.length) : CATEGORY_ORDER.length + 1;
    return rankA - rankB || a.sortOrder - b.sortOrder;
  });
}
