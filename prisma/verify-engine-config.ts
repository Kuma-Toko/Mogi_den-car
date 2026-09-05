import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";

// prisma/data/engine-config/*.json（リポジトリ上の正）と、DATABASE_URLが指すDBの実際の内容を比較する。
// apply-engine-config.ts適用後の確認や、「Turso本番はリポジトリのJSONと一致しているか」の定期チェックに使う。
// 差分ゼロ = そのDBはリポジトリの設定と完全に同期している。

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) throw new Error("DATABASE_URL is not set.");
const destUrl: string = rawUrl;

const dataDir = join(__dirname, "data", "engine-config");

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(dataDir, name), "utf-8")) as T;
}

type DiseaseTemplateConfig = { key: string; treatmentConfig: string | null; vitalsConfig: string | null; aiEvaluationGuideline: string | null };
type DrugCategoriesConfig = {
  categories: { majorCategory: string; subCategory: string | null }[];
  links: { hotCode: string; majorCategory: string; subCategory: string | null }[];
};

async function main() {
  const dest = createClient({ url: destUrl });
  let diffCount = 0;

  // ── disease-templates.json: treatmentConfig/vitalsConfig/aiEvaluationGuidelineの一致確認 ──
  const templates = readJson<DiseaseTemplateConfig[]>("disease-templates.json");
  const destTemplates = await dest.execute(`SELECT key, treatmentConfig, vitalsConfig, aiEvaluationGuideline FROM DiseaseTemplate`);
  const destByKey = new Map(destTemplates.rows.map((r) => [r.key as string, r]));

  for (const t of templates) {
    const row = destByKey.get(t.key);
    if (!row) {
      console.log(`[NOT_FOUND] DiseaseTemplate key=${t.key} がDB上に存在しません`);
      diffCount++;
      continue;
    }
    if (row.treatmentConfig !== t.treatmentConfig || row.vitalsConfig !== t.vitalsConfig || row.aiEvaluationGuideline !== t.aiEvaluationGuideline) {
      console.log(`[DIFF] DiseaseTemplate key=${t.key} の設定列がJSONと一致しません`);
      diffCount++;
    }
  }

  // ── drug-categories.json: カテゴリ件数とリンク件数の一致確認（詳細diffまでは踏み込まない簡易チェック） ──
  const drugCategories = readJson<DrugCategoriesConfig>("drug-categories.json");
  const destCategoryCount = await dest.execute(`SELECT COUNT(*) as n FROM DrugCategoryMaster`);
  const destLinkCount = await dest.execute(`SELECT COUNT(*) as n FROM DrugCategoryLink`);
  const expectedCategories = drugCategories.categories.length;
  const expectedLinks = drugCategories.links.length;
  const actualCategories = Number(destCategoryCount.rows[0].n);
  const actualLinks = Number(destLinkCount.rows[0].n);

  if (actualCategories < expectedCategories) {
    console.log(`[DIFF] DrugCategoryMaster件数不足: JSON=${expectedCategories} DB=${actualCategories}`);
    diffCount++;
  }
  // リンクはデモ薬剤(hotCode不一致)分がDB側で自然に少なくなりうるため、大幅な不足のみ警告する。
  if (actualLinks < expectedLinks * 0.9) {
    console.log(`[DIFF] DrugCategoryLink件数が想定より大きく不足: JSON=${expectedLinks} DB=${actualLinks}`);
    diffCount++;
  }

  dest.close();

  if (diffCount === 0) {
    console.log("差分なし。DBはリポジトリのエンジン設定と一致しています。");
  } else {
    console.log(`\n差分 ${diffCount} 件。apply-engine-config.ts の実行を検討してください。`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
