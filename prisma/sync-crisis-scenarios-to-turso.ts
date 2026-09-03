import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";

// TemplateCrisisScenario(+CrisisTriggerRow/CrisisRescueActionRow)は、seed.tsにもマイグレーションにも
// 取り込まれておらず、ローカルdev.dbにのみ存在する(手動投入されたデータ)。Turso本番にはまだ1件も
// 無いため、ローカルを正としてTursoへ反映する。テンプレートの対応はkeyで引き直す
// (DiseaseTemplate.idはDB毎にseed.tsが独自生成するため、ローカルのidをそのまま使えない)。
// 何度実行しても安全(scenarioはtemplateIdでUPSERT、trigger/rescueActionは対象scenarioId分を
// 洗い替え)。

const sourceUrl = "file:./prisma/dev.db";
const rawDestUrl = process.env.DATABASE_URL;
if (!rawDestUrl || rawDestUrl.startsWith("file:")) {
  throw new Error("DATABASE_URL must point at the remote Turso database (libsql://...?authToken=...), not a local file.");
}
const destUrl: string = rawDestUrl;

async function main() {
  const source = createClient({ url: sourceUrl });
  const dest = createClient({ url: destUrl });

  const scenarios = await source.execute(
    `SELECT s.id, s.templateId, s.name, s.sustainMinutes, s.windowMinutes, s.postRescueSeverity, s.crisisVitals, t.key as templateKey
     FROM TemplateCrisisScenario s JOIN DiseaseTemplate t ON s.templateId = t.id`
  );
  console.log(`TemplateCrisisScenarioを${scenarios.rows.length}件反映します...`);

  for (const s of scenarios.rows) {
    const templateKey = s.templateKey as string;
    const destTemplate = await dest.execute({ sql: `SELECT id FROM DiseaseTemplate WHERE key = ?`, args: [templateKey] });
    if (destTemplate.rows.length === 0) {
      console.warn(`  警告: DiseaseTemplate(key=${templateKey})がTurso上に見つかりません。スキップします。`);
      continue;
    }
    const destTemplateId = destTemplate.rows[0].id as string;

    const existing = await dest.execute({ sql: `SELECT id FROM TemplateCrisisScenario WHERE templateId = ?`, args: [destTemplateId] });
    const scenarioId = existing.rows.length > 0 ? (existing.rows[0].id as string) : randomUUID();

    await dest.execute({
      sql: `INSERT INTO TemplateCrisisScenario (id, templateId, name, sustainMinutes, windowMinutes, postRescueSeverity, crisisVitals)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(templateId) DO UPDATE SET
              name=excluded.name, sustainMinutes=excluded.sustainMinutes, windowMinutes=excluded.windowMinutes,
              postRescueSeverity=excluded.postRescueSeverity, crisisVitals=excluded.crisisVitals`,
      args: [scenarioId, destTemplateId, s.name, s.sustainMinutes, s.windowMinutes, s.postRescueSeverity, s.crisisVitals],
    });

    const triggers = await source.execute({
      sql: `SELECT type, code, label, field, op, value, sortOrder FROM CrisisTriggerRow WHERE scenarioId = ? ORDER BY sortOrder`,
      args: [s.id as string],
    });
    await dest.execute({ sql: `DELETE FROM CrisisTriggerRow WHERE scenarioId = ?`, args: [scenarioId] });
    for (const t of triggers.rows) {
      await dest.execute({
        sql: `INSERT INTO CrisisTriggerRow (id, scenarioId, type, code, label, field, op, value, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [randomUUID(), scenarioId, t.type, t.code, t.label, t.field, t.op, t.value, t.sortOrder],
      });
    }

    const rescueActions = await source.execute({
      sql: `SELECT label, drugCategories, procedureKeywords, sortOrder FROM CrisisRescueActionRow WHERE scenarioId = ? ORDER BY sortOrder`,
      args: [s.id as string],
    });
    await dest.execute({ sql: `DELETE FROM CrisisRescueActionRow WHERE scenarioId = ?`, args: [scenarioId] });
    for (const r of rescueActions.rows) {
      await dest.execute({
        sql: `INSERT INTO CrisisRescueActionRow (id, scenarioId, label, drugCategories, procedureKeywords, sortOrder) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [randomUUID(), scenarioId, r.label, r.drugCategories, r.procedureKeywords, r.sortOrder],
      });
    }

    console.log(`  ${templateKey}: トリガー${triggers.rows.length}件・救命アクション${rescueActions.rows.length}件`);
  }

  source.close();
  dest.close();
  console.log("完了しました。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
