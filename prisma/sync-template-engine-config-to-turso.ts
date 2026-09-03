import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";

// DiseaseTemplate.treatmentConfig/vitalsConfig/aiEvaluationGuideline と TemplateLabPattern(+Value)は、
// 「病態テンプレートのDB化」移行時にseed.tsやマイグレーションのデータ投入に含まれず、ローカルdev.dbにのみ
// 存在する(手動投入)。Tursoは列・テーブルはあるが空のため、admin/templatesが全テンプレート「エンジン未対応」
// になっている。ローカルを正としてTursoへ反映する。テンプレートの対応はkeyで引き直す
// (DiseaseTemplate.idはDB毎にseed.tsが独自生成するため、ローカルのidをそのまま使えない)。
// 何度実行しても安全(DiseaseTemplate列は上書きUPDATE、TemplateLabPatternはtemplateId+labItemCodeでUPSERT、
// valuesは対象pattern分を洗い替え)。

const sourceUrl = "file:./prisma/dev.db";
const rawDestUrl = process.env.DATABASE_URL;
if (!rawDestUrl || rawDestUrl.startsWith("file:")) {
  throw new Error("DATABASE_URL must point at the remote Turso database (libsql://...?authToken=...), not a local file.");
}
const destUrl: string = rawDestUrl;

async function main() {
  const source = createClient({ url: sourceUrl });
  const dest = createClient({ url: destUrl });

  const templates = await source.execute(
    `SELECT key, treatmentConfig, vitalsConfig, aiEvaluationGuideline FROM DiseaseTemplate`
  );
  console.log(`DiseaseTemplateの設定列を${templates.rows.length}件反映します...`);
  let templatesUpdated = 0;
  let templatesNotFound = 0;
  for (const t of templates.rows) {
    const res = await dest.execute({
      sql: `UPDATE DiseaseTemplate SET treatmentConfig = ?, vitalsConfig = ?, aiEvaluationGuideline = ? WHERE key = ?`,
      args: [t.treatmentConfig, t.vitalsConfig, t.aiEvaluationGuideline, t.key],
    });
    if (res.rowsAffected > 0) templatesUpdated++;
    else {
      templatesNotFound++;
      console.warn(`  警告: DiseaseTemplate(key=${t.key})がTurso上に見つかりません。スキップします。`);
    }
  }
  console.log(`DiseaseTemplate 更新: ${templatesUpdated}件 / 見つからずスキップ: ${templatesNotFound}件`);

  const patterns = await source.execute(
    `SELECT p.id, p.labItemCode, p.kind, p.mildText, p.moderateText, p.severeText, p.sortOrder, t.key as templateKey
     FROM TemplateLabPattern p JOIN DiseaseTemplate t ON p.templateId = t.id`
  );
  console.log(`TemplateLabPatternを${patterns.rows.length}件反映します...`);

  for (const p of patterns.rows) {
    const templateKey = p.templateKey as string;
    const destTemplate = await dest.execute({ sql: `SELECT id FROM DiseaseTemplate WHERE key = ?`, args: [templateKey] });
    if (destTemplate.rows.length === 0) {
      console.warn(`  警告: DiseaseTemplate(key=${templateKey})がTurso上に見つかりません。スキップします。`);
      continue;
    }
    const destTemplateId = destTemplate.rows[0].id as string;

    const existing = await dest.execute({
      sql: `SELECT id FROM TemplateLabPattern WHERE templateId = ? AND labItemCode = ?`,
      args: [destTemplateId, p.labItemCode],
    });
    const patternId = existing.rows.length > 0 ? (existing.rows[0].id as string) : randomUUID();

    await dest.execute({
      sql: `INSERT INTO TemplateLabPattern (id, templateId, labItemCode, kind, mildText, moderateText, severeText, sortOrder)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(templateId, labItemCode) DO UPDATE SET
              kind=excluded.kind, mildText=excluded.mildText, moderateText=excluded.moderateText,
              severeText=excluded.severeText, sortOrder=excluded.sortOrder`,
      args: [patternId, destTemplateId, p.labItemCode, p.kind, p.mildText, p.moderateText, p.severeText, p.sortOrder],
    });

    const values = await source.execute({
      sql: `SELECT tier, label, value, unit, note, sortOrder FROM TemplateLabPatternValue WHERE patternId = ? ORDER BY sortOrder`,
      args: [p.id as string],
    });
    await dest.execute({ sql: `DELETE FROM TemplateLabPatternValue WHERE patternId = ?`, args: [patternId] });
    for (const v of values.rows) {
      await dest.execute({
        sql: `INSERT INTO TemplateLabPatternValue (id, patternId, tier, label, value, unit, note, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [randomUUID(), patternId, v.tier, v.label, v.value, v.unit, v.note, v.sortOrder],
      });
    }
  }
  console.log("完了しました。");

  source.close();
  dest.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
