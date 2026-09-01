import { createClient } from "@libsql/client";

// 2026-09-01: apply-turso-migrations.tsのブートストラップ時、add_drug_is_injectable
// マイグレーション(RedefineTable形式)が既に進化済みのDrugMasterに対してエラーなく
// 再実行され、normalizedName列が失われisInjectableが全件falseにリセットされた。
// このスクリプトはnormalizedName列を追加で戻すだけ(純粋にADD COLUMN、データは触らない)。
// 実データの復旧(normalizedName/isInjectableの値)は続けてdb:sync-drugs-turso
// (ローカルdev.dbを正としてUPSERT)を実行することで行う。

const url = process.env.DATABASE_URL;
if (!url || url.startsWith("file:")) {
  throw new Error(
    "DATABASE_URL must point at the remote Turso database (libsql://...?authToken=...), not a local file."
  );
}

const client = createClient({ url });

async function main() {
  const cols = await client.execute(`PRAGMA table_info("DrugMaster")`);
  const hasNormalizedName = cols.rows.some((r) => r.name === "normalizedName");

  if (hasNormalizedName) {
    console.log("normalizedName列は既に存在します。何もしません。");
    return;
  }

  console.log("normalizedName列を追加します...");
  await client.execute(
    `ALTER TABLE "DrugMaster" ADD COLUMN "normalizedName" TEXT NOT NULL DEFAULT ''`
  );
  await client.execute(
    `CREATE INDEX IF NOT EXISTS "DrugMaster_normalizedName_idx" ON "DrugMaster"("normalizedName")`
  );
  console.log("完了しました。続けて `npm run db:sync-drugs-turso` を実行して実データを復旧してください。");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => client.close());
