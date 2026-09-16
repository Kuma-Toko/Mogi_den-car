import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import type { PathologyTemplateCatalog } from "./pathology-catalog/types";

// prisma/data/pathology-catalog/*.json（病態モデルの正本）と prisma/data/engine-config/drug-categories.json
// （薬効カテゴリ辞書）を、DATABASE_URLが指すDBへ冪等に適用する。ローカル・Turso本番のどちらに対しても
// 同じスクリプトを使うことで、「ローカルにしか正しい設定が無い」状態を構造的に無くすのが狙い。
// 自然キーで引き直す（cuidはDB毎に異なるため）: DiseaseTemplate.key / DrugMaster.hotCode /
// DrugCategoryMaster(majorCategory, subCategory)
//
// pathology-catalogは disease-templates.json/crisis-scenarios.json(旧)と異なり、DiseaseTemplate自体を
// 新規作成できる（旧スクリプトは既存レコードのUPDATEのみで、テンプレートの追加はseed.ts/管理画面が担っていた）。
// 実行順序: 1) 全テンプレートをupsert（name/description/category/engine設定/labPatterns/crisisRescue）
//           2) 全テンプレートが揃ってから crisisTriggers を解決（targetKeyが他ファイルのテンプレートを
//              指してもよいように、必ずパス1の後で行う）
//           3) drug-categories.json（従来どおり）
//
// カタログに存在しないkeyのDiseaseTemplateは、既定では警告のみ（削除しない）。--prune指定時のみ、
// 使用中でなければ削除する（admin/templates/actions.tsのdeleteTemplateと同じ安全確認）。

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) throw new Error("DATABASE_URL is not set.");
const destUrl: string = rawUrl;
const shouldPrune = process.argv.includes("--prune");

const engineConfigDir = join(__dirname, "data", "engine-config");
const catalogDir = join(__dirname, "data", "pathology-catalog");

function readJson<T>(dir: string, name: string): T {
  return JSON.parse(readFileSync(join(dir, name), "utf-8")) as T;
}

function loadCatalog(): PathologyTemplateCatalog[] {
  const files = readdirSync(catalogDir).filter((f) => f.endsWith(".json"));
  return files.flatMap((file) => readJson<PathologyTemplateCatalog[]>(catalogDir, file));
}

type DrugCategoriesConfig = {
  categories: { majorCategory: string; subCategory: string | null; sortOrder: number }[];
  links: { hotCode: string; majorCategory: string; subCategory: string | null }[];
};

async function main() {
  const dest = createClient({ url: destUrl });
  const templates = loadCatalog();
  console.log(`pathology-catalog: ${templates.length}件のテンプレートを適用します...`);

  // ── パス1: テンプレート本体・labPatterns・crisisRescue ──
  const templateIdByKey = new Map<string, string>();
  let created = 0;
  let updated = 0;

  for (const t of templates) {
    const existing = await dest.execute({ sql: `SELECT id FROM DiseaseTemplate WHERE key = ?`, args: [t.key] });
    const treatmentConfig = JSON.stringify(t.treatment);
    const vitalsConfig = JSON.stringify({ perSeverity: t.vitalsPerSeverity });
    const defaultParams = JSON.stringify(t.defaultParams);
    const isInfectious = t.isInfectious ?? false;
    const isCrisisPathology = t.isCrisisPathology ?? false;

    let templateId: string;
    if (existing.rows.length > 0) {
      templateId = existing.rows[0].id as string;
      await dest.execute({
        sql: `UPDATE DiseaseTemplate SET name=?, description=?, category=?, sortOrder=?, isCommon=1,
                isInfectious=?, isCrisisPathology=?, defaultParams=?, treatmentConfig=?, vitalsConfig=?, aiEvaluationGuideline=?
              WHERE id=?`,
        args: [t.name, t.description, t.category, t.sortOrder, isInfectious ? 1 : 0, isCrisisPathology ? 1 : 0, defaultParams, treatmentConfig, vitalsConfig, t.aiEvaluationGuideline, templateId],
      });
      updated++;
    } else {
      templateId = randomUUID();
      await dest.execute({
        sql: `INSERT INTO DiseaseTemplate (id, key, name, description, category, sortOrder, isCommon, isInfectious, isCrisisPathology, defaultParams, treatmentConfig, vitalsConfig, aiEvaluationGuideline, createdAt)
              VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          templateId, t.key, t.name, t.description, t.category, t.sortOrder,
          isInfectious ? 1 : 0, isCrisisPathology ? 1 : 0, defaultParams, treatmentConfig, vitalsConfig, t.aiEvaluationGuideline,
          new Date().toISOString(),
        ],
      });
      created++;
    }
    templateIdByKey.set(t.key, templateId);

    // labPatterns: カタログに無いlabItemCodeは削除する（このテンプレートの全パターンをカタログで置き換える）
    const existingPatterns = await dest.execute({ sql: `SELECT id, labItemCode FROM TemplateLabPattern WHERE templateId = ?`, args: [templateId] });
    const catalogCodes = new Set(t.labPatterns.map((p) => p.labItemCode));
    for (const row of existingPatterns.rows) {
      if (!catalogCodes.has(row.labItemCode as string)) {
        await dest.execute({ sql: `DELETE FROM TemplateLabPattern WHERE id = ?`, args: [row.id as string] });
      }
    }

    for (let i = 0; i < t.labPatterns.length; i++) {
      const p = t.labPatterns[i];
      const existingPattern = await dest.execute({
        sql: `SELECT id FROM TemplateLabPattern WHERE templateId = ? AND labItemCode = ?`,
        args: [templateId, p.labItemCode],
      });
      const patternId = existingPattern.rows.length > 0 ? (existingPattern.rows[0].id as string) : randomUUID();
      const mildText = p.kind === "text" ? p.tiers.mild : null;
      const moderateText = p.kind === "text" ? p.tiers.moderate : null;
      const severeText = p.kind === "text" ? p.tiers.severe : null;

      await dest.execute({
        sql: `INSERT INTO TemplateLabPattern (id, templateId, labItemCode, kind, mildText, moderateText, severeText, sortOrder)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(templateId, labItemCode) DO UPDATE SET
                kind=excluded.kind, mildText=excluded.mildText, moderateText=excluded.moderateText,
                severeText=excluded.severeText, sortOrder=excluded.sortOrder`,
        args: [patternId, templateId, p.labItemCode, p.kind, mildText, moderateText, severeText, i],
      });

      await dest.execute({ sql: `DELETE FROM TemplateLabPatternValue WHERE patternId = ?`, args: [patternId] });
      if (p.kind === "values") {
        let sortOrder = 0;
        for (const tier of ["mild", "moderate", "severe"] as const) {
          for (const v of p.tiers[tier]) {
            await dest.execute({
              sql: `INSERT INTO TemplateLabPatternValue (id, patternId, tier, label, value, unit, note, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [randomUUID(), patternId, tier, v.label, v.value, v.unit, v.note ?? null, sortOrder++],
            });
          }
        }
      }
    }

    // crisisRescue（危機病態自身の救命設定。isCrisisPathology=trueのテンプレートのみ持つ）
    if (t.crisisRescue) {
      const existingRescue = await dest.execute({ sql: `SELECT id FROM CrisisRescueConfig WHERE templateId = ?`, args: [templateId] });
      const rescueConfigId = existingRescue.rows.length > 0 ? (existingRescue.rows[0].id as string) : randomUUID();
      await dest.execute({
        sql: `INSERT INTO CrisisRescueConfig (id, templateId, postRescueSeverity)
              VALUES (?, ?, ?)
              ON CONFLICT(templateId) DO UPDATE SET postRescueSeverity=excluded.postRescueSeverity`,
        args: [rescueConfigId, templateId, t.crisisRescue.postRescueSeverity],
      });
      await dest.execute({ sql: `DELETE FROM CrisisRescueActionRow WHERE rescueConfigId = ?`, args: [rescueConfigId] });
      for (let i = 0; i < t.crisisRescue.actions.length; i++) {
        const a = t.crisisRescue.actions[i];
        await dest.execute({
          sql: `INSERT INTO CrisisRescueActionRow (id, rescueConfigId, label, drugCategories, procedureKeywords, sortOrder) VALUES (?, ?, ?, ?, ?, ?)`,
          args: [randomUUID(), rescueConfigId, a.label, JSON.stringify(a.drugCategories ?? []), JSON.stringify(a.procedureKeywords ?? []), i],
        });
      }
    } else {
      // カタログ側で救命設定が無くなった場合はDBからも削除する（CrisisRescueActionRowはonDelete: Cascade）
      await dest.execute({ sql: `DELETE FROM CrisisRescueConfig WHERE templateId = ?`, args: [templateId] });
    }
  }
  console.log(`DiseaseTemplate: 新規作成 ${created}件 / 更新 ${updated}件`);

  // ── パス2: crisisTriggers（全テンプレートのIDが出揃った後でtargetKeyを解決する） ──
  let scenariosApplied = 0;
  for (const t of templates) {
    const watcherId = templateIdByKey.get(t.key)!;
    const catalogScenarios = t.crisisTriggers ?? [];

    // 既存のTemplateCrisisScenarioのうち、カタログに存在しない分岐(targetKey)は削除する
    const existingScenarios = await dest.execute({
      sql: `SELECT tcs.id, dt.key as targetKey FROM TemplateCrisisScenario tcs JOIN DiseaseTemplate dt ON dt.id = tcs.targetTemplateId WHERE tcs.templateId = ?`,
      args: [watcherId],
    });
    const catalogTargetKeys = new Set(catalogScenarios.map((s) => s.targetKey));
    for (const row of existingScenarios.rows) {
      if (!catalogTargetKeys.has(row.targetKey as string)) {
        await dest.execute({ sql: `DELETE FROM TemplateCrisisScenario WHERE id = ?`, args: [row.id as string] });
      }
    }

    for (let i = 0; i < catalogScenarios.length; i++) {
      const s = catalogScenarios[i];
      const targetId = templateIdByKey.get(s.targetKey);
      if (!targetId) {
        console.warn(`  警告: ${t.key} のcrisisTriggers.targetKey="${s.targetKey}" が見つかりません。スキップします。`);
        continue;
      }
      const existing = await dest.execute({
        sql: `SELECT id FROM TemplateCrisisScenario WHERE templateId = ? AND targetTemplateId = ?`,
        args: [watcherId, targetId],
      });
      const scenarioId = existing.rows.length > 0 ? (existing.rows[0].id as string) : randomUUID();
      if (existing.rows.length > 0) {
        await dest.execute({ sql: `UPDATE TemplateCrisisScenario SET sustainMinutes = ?, sortOrder = ? WHERE id = ?`, args: [s.sustainMinutes, i, scenarioId] });
      } else {
        await dest.execute({
          sql: `INSERT INTO TemplateCrisisScenario (id, templateId, targetTemplateId, sustainMinutes, sortOrder) VALUES (?, ?, ?, ?, ?)`,
          args: [scenarioId, watcherId, targetId, s.sustainMinutes, i],
        });
      }
      await dest.execute({ sql: `DELETE FROM CrisisTriggerRow WHERE scenarioId = ?`, args: [scenarioId] });
      for (let j = 0; j < s.triggers.length; j++) {
        const trig = s.triggers[j];
        await dest.execute({
          sql: `INSERT INTO CrisisTriggerRow (id, scenarioId, type, code, label, field, op, value, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            randomUUID(), scenarioId, trig.type,
            trig.type === "lab" ? trig.code : null,
            trig.type === "lab" ? (trig.label ?? null) : null,
            trig.type === "vital" ? trig.field : null,
            trig.op, trig.value, j,
          ],
        });
      }
      scenariosApplied++;
    }
  }
  console.log(`TemplateCrisisScenario: ${scenariosApplied}件を適用しました。`);

  // ── カタログに存在しないDiseaseTemplateの扱い ──
  const catalogKeys = new Set(templates.map((t) => t.key));
  const destTemplates = await dest.execute(`SELECT id, key FROM DiseaseTemplate`);
  const orphanKeys = destTemplates.rows.filter((r) => !catalogKeys.has(r.key as string));
  if (orphanKeys.length > 0) {
    if (shouldPrune) {
      let pruned = 0;
      let skipped = 0;
      for (const row of orphanKeys) {
        const id = row.id as string;
        const [usageCount, crisisTargetUsage] = await Promise.all([
          dest.execute({ sql: `SELECT COUNT(*) as n FROM CaseDiseaseLink WHERE templateId = ?`, args: [id] }),
          dest.execute({ sql: `SELECT COUNT(*) as n FROM TemplateCrisisScenario WHERE targetTemplateId = ?`, args: [id] }),
        ]);
        if (Number(usageCount.rows[0].n) > 0 || Number(crisisTargetUsage.rows[0].n) > 0) {
          console.warn(`  警告: DiseaseTemplate(key=${row.key})はカタログに存在しませんが使用中のため削除しません。`);
          skipped++;
          continue;
        }
        await dest.execute({ sql: `DELETE FROM DiseaseTemplate WHERE id = ?`, args: [id] });
        pruned++;
      }
      console.log(`--pruneによりDiseaseTemplateを削除: ${pruned}件 / 使用中でスキップ: ${skipped}件`);
    } else {
      console.warn(`\n警告: カタログに存在しないDiseaseTemplateが${orphanKeys.length}件あります（--pruneで削除可）:`);
      for (const row of orphanKeys) console.warn(`  - ${row.key}`);
    }
  }

  // ── drug-categories.json（従来どおり） ──
  const drugCategories = readJson<DrugCategoriesConfig>(engineConfigDir, "drug-categories.json");
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
  for (const c of destCategories.rows) categoryIdByKey.set(`${c.majorCategory as string} ${(c.subCategory as string | null) ?? ""}`, c.id as string);

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
    const categoryId = categoryIdByKey.get(`${l.majorCategory} ${l.subCategory ?? ""}`);
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
