import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";

// prisma/data/engine-config/*.json（export-engine-config.tsがdev.dbから書き出し、リポジトリに
// コミットしたもの）を、DATABASE_URLが指すDBへ冪等に適用する。ローカル・Turso本番のどちらに対しても
// 同じスクリプトを使うことで、「ローカルにしか正しい設定が無い」状態を構造的に無くすのが狙い
// （sync-*-to-turso.ts 3本が抱えていた実際の障害の根本原因）。
// 自然キーで引き直す（cuidはDB毎に異なるため）: DiseaseTemplate.key / DrugMaster.hotCode /
// DrugCategoryMaster(majorCategory, subCategory)

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) throw new Error("DATABASE_URL is not set.");
const destUrl: string = rawUrl;

const dataDir = join(__dirname, "data", "engine-config");

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(dataDir, name), "utf-8")) as T;
}

type DiseaseTemplateConfig = {
  key: string;
  treatmentConfig: string | null;
  vitalsConfig: string | null;
  aiEvaluationGuideline: string | null;
  labPatterns: {
    labItemCode: string;
    kind: string;
    mildText: string | null;
    moderateText: string | null;
    severeText: string | null;
    sortOrder: number;
    values: { tier: string; label: string; value: number; unit: string; note: string | null; sortOrder: number }[];
  }[];
  crisisRescue: {
    postRescueSeverity: number;
    actions: { label: string; drugCategories: string; procedureKeywords: string; sortOrder: number }[];
  } | null;
};

type CrisisScenarioConfig = {
  watcherKey: string;
  targetKey: string;
  sustainMinutes: number;
  sortOrder: number;
  triggers: { type: string; code: string | null; label: string | null; field: string | null; op: string; value: number; sortOrder: number }[];
};

type DrugCategoriesConfig = {
  categories: { majorCategory: string; subCategory: string | null; sortOrder: number }[];
  links: { hotCode: string; majorCategory: string; subCategory: string | null }[];
};

async function main() {
  const dest = createClient({ url: destUrl });

  // ── disease-templates.json ──
  const templates = readJson<DiseaseTemplateConfig[]>("disease-templates.json");
  console.log(`disease-templates.json: ${templates.length}件を適用します...`);
  let templatesUpdated = 0;
  let templatesNotFound = 0;

  for (const t of templates) {
    const destTemplate = await dest.execute({ sql: `SELECT id FROM DiseaseTemplate WHERE key = ?`, args: [t.key] });
    if (destTemplate.rows.length === 0) {
      templatesNotFound++;
      console.warn(`  警告: DiseaseTemplate(key=${t.key})が見つかりません。スキップします。`);
      continue;
    }
    const templateId = destTemplate.rows[0].id as string;

    await dest.execute({
      sql: `UPDATE DiseaseTemplate SET treatmentConfig = ?, vitalsConfig = ?, aiEvaluationGuideline = ? WHERE id = ?`,
      args: [t.treatmentConfig, t.vitalsConfig, t.aiEvaluationGuideline, templateId],
    });
    templatesUpdated++;

    for (const p of t.labPatterns) {
      const existing = await dest.execute({
        sql: `SELECT id FROM TemplateLabPattern WHERE templateId = ? AND labItemCode = ?`,
        args: [templateId, p.labItemCode],
      });
      const patternId = existing.rows.length > 0 ? (existing.rows[0].id as string) : randomUUID();

      await dest.execute({
        sql: `INSERT INTO TemplateLabPattern (id, templateId, labItemCode, kind, mildText, moderateText, severeText, sortOrder)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(templateId, labItemCode) DO UPDATE SET
                kind=excluded.kind, mildText=excluded.mildText, moderateText=excluded.moderateText,
                severeText=excluded.severeText, sortOrder=excluded.sortOrder`,
        args: [patternId, templateId, p.labItemCode, p.kind, p.mildText, p.moderateText, p.severeText, p.sortOrder],
      });

      await dest.execute({ sql: `DELETE FROM TemplateLabPatternValue WHERE patternId = ?`, args: [patternId] });
      for (const v of p.values) {
        await dest.execute({
          sql: `INSERT INTO TemplateLabPatternValue (id, patternId, tier, label, value, unit, note, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [randomUUID(), patternId, v.tier, v.label, v.value, v.unit, v.note, v.sortOrder],
        });
      }
    }

    if (t.crisisRescue) {
      const existing = await dest.execute({ sql: `SELECT id FROM CrisisRescueConfig WHERE templateId = ?`, args: [templateId] });
      const rescueConfigId = existing.rows.length > 0 ? (existing.rows[0].id as string) : randomUUID();

      await dest.execute({
        sql: `INSERT INTO CrisisRescueConfig (id, templateId, postRescueSeverity)
              VALUES (?, ?, ?)
              ON CONFLICT(templateId) DO UPDATE SET postRescueSeverity=excluded.postRescueSeverity`,
        args: [rescueConfigId, templateId, t.crisisRescue.postRescueSeverity],
      });

      await dest.execute({ sql: `DELETE FROM CrisisRescueActionRow WHERE rescueConfigId = ?`, args: [rescueConfigId] });
      for (const a of t.crisisRescue.actions) {
        await dest.execute({
          sql: `INSERT INTO CrisisRescueActionRow (id, rescueConfigId, label, drugCategories, procedureKeywords, sortOrder) VALUES (?, ?, ?, ?, ?, ?)`,
          args: [randomUUID(), rescueConfigId, a.label, a.drugCategories, a.procedureKeywords, a.sortOrder],
        });
      }
    }
  }
  console.log(`DiseaseTemplate 更新: ${templatesUpdated}件 / 見つからずスキップ: ${templatesNotFound}件`);

  // ── crisis-scenarios.json ──
  const scenarios = readJson<CrisisScenarioConfig[]>("crisis-scenarios.json");
  console.log(`\ncrisis-scenarios.json: ${scenarios.length}件を適用します...`);

  for (const s of scenarios) {
    const destWatcher = await dest.execute({ sql: `SELECT id FROM DiseaseTemplate WHERE key = ?`, args: [s.watcherKey] });
    const destTarget = await dest.execute({ sql: `SELECT id FROM DiseaseTemplate WHERE key = ?`, args: [s.targetKey] });
    if (destWatcher.rows.length === 0 || destTarget.rows.length === 0) {
      console.warn(`  警告: DiseaseTemplate(${s.watcherKey} または ${s.targetKey})が見つかりません。スキップします。`);
      continue;
    }
    const watcherId = destWatcher.rows[0].id as string;
    const targetId = destTarget.rows[0].id as string;

    const existing = await dest.execute({
      sql: `SELECT id FROM TemplateCrisisScenario WHERE templateId = ? AND targetTemplateId = ? AND sortOrder = ?`,
      args: [watcherId, targetId, s.sortOrder],
    });
    const scenarioId = existing.rows.length > 0 ? (existing.rows[0].id as string) : randomUUID();

    if (existing.rows.length > 0) {
      await dest.execute({ sql: `UPDATE TemplateCrisisScenario SET sustainMinutes = ? WHERE id = ?`, args: [s.sustainMinutes, scenarioId] });
    } else {
      await dest.execute({
        sql: `INSERT INTO TemplateCrisisScenario (id, templateId, targetTemplateId, sustainMinutes, sortOrder) VALUES (?, ?, ?, ?, ?)`,
        args: [scenarioId, watcherId, targetId, s.sustainMinutes, s.sortOrder],
      });
    }

    await dest.execute({ sql: `DELETE FROM CrisisTriggerRow WHERE scenarioId = ?`, args: [scenarioId] });
    for (const t of s.triggers) {
      await dest.execute({
        sql: `INSERT INTO CrisisTriggerRow (id, scenarioId, type, code, label, field, op, value, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [randomUUID(), scenarioId, t.type, t.code, t.label, t.field, t.op, t.value, t.sortOrder],
      });
    }
    console.log(`  ${s.watcherKey} -> ${s.targetKey}: sustainMinutes=${s.sustainMinutes} トリガー${s.triggers.length}件`);
  }

  // ── drug-categories.json ──
  const drugCategories = readJson<DrugCategoriesConfig>("drug-categories.json");
  console.log(`\ndrug-categories.json: カテゴリ${drugCategories.categories.length}件、リンク${drugCategories.links.length}件を適用します...`);

  for (const c of drugCategories.categories) {
    // subCategoryがNULL可のため、ON CONFLICT(majorCategory, subCategory)はNULL同士を「等しい」と
    // みなさず発火しない。既存idを再利用してINSERTするとPRIMARY KEY違反になるため、明示的に分ける。
    const existing = await dest.execute({
      sql: `SELECT id FROM DrugCategoryMaster WHERE majorCategory = ? AND subCategory IS ?`,
      args: [c.majorCategory, c.subCategory],
    });
    if (existing.rows.length > 0) {
      await dest.execute({ sql: `UPDATE DrugCategoryMaster SET sortOrder = ? WHERE id = ?`, args: [c.sortOrder, existing.rows[0].id as string] });
    } else {
      await dest.execute({
        sql: `INSERT INTO DrugCategoryMaster (id, majorCategory, subCategory, sortOrder, createdAt) VALUES (?, ?, ?, ?, ?)`,
        args: [randomUUID(), c.majorCategory, c.subCategory, c.sortOrder, new Date().toISOString()],
      });
    }
  }

  const destCategories = await dest.execute(`SELECT id, majorCategory, subCategory FROM DrugCategoryMaster`);
  const categoryIdByKey = new Map<string, string>();
  for (const c of destCategories.rows) categoryIdByKey.set(`${c.majorCategory as string} ${(c.subCategory as string | null) ?? ""}`, c.id as string);

  const destDrugs = await dest.execute(`SELECT id, hotCode FROM DrugMaster`);
  const drugIdByHotCode = new Map<string, string>();
  for (const d of destDrugs.rows) drugIdByHotCode.set(d.hotCode as string, d.id as string);

  let linksInserted = 0;
  let missingDrug = 0;
  let missingCategory = 0;
  for (const l of drugCategories.links) {
    const drugId = drugIdByHotCode.get(l.hotCode);
    if (!drugId) {
      missingDrug++;
      continue;
    }
    const categoryId = categoryIdByKey.get(`${l.majorCategory} ${l.subCategory ?? ""}`);
    if (!categoryId) {
      missingCategory++;
      continue;
    }
    await dest.execute({
      sql: `INSERT INTO DrugCategoryLink (id, drugMasterId, categoryId, createdAt) VALUES (?, ?, ?, ?) ON CONFLICT(drugMasterId, categoryId) DO NOTHING`,
      args: [randomUUID(), drugId, categoryId, new Date().toISOString()],
    });
    linksInserted++;
  }
  console.log(`DrugCategoryLink 適用: ${linksInserted}件`);
  if (missingDrug > 0) console.log(`  警告: DrugMasterが見つからずスキップ: ${missingDrug}件（デモ薬剤hotCode等）`);
  if (missingCategory > 0) console.log(`  警告: カテゴリ引き直し失敗でスキップ: ${missingCategory}件`);

  dest.close();
  console.log("\n完了しました。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
