import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";

// TemplateCrisisScenario(+CrisisTriggerRow/CrisisRescueConfig/CrisisRescueActionRow)は、seed.tsにも
// マイグレーションにも取り込まれておらず、ローカルdev.dbにのみ存在する(手動投入されたデータ)。
// テンプレートの対応はkeyで引き直す(DiseaseTemplate.idはDB毎にseed.tsが独自生成するため、ローカルの
// idをそのまま使えない)。何度実行しても安全(scenarioはtemplateId+targetTemplateId+sortOrderで
// UPSERT、trigger/rescueConfig/rescueActionは対象分を洗い替え)。
//
// 注意: このスクリプトは元々CrisisRescueConfig分離前のスキーマ(TemplateCrisisScenarioにname/
// windowMinutes/postRescueSeverity/crisisVitals列があり、CrisisRescueActionRowがscenarioId経由
// だった頃)を前提に書かれていたため、現行スキーマでは存在しない列を参照してエラーになっていた。
// 危機病態(targetTemplate)自身の救命設定であるCrisisRescueConfig/CrisisRescueActionRowを分けて
// 同期するよう書き直している。ローカルの正しいJSON文字列で洗い替えるため、本番側に混入した
// レガシー(JSON化以前)の壊れたdrugCategories/procedureKeywordsもこの実行で修復される。

const sourceUrl = "file:./prisma/dev.db";
const rawDestUrl = process.env.DATABASE_URL;
if (!rawDestUrl || rawDestUrl.startsWith("file:")) {
  throw new Error("DATABASE_URL must point at the remote Turso database (libsql://...?authToken=...), not a local file.");
}
const destUrl: string = rawDestUrl;

async function main() {
  const source = createClient({ url: sourceUrl });
  const dest = createClient({ url: destUrl });

  // ── TemplateCrisisScenario + CrisisTriggerRow ──
  const scenarios = await source.execute(
    `SELECT s.id, s.sustainMinutes, s.sortOrder, t.key as watcherKey, tt.key as targetKey
     FROM TemplateCrisisScenario s
     JOIN DiseaseTemplate t ON s.templateId = t.id
     JOIN DiseaseTemplate tt ON s.targetTemplateId = tt.id`
  );
  console.log(`TemplateCrisisScenarioを${scenarios.rows.length}件反映します...`);

  for (const s of scenarios.rows) {
    const watcherKey = s.watcherKey as string;
    const targetKey = s.targetKey as string;

    const destWatcher = await dest.execute({ sql: `SELECT id FROM DiseaseTemplate WHERE key = ?`, args: [watcherKey] });
    const destTarget = await dest.execute({ sql: `SELECT id FROM DiseaseTemplate WHERE key = ?`, args: [targetKey] });
    if (destWatcher.rows.length === 0 || destTarget.rows.length === 0) {
      console.warn(`  警告: DiseaseTemplate(${watcherKey} または ${targetKey})がTurso上に見つかりません。スキップします。`);
      continue;
    }
    const destWatcherId = destWatcher.rows[0].id as string;
    const destTargetId = destTarget.rows[0].id as string;

    const existing = await dest.execute({
      sql: `SELECT id FROM TemplateCrisisScenario WHERE templateId = ? AND targetTemplateId = ? AND sortOrder = ?`,
      args: [destWatcherId, destTargetId, s.sortOrder],
    });
    const scenarioId = existing.rows.length > 0 ? (existing.rows[0].id as string) : randomUUID();

    if (existing.rows.length > 0) {
      await dest.execute({
        sql: `UPDATE TemplateCrisisScenario SET sustainMinutes = ? WHERE id = ?`,
        args: [s.sustainMinutes, scenarioId],
      });
    } else {
      await dest.execute({
        sql: `INSERT INTO TemplateCrisisScenario (id, templateId, targetTemplateId, sustainMinutes, sortOrder) VALUES (?, ?, ?, ?, ?)`,
        args: [scenarioId, destWatcherId, destTargetId, s.sustainMinutes, s.sortOrder],
      });
    }

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

    console.log(`  ${watcherKey} -> ${targetKey}: sustainMinutes=${s.sustainMinutes} トリガー${triggers.rows.length}件`);
  }

  // ── CrisisRescueConfig + CrisisRescueActionRow(危機病態=targetTemplate自身の救命設定) ──
  const rescueConfigs = await source.execute(
    `SELECT r.id, r.postRescueSeverity, t.key as targetKey
     FROM CrisisRescueConfig r
     JOIN DiseaseTemplate t ON r.templateId = t.id`
  );
  console.log(`\nCrisisRescueConfigを${rescueConfigs.rows.length}件反映します...`);

  for (const r of rescueConfigs.rows) {
    const targetKey = r.targetKey as string;
    const destTarget = await dest.execute({ sql: `SELECT id FROM DiseaseTemplate WHERE key = ?`, args: [targetKey] });
    if (destTarget.rows.length === 0) {
      console.warn(`  警告: DiseaseTemplate(key=${targetKey})がTurso上に見つかりません。スキップします。`);
      continue;
    }
    const destTargetId = destTarget.rows[0].id as string;

    const existing = await dest.execute({ sql: `SELECT id FROM CrisisRescueConfig WHERE templateId = ?`, args: [destTargetId] });
    const rescueConfigId = existing.rows.length > 0 ? (existing.rows[0].id as string) : randomUUID();

    await dest.execute({
      sql: `INSERT INTO CrisisRescueConfig (id, templateId, postRescueSeverity)
            VALUES (?, ?, ?)
            ON CONFLICT(templateId) DO UPDATE SET postRescueSeverity=excluded.postRescueSeverity`,
      args: [rescueConfigId, destTargetId, r.postRescueSeverity],
    });

    const actions = await source.execute({
      sql: `SELECT label, drugCategories, procedureKeywords, sortOrder FROM CrisisRescueActionRow WHERE rescueConfigId = ? ORDER BY sortOrder`,
      args: [r.id as string],
    });
    await dest.execute({ sql: `DELETE FROM CrisisRescueActionRow WHERE rescueConfigId = ?`, args: [rescueConfigId] });
    for (const a of actions.rows) {
      await dest.execute({
        sql: `INSERT INTO CrisisRescueActionRow (id, rescueConfigId, label, drugCategories, procedureKeywords, sortOrder) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [randomUUID(), rescueConfigId, a.label, a.drugCategories, a.procedureKeywords, a.sortOrder],
      });
    }

    console.log(`  ${targetKey}: postRescueSeverity=${r.postRescueSeverity} 救命アクション${actions.rows.length}件`);
  }

  source.close();
  dest.close();
  console.log("\n完了しました。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
