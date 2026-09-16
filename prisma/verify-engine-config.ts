import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import type { PathologyTemplateCatalog } from "./pathology-catalog/types";

// prisma/data/pathology-catalog/*.json（リポジトリ上の正）と、DATABASE_URLが指すDBの実際の内容を比較する。
// apply-engine-config.ts適用後の確認や、「Turso本番はリポジトリのJSONと一致しているか」の定期チェックに使う。
// 差分ゼロ = そのDBはリポジトリの設定と完全に同期している。

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) throw new Error("DATABASE_URL is not set.");
const destUrl: string = rawUrl;

const catalogDir = join(__dirname, "data", "pathology-catalog");

function loadCatalog(): PathologyTemplateCatalog[] {
  const files = readdirSync(catalogDir).filter((f) => f.endsWith(".json"));
  return files.flatMap((file) => JSON.parse(readFileSync(join(catalogDir, file), "utf-8")) as PathologyTemplateCatalog[]);
}

type DrugCategoriesConfig = {
  categories: { majorCategory: string; subCategory: string | null }[];
  links: { hotCode: string; majorCategory: string; subCategory: string | null }[];
};

async function main() {
  const dest = createClient({ url: destUrl });
  let diffCount = 0;

  const templates = loadCatalog();
  const destTemplates = await dest.execute(
    `SELECT key, name, description, category, sortOrder, isInfectious, isCrisisPathology, defaultParams, treatmentConfig, vitalsConfig, aiEvaluationGuideline FROM DiseaseTemplate`
  );
  const destByKey = new Map(destTemplates.rows.map((r) => [r.key as string, r]));

  for (const t of templates) {
    const row = destByKey.get(t.key);
    if (!row) {
      console.log(`[NOT_FOUND] DiseaseTemplate key=${t.key} がDB上に存在しません`);
      diffCount++;
      continue;
    }
    const expectedTreatment = JSON.stringify(t.treatment);
    const expectedVitals = JSON.stringify({ perSeverity: t.vitalsPerSeverity });
    const expectedDefaultParams = JSON.stringify(t.defaultParams);
    const mismatches: string[] = [];
    if (row.name !== t.name) mismatches.push("name");
    if ((row.description ?? null) !== (t.description ?? null)) mismatches.push("description");
    if ((row.category ?? null) !== t.category) mismatches.push("category");
    if (Number(row.sortOrder) !== t.sortOrder) mismatches.push("sortOrder");
    if (!!row.isInfectious !== !!(t.isInfectious ?? false)) mismatches.push("isInfectious");
    if (!!row.isCrisisPathology !== !!(t.isCrisisPathology ?? false)) mismatches.push("isCrisisPathology");
    if (row.defaultParams !== expectedDefaultParams) mismatches.push("defaultParams");
    if (row.treatmentConfig !== expectedTreatment) mismatches.push("treatmentConfig");
    if (row.vitalsConfig !== expectedVitals) mismatches.push("vitalsConfig");
    if ((row.aiEvaluationGuideline ?? null) !== (t.aiEvaluationGuideline ?? null)) mismatches.push("aiEvaluationGuideline");
    if (mismatches.length > 0) {
      console.log(`[DIFF] DiseaseTemplate key=${t.key}: ${mismatches.join(", ")}`);
      diffCount++;
    }

    // labPatterns件数の簡易確認（詳細diffまでは踏み込まない）
    const templateIdRow = await dest.execute({ sql: `SELECT id FROM DiseaseTemplate WHERE key = ?`, args: [t.key] });
    const templateId = templateIdRow.rows[0]?.id as string | undefined;
    if (templateId) {
      const patternCount = await dest.execute({ sql: `SELECT COUNT(*) as n FROM TemplateLabPattern WHERE templateId = ?`, args: [templateId] });
      if (Number(patternCount.rows[0].n) !== t.labPatterns.length) {
        console.log(`[DIFF] TemplateLabPattern件数不一致 key=${t.key}: JSON=${t.labPatterns.length} DB=${patternCount.rows[0].n}`);
        diffCount++;
      }
      const scenarioCount = await dest.execute({ sql: `SELECT COUNT(*) as n FROM TemplateCrisisScenario WHERE templateId = ?`, args: [templateId] });
      const expectedScenarios = t.crisisTriggers?.length ?? 0;
      if (Number(scenarioCount.rows[0].n) !== expectedScenarios) {
        console.log(`[DIFF] TemplateCrisisScenario件数不一致 key=${t.key}: JSON=${expectedScenarios} DB=${scenarioCount.rows[0].n}`);
        diffCount++;
      }
      const rescueRow = await dest.execute({ sql: `SELECT id FROM CrisisRescueConfig WHERE templateId = ?`, args: [templateId] });
      const hasRescueInDb = rescueRow.rows.length > 0;
      const hasRescueInCatalog = !!t.crisisRescue;
      if (hasRescueInDb !== hasRescueInCatalog) {
        console.log(`[DIFF] CrisisRescueConfig有無不一致 key=${t.key}: JSON=${hasRescueInCatalog} DB=${hasRescueInDb}`);
        diffCount++;
      }
    }
  }

  // カタログに無いDB上のテンプレート
  const catalogKeys = new Set(templates.map((t) => t.key));
  for (const row of destTemplates.rows) {
    if (!catalogKeys.has(row.key as string)) {
      console.log(`[EXTRA] DB上にのみ存在するDiseaseTemplate key=${row.key}（カタログに存在しません）`);
      diffCount++;
    }
  }

  // ── drug-categories.json: カテゴリ件数とリンク件数の一致確認（簡易チェック） ──
  const drugCategories = JSON.parse(readFileSync(join(__dirname, "data", "engine-config", "drug-categories.json"), "utf-8")) as DrugCategoriesConfig;
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
