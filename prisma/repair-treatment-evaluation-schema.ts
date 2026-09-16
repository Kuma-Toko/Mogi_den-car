import { createClient } from "@libsql/client";

// 2026-09-16: apply-turso-migrations.tsのRedefineTablesスキップ判定バグにより、
// 20260916120000_treatment_evaluation_per_disease が本番Tursoで実質スキップされた
// （repair-drugmaster-schema.tsと同種の事故）。
// 原因: このマイグレーションはRedefineTables(TreatmentEvaluationの列削減)の前に
// CREATE TABLE TreatmentEvaluationDiseaseResult を含むが、tableAlreadySatisfies()は
// 「新テーブルが要求する列を旧テーブルが（列を削る側なので）たまたま全部持っている」
// ことをもって「このRedefine適用済み」と誤判定し、CREATE TABLE文を含むファイル全体を
// スキップしてしまった。結果、_custom_migrationsには適用済み記録が残るのに
// TreatmentEvaluationDiseaseResultテーブルが存在しない状態になった。
// apply-turso-migrations.ts側の判定ロジックは別途修正済み（今後の同種マイグレーションでは
// 再発しない）。既に「適用済み」と記録されてしまった本マイグレーションについては、
// このスクリプトで不足分（テーブル・インデックスの新規作成）だけを補う。
// TreatmentEvaluation側の列削減（旧appropriatenessScore等の削除）は実害が無い
// （新Prisma Clientはこれらの列を参照しない）ため、ここでは追わない。

const url = process.env.DATABASE_URL;
if (!url || url.startsWith("file:")) {
  throw new Error(
    "DATABASE_URL must point at the remote Turso database (libsql://...?authToken=...), not a local file."
  );
}

const client = createClient({ url });

async function tableExists(name: string): Promise<boolean> {
  const res = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
    args: [name],
  });
  return res.rows.length > 0;
}

async function main() {
  if (await tableExists("TreatmentEvaluationDiseaseResult")) {
    console.log("TreatmentEvaluationDiseaseResultは既に存在します。何もしません。");
    return;
  }

  console.log("TreatmentEvaluationDiseaseResultテーブルを作成します...");
  await client.execute(`
    CREATE TABLE "TreatmentEvaluationDiseaseResult" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "evaluationId" TEXT NOT NULL,
        "diseaseLinkId" TEXT NOT NULL,
        "appropriatenessScore" INTEGER NOT NULL,
        "contraindicated" BOOLEAN NOT NULL DEFAULT false,
        "severityRatePerHour" REAL,
        "resetSeverity" INTEGER,
        "rationale" TEXT,
        CONSTRAINT "TreatmentEvaluationDiseaseResult_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "TreatmentEvaluation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "TreatmentEvaluationDiseaseResult_diseaseLinkId_fkey" FOREIGN KEY ("diseaseLinkId") REFERENCES "CaseDiseaseLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await client.execute(`
    CREATE UNIQUE INDEX "TreatmentEvaluationDiseaseResult_evaluationId_diseaseLinkId_key"
    ON "TreatmentEvaluationDiseaseResult"("evaluationId", "diseaseLinkId")
  `);
  console.log("完了しました。続けて `npm run db:reset-pathology -- --confirm` を実行してください。");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => client.close());
