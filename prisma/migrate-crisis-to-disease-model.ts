import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";

// 危機シナリオ(TemplateCrisisScenario)を「crisisVitals固定値で上書きする専用の状態」から
// 「危機病態も普通のDiseaseTemplateとして扱い、生理モデルの通常加算に乗せる」形へ移行する。
// 既存の各シナリオ(元テンプレート1つにつき1件、計14件)について:
//   1. 新規DiseaseTemplate(危機病態)を作成する。vitalsConfig.perSeverityは
//      「crisisVitals - BasePhysiologyModel」から逆算する(severity=100のときcrisisVitalsへ一致する)。
//      treatmentConfig/labPatternsは元テンプレートのものを複製する(初期値として。後で管理画面から調整可能)。
//   2. 新規CrisisRescueConfig(postRescueSeverity・救命アクション)をこの新規テンプレートに作成する。
//   3. 既存のTemplateCrisisScenario行のtargetTemplateIdをこの新規テンプレートIDで埋める
//      (name/windowMinutes/crisisVitals/postRescueSeverity列は後続のマイグレーションで削除される)。
// 既にtargetTemplateIdが設定済みのシナリオはスキップするため、複数回実行しても安全。

const dbUrl = "file:./prisma/dev.db";

type VitalPoint = {
  temperature: number;
  systolicBp: number;
  diastolicBp: number;
  pulse: number;
  spo2: number;
  respRate: number;
};

const VITAL_FIELDS: (keyof VitalPoint)[] = ["temperature", "systolicBp", "diastolicBp", "pulse", "spo2", "respRate"];

async function main() {
  const db = createClient({ url: dbUrl });

  const baseRow = await db.execute(`SELECT * FROM BasePhysiologyModel WHERE id = 'default'`);
  if (baseRow.rows.length === 0) throw new Error("BasePhysiologyModel(id=default)が見つかりません。先に基礎生理モデルを初期化してください。");
  const base = baseRow.rows[0] as unknown as VitalPoint;

  const scenarios = await db.execute(`
    SELECT tcs.id, tcs.templateId, tcs.name, tcs.postRescueSeverity, tcs.crisisVitals, tcs.targetTemplateId,
           dt.key AS sourceKey, dt.treatmentConfig, dt.vitalsConfig
    FROM TemplateCrisisScenario tcs
    JOIN DiseaseTemplate dt ON dt.id = tcs.templateId
  `);
  console.log(`${scenarios.rows.length}件の危機シナリオを処理します...`);

  for (const s of scenarios.rows) {
    if (s.targetTemplateId) {
      console.log(`  ${s.sourceKey}: 既にtargetTemplateId設定済み。スキップ`);
      continue;
    }

    const sourceKey = s.sourceKey as string;
    const scenarioName = s.name as string;
    const crisisVitals = JSON.parse(s.crisisVitals as string) as VitalPoint;
    const perSeverity: Partial<VitalPoint> = {};
    for (const field of VITAL_FIELDS) {
      perSeverity[field] = crisisVitals[field] - base[field];
    }

    const newTemplateId = randomUUID();
    const newKey = `${sourceKey}_crisis`;
    const defaultParams = JSON.stringify({
      initialTempSlider: 50,
      improvementSpeedSlider: 50,
      initialSpo2Slider: 50,
      severitySlider: 85,
    });
    const vitalsConfig = JSON.stringify({ perSeverity });
    const treatmentConfig = (s.treatmentConfig as string) ?? JSON.stringify({ drugCategories: [], procedureKeywords: [] });

    await db.execute({
      sql: `INSERT INTO DiseaseTemplate (id, key, name, description, isCommon, defaultParams, treatmentConfig, vitalsConfig, aiEvaluationGuideline, createdByUserId, createdAt)
            VALUES (?, ?, ?, NULL, 1, ?, ?, ?, NULL, NULL, CURRENT_TIMESTAMP)`,
      args: [newTemplateId, newKey, scenarioName, defaultParams, treatmentConfig, vitalsConfig],
    });

    // 検査所見パターンを元テンプレートから複製する
    const patterns = await db.execute({
      sql: `SELECT id, labItemCode, kind, mildText, moderateText, severeText, sortOrder FROM TemplateLabPattern WHERE templateId = ?`,
      args: [s.templateId as string],
    });
    for (const p of patterns.rows) {
      const newPatternId = randomUUID();
      await db.execute({
        sql: `INSERT INTO TemplateLabPattern (id, templateId, labItemCode, kind, mildText, moderateText, severeText, sortOrder)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [newPatternId, newTemplateId, p.labItemCode, p.kind, p.mildText, p.moderateText, p.severeText, p.sortOrder],
      });
      const values = await db.execute({
        sql: `SELECT tier, label, value, unit, note, sortOrder FROM TemplateLabPatternValue WHERE patternId = ?`,
        args: [p.id as string],
      });
      for (const v of values.rows) {
        await db.execute({
          sql: `INSERT INTO TemplateLabPatternValue (id, patternId, tier, label, value, unit, note, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [randomUUID(), newPatternId, v.tier, v.label, v.value, v.unit, v.note, v.sortOrder],
        });
      }
    }

    // 救命設定(危機病態=新テンプレート自身の性質として)を作成し、旧救命アクションを複製する
    const rescueConfigId = randomUUID();
    await db.execute({
      sql: `INSERT INTO CrisisRescueConfig (id, templateId, postRescueSeverity) VALUES (?, ?, ?)`,
      args: [rescueConfigId, newTemplateId, s.postRescueSeverity],
    });
    const rescueActions = await db.execute({
      sql: `SELECT label, drugCategories, procedureKeywords, sortOrder FROM CrisisRescueActionRow WHERE scenarioId = ?`,
      args: [s.id as string],
    });
    for (const r of rescueActions.rows) {
      await db.execute({
        sql: `INSERT INTO CrisisRescueActionRow (id, rescueConfigId, label, drugCategories, procedureKeywords, sortOrder) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [randomUUID(), rescueConfigId, r.label, r.drugCategories, r.procedureKeywords, r.sortOrder],
      });
    }

    // 発火条件(既存シナリオ行)がこの新規テンプレートを指すようにする
    await db.execute({
      sql: `UPDATE TemplateCrisisScenario SET targetTemplateId = ? WHERE id = ?`,
      args: [newTemplateId, s.id as string],
    });

    console.log(`  ${sourceKey} -> ${newKey}(危機病態新設): 検査所見${patterns.rows.length}件・救命アクション${rescueActions.rows.length}件を複製`);
  }

  db.close();
  console.log("完了しました。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
