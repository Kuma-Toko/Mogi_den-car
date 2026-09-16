import { createClient } from "@libsql/client";
import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { CATEGORY_FILE_MAP, type CatalogCategory, type PathologyTemplateCatalog } from "./pathology-catalog/types";

// DATABASE_URL（既定はローカルdev.db）が指すDBから、病態モデル（DiseaseTemplate一式）を
// prisma/data/pathology-catalog/*.json（カテゴリ別ファイル）へ書き出す。管理画面で教員が編集した内容を
// リポジトリへ戻すための経路（以後 apply-engine-config.ts でDB復元できる）。
// 薬効カテゴリ辞書(drug-categories.json)は従来どおり別経路（このスクリプトでは扱わない）。
//
// 自然キーで書き出す（cuidはDB毎にseed/importが独自生成し引き継げないため）: DiseaseTemplate.key

const sourceUrl = process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL ?? "file:./prisma/dev.db";
const catalogDir = join(__dirname, "data", "pathology-catalog");

type Row = Record<string, unknown>;

async function main() {
  const source = createClient({ url: sourceUrl });

  const templates = await source.execute(
    `SELECT id, key, name, description, category, sortOrder, isInfectious, isCrisisPathology, defaultParams, treatmentConfig, vitalsConfig, aiEvaluationGuideline
     FROM DiseaseTemplate ORDER BY category, sortOrder, key`
  );

  const catalog: PathologyTemplateCatalog[] = [];
  const uncategorized: string[] = [];

  for (const t of templates.rows as unknown as Row[]) {
    const templateId = t.id as string;
    const category = (t.category as string | null) ?? null;
    if (!category) uncategorized.push(t.key as string);

    const patterns = await source.execute({
      sql: `SELECT id, labItemCode, kind, mildText, moderateText, severeText, sortOrder
            FROM TemplateLabPattern WHERE templateId = ? ORDER BY sortOrder`,
      args: [templateId],
    });
    const labPatterns: PathologyTemplateCatalog["labPatterns"] = [];
    for (const p of patterns.rows as unknown as Row[]) {
      if (p.kind === "text") {
        labPatterns.push({
          labItemCode: p.labItemCode as string,
          kind: "text",
          tiers: { mild: (p.mildText as string) ?? "", moderate: (p.moderateText as string) ?? "", severe: (p.severeText as string) ?? "" },
        });
        continue;
      }
      const values = await source.execute({
        sql: `SELECT tier, label, value, unit, note FROM TemplateLabPatternValue WHERE patternId = ? ORDER BY sortOrder`,
        args: [p.id as string],
      });
      type ValueTier = { label: string; value: number; unit: string; note?: string | null }[];
      const tiers: { mild: ValueTier; moderate: ValueTier; severe: ValueTier } = { mild: [], moderate: [], severe: [] };
      for (const v of values.rows as unknown as Row[]) {
        const tier = v.tier as "mild" | "moderate" | "severe";
        tiers[tier].push({ label: v.label as string, value: v.value as number, unit: v.unit as string, note: (v.note as string | null) ?? undefined });
      }
      labPatterns.push({ labItemCode: p.labItemCode as string, kind: "values", tiers });
    }

    const rescueConfig = await source.execute({ sql: `SELECT id, postRescueSeverity FROM CrisisRescueConfig WHERE templateId = ?`, args: [templateId] });
    let crisisRescue: PathologyTemplateCatalog["crisisRescue"] = null;
    if (rescueConfig.rows.length > 0) {
      const rc = rescueConfig.rows[0] as unknown as Row;
      const actions = await source.execute({
        sql: `SELECT label, drugCategories, procedureKeywords, sortOrder FROM CrisisRescueActionRow WHERE rescueConfigId = ? ORDER BY sortOrder`,
        args: [rc.id as string],
      });
      crisisRescue = {
        postRescueSeverity: rc.postRescueSeverity as number,
        actions: actions.rows.map((a) => ({
          label: a.label as string,
          drugCategories: JSON.parse((a.drugCategories as string) || "[]"),
          procedureKeywords: JSON.parse((a.procedureKeywords as string) || "[]"),
        })),
      };
    }

    const scenarios = await source.execute({
      sql: `SELECT tcs.sustainMinutes, tcs.sortOrder, tt.key as targetKey
            FROM TemplateCrisisScenario tcs JOIN DiseaseTemplate tt ON tt.id = tcs.targetTemplateId
            WHERE tcs.templateId = ? ORDER BY tcs.sortOrder`,
      args: [templateId],
    });
    const crisisTriggers: PathologyTemplateCatalog["crisisTriggers"] = [];
    for (const s of scenarios.rows as unknown as Row[]) {
      const scenarioIdRow = await source.execute({
        sql: `SELECT id FROM TemplateCrisisScenario WHERE templateId = ? AND targetTemplateId = (SELECT id FROM DiseaseTemplate WHERE key = ?)`,
        args: [templateId, s.targetKey as string],
      });
      const scenarioId = scenarioIdRow.rows[0].id as string;
      const triggers = await source.execute({
        sql: `SELECT type, code, label, field, op, value FROM CrisisTriggerRow WHERE scenarioId = ? ORDER BY sortOrder`,
        args: [scenarioId],
      });
      crisisTriggers.push({
        targetKey: s.targetKey as string,
        sustainMinutes: s.sustainMinutes as number,
        triggers: triggers.rows.map((tr) => {
          const type = tr.type as "severity" | "lab" | "vital";
          if (type === "lab") return { type, code: tr.code as string, label: (tr.label as string) ?? undefined, op: tr.op as ">=" | "<=", value: tr.value as number };
          if (type === "vital") return { type, field: tr.field as never, op: tr.op as ">=" | "<=", value: tr.value as number };
          return { type, op: tr.op as ">=" | "<=", value: tr.value as number };
        }),
      });
    }

    const treatment = JSON.parse((t.treatmentConfig as string) || "{}");
    const vitalsConfig = JSON.parse((t.vitalsConfig as string) || "{}");

    catalog.push({
      key: t.key as string,
      name: t.name as string,
      description: (t.description as string | null) ?? null,
      category: category ?? "未分類",
      sortOrder: (t.sortOrder as number) ?? 0,
      isInfectious: !!t.isInfectious,
      isCrisisPathology: !!t.isCrisisPathology,
      defaultParams: JSON.parse(t.defaultParams as string),
      treatment: { drugCategories: treatment.drugCategories ?? undefined, procedureKeywords: treatment.procedureKeywords ?? undefined },
      vitalsPerSeverity: vitalsConfig.perSeverity ?? { temperature: 0, systolicBp: 0, diastolicBp: 0, pulse: 0, spo2: 0, respRate: 0 },
      aiEvaluationGuideline: (t.aiEvaluationGuideline as string | null) ?? null,
      labPatterns,
      crisisTriggers: crisisTriggers.length > 0 ? crisisTriggers : undefined,
      crisisRescue,
    });
  }

  if (uncategorized.length > 0) {
    console.warn(`警告: category未設定のテンプレートが${uncategorized.length}件あります（"未分類"として書き出します）: ${uncategorized.join(", ")}`);
  }

  mkdirSync(catalogDir, { recursive: true });
  // 既存のカタログファイルを一旦すべて削除してから書き出す（DBで削除されたテンプレートがファイルに
  // 残り続けることを防ぐ）。
  for (const f of readdirSync(catalogDir)) {
    if (f.endsWith(".json")) unlinkSync(join(catalogDir, f));
  }

  const byFile = new Map<string, PathologyTemplateCatalog[]>();
  for (const t of catalog) {
    const file = CATEGORY_FILE_MAP[t.category as CatalogCategory] ?? "uncategorized.json";
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push(t);
  }

  for (const [file, items] of byFile) {
    items.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
    writeFileSync(join(catalogDir, file), JSON.stringify(items, null, 2) + "\n");
    console.log(`${file}: ${items.length}件のテンプレートを書き出しました。`);
  }

  source.close();
  console.log(`\n合計 ${catalog.length}件を prisma/data/pathology-catalog/ へ書き出しました。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
