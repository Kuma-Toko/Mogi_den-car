import { createClient } from "@libsql/client";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// エンジン設定（病態テンプレートの治療開始条件・バイタル係数・所見パターン、急変シナリオ、
// 薬効カテゴリ辞書）を、DATABASE_URLが指すDB（既定はローカルdev.db）から prisma/data/engine-config/
// 配下のJSONへ書き出す。この3種は従来ローカルdev.dbにしか存在せず、sync-*-to-turso.tsという
// 一方向スクリプト群でTursoへ手押ししていたため、「ローカルが正で、リポジトリには何も残らない」
// 状態になっていた（この構造自体が、本番でfindTreatmentStartAt()が常にfalseを返す・
// テンプレートが軒並み「エンジン未対応」になる、という実際の障害の原因）。
// このスクリプトで書き出したJSONをコミットすれば、以後は「リポジトリのJSONが正、DBはそこから
// apply-engine-config.tsで復元する」という構造に切り替えられる（ローカル・Turso問わず同じ適用経路）。
//
// 自然キーで書き出す（cuidはDB毎にseed/importが独自生成し引き継げないため）:
//   DiseaseTemplate: key / DrugCategoryMaster: (majorCategory, subCategory) / DrugMaster: hotCode

const sourceUrl = process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL ?? "file:./prisma/dev.db";
const outDir = join(__dirname, "data", "engine-config");

type Row = Record<string, unknown>;

async function main() {
  const source = createClient({ url: sourceUrl });
  mkdirSync(outDir, { recursive: true });

  // ── disease-templates.json: テンプレートのエンジン設定＋所見パターン＋救命設定 ──
  const templates = await source.execute(
    `SELECT id, key, treatmentConfig, vitalsConfig, aiEvaluationGuideline FROM DiseaseTemplate ORDER BY key`
  );
  const diseaseTemplates = [];
  for (const t of templates.rows as unknown as Row[]) {
    const templateId = t.id as string;

    const patterns = await source.execute({
      sql: `SELECT id, labItemCode, kind, mildText, moderateText, severeText, sortOrder
            FROM TemplateLabPattern WHERE templateId = ? ORDER BY sortOrder`,
      args: [templateId],
    });
    const labPatterns = [];
    for (const p of patterns.rows as unknown as Row[]) {
      const values = await source.execute({
        sql: `SELECT tier, label, value, unit, note, sortOrder FROM TemplateLabPatternValue WHERE patternId = ? ORDER BY sortOrder`,
        args: [p.id as string],
      });
      labPatterns.push({
        labItemCode: p.labItemCode,
        kind: p.kind,
        mildText: p.mildText,
        moderateText: p.moderateText,
        severeText: p.severeText,
        sortOrder: p.sortOrder,
        values: values.rows.map((v) => ({
          tier: v.tier,
          label: v.label,
          value: v.value,
          unit: v.unit,
          note: v.note,
          sortOrder: v.sortOrder,
        })),
      });
    }

    const rescueConfig = await source.execute({
      sql: `SELECT id, postRescueSeverity FROM CrisisRescueConfig WHERE templateId = ?`,
      args: [templateId],
    });
    let crisisRescue = null;
    if (rescueConfig.rows.length > 0) {
      const rc = rescueConfig.rows[0] as unknown as Row;
      const actions = await source.execute({
        sql: `SELECT label, drugCategories, procedureKeywords, sortOrder FROM CrisisRescueActionRow WHERE rescueConfigId = ? ORDER BY sortOrder`,
        args: [rc.id as string],
      });
      crisisRescue = {
        postRescueSeverity: rc.postRescueSeverity,
        actions: actions.rows.map((a) => ({
          label: a.label,
          drugCategories: a.drugCategories,
          procedureKeywords: a.procedureKeywords,
          sortOrder: a.sortOrder,
        })),
      };
    }

    diseaseTemplates.push({
      key: t.key,
      treatmentConfig: t.treatmentConfig,
      vitalsConfig: t.vitalsConfig,
      aiEvaluationGuideline: t.aiEvaluationGuideline,
      labPatterns,
      crisisRescue,
    });
  }
  writeFileSync(join(outDir, "disease-templates.json"), JSON.stringify(diseaseTemplates, null, 2) + "\n");
  console.log(`disease-templates.json: ${diseaseTemplates.length}件のテンプレートを書き出しました。`);

  // ── crisis-scenarios.json: 急変発火条件（watcherテンプレート -> targetテンプレート） ──
  const scenarios = await source.execute(
    `SELECT s.id, s.sustainMinutes, s.sortOrder, t.key as watcherKey, tt.key as targetKey
     FROM TemplateCrisisScenario s
     JOIN DiseaseTemplate t ON s.templateId = t.id
     JOIN DiseaseTemplate tt ON s.targetTemplateId = tt.id
     ORDER BY t.key, s.sortOrder`
  );
  const crisisScenarios = [];
  for (const s of scenarios.rows as unknown as Row[]) {
    const triggers = await source.execute({
      sql: `SELECT type, code, label, field, op, value, sortOrder FROM CrisisTriggerRow WHERE scenarioId = ? ORDER BY sortOrder`,
      args: [s.id as string],
    });
    crisisScenarios.push({
      watcherKey: s.watcherKey,
      targetKey: s.targetKey,
      sustainMinutes: s.sustainMinutes,
      sortOrder: s.sortOrder,
      triggers: triggers.rows.map((t) => ({
        type: t.type,
        code: t.code,
        label: t.label,
        field: t.field,
        op: t.op,
        value: t.value,
        sortOrder: t.sortOrder,
      })),
    });
  }
  writeFileSync(join(outDir, "crisis-scenarios.json"), JSON.stringify(crisisScenarios, null, 2) + "\n");
  console.log(`crisis-scenarios.json: ${crisisScenarios.length}件の急変シナリオを書き出しました。`);

  // ── drug-categories.json: 薬効カテゴリ辞書＋薬剤とのリンク（hotCode参照） ──
  const categories = await source.execute(`SELECT majorCategory, subCategory, sortOrder FROM DrugCategoryMaster ORDER BY sortOrder`);
  const links = await source.execute(`
    SELECT d.hotCode, c.majorCategory, c.subCategory
    FROM DrugCategoryLink l
    JOIN DrugMaster d ON l.drugMasterId = d.id
    JOIN DrugCategoryMaster c ON l.categoryId = c.id
    ORDER BY d.hotCode
  `);
  const drugCategories = {
    categories: categories.rows.map((c) => ({ majorCategory: c.majorCategory, subCategory: c.subCategory, sortOrder: c.sortOrder })),
    links: links.rows.map((l) => ({ hotCode: l.hotCode, majorCategory: l.majorCategory, subCategory: l.subCategory })),
  };
  writeFileSync(join(outDir, "drug-categories.json"), JSON.stringify(drugCategories, null, 2) + "\n");
  console.log(
    `drug-categories.json: カテゴリ${drugCategories.categories.length}件、薬剤リンク${drugCategories.links.length}件を書き出しました。`
  );

  source.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
