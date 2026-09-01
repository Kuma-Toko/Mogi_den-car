import { createClient } from "@libsql/client";

// ローカルdev.dbで完了済みの「HOTコードマスタ取り込み＋デモ7件からの付け替え」を
// Turso本番DBにも反映する。何度実行しても安全(hotCode/複合キーでON CONFLICT UPSERT)。

const sourceUrl = "file:./prisma/dev.db";
const rawDestUrl = process.env.DATABASE_URL;
if (!rawDestUrl || rawDestUrl.startsWith("file:")) {
  throw new Error("DATABASE_URL must point at the remote Turso database (libsql://...?authToken=...), not a local file.");
}
const destUrl: string = rawDestUrl;

// デモ薬剤(HOT-100001〜7)がローカルで実データのどのhotCodeに付け替えられたか。
// HOT-100007は付け替え先が無い(参照するオーダーが存在しない)ため対象外。
const DEMO_TO_REAL_HOTCODE: Record<string, string> = {
  "HOT-100001": "114886201",
  "HOT-100002": "126490601",
  "HOT-100003": "102714302",
  "HOT-100004": "107671405",
  "HOT-100005": "117710701",
  "HOT-100006": "112159901",
};

const BATCH = 200;

async function main() {
  const source = createClient({ url: sourceUrl });
  const dest = createClient({ url: destUrl });

  const drugs = await source.execute(
    `SELECT id, hotCode, name, normalizedName, category, defaultDose, unit, route, isInjectable
     FROM DrugMaster WHERE hotCode NOT LIKE 'HOT-%'`
  );
  console.log(`DrugMasterを${drugs.rows.length}件コピーします...`);
  for (let i = 0; i < drugs.rows.length; i += BATCH) {
    const chunk = drugs.rows.slice(i, i + BATCH);
    await dest.batch(
      chunk.map((r) => ({
        sql: `INSERT INTO DrugMaster (id, hotCode, name, normalizedName, category, defaultDose, unit, route, isInjectable)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(hotCode) DO UPDATE SET
                name=excluded.name, normalizedName=excluded.normalizedName, category=excluded.category,
                defaultDose=excluded.defaultDose, unit=excluded.unit, route=excluded.route, isInjectable=excluded.isInjectable`,
        args: [r.id, r.hotCode, r.name, r.normalizedName, r.category, r.defaultDose, r.unit, r.route, r.isInjectable],
      })),
      "write"
    );
    console.log(`  ${Math.min(i + BATCH, drugs.rows.length)}/${drugs.rows.length}`);
  }

  const aliases = await source.execute(
    `SELECT a.id, a.drugMasterId, a.aliasText, a.normalizedText, a.aliasType, a.createdAt, a.updatedAt
     FROM DrugAlias a JOIN DrugMaster d ON a.drugMasterId = d.id
     WHERE d.hotCode NOT LIKE 'HOT-%'`
  );
  console.log(`DrugAliasを${aliases.rows.length}件コピーします...`);
  for (let i = 0; i < aliases.rows.length; i += BATCH) {
    const chunk = aliases.rows.slice(i, i + BATCH);
    await dest.batch(
      chunk.map((r) => ({
        sql: `INSERT INTO DrugAlias (id, drugMasterId, aliasText, normalizedText, aliasType, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(drugMasterId, aliasText) DO UPDATE SET
                normalizedText=excluded.normalizedText, aliasType=excluded.aliasType`,
        args: [r.id, r.drugMasterId, r.aliasText, r.normalizedText, r.aliasType, r.createdAt, r.updatedAt],
      })),
      "write"
    );
  }

  console.log("既存オーダーをデモ薬剤から実薬剤へ付け替えます...");
  const demoRows = await dest.execute(`SELECT id, hotCode FROM DrugMaster WHERE hotCode LIKE 'HOT-%'`);
  for (const demo of demoRows.rows) {
    const demoId = demo.id as string;
    const demoHotCode = demo.hotCode as string;
    const realHotCode = DEMO_TO_REAL_HOTCODE[demoHotCode];
    if (!realHotCode) {
      console.log(`  ${demoHotCode}: 付け替え対象のオーダーなし(スキップ)`);
      continue;
    }
    const real = await dest.execute({ sql: `SELECT id FROM DrugMaster WHERE hotCode = ?`, args: [realHotCode] });
    if (real.rows.length === 0) {
      console.warn(`  警告: 実薬剤 ${realHotCode} がTurso上に見つかりません。${demoHotCode}の付け替えをスキップします。`);
      continue;
    }
    const realId = real.rows[0].id as string;
    const res = await dest.execute({ sql: `UPDATE "Order" SET drugId = ? WHERE drugId = ?`, args: [realId, demoId] });
    console.log(`  ${demoHotCode} -> ${realHotCode}: ${res.rowsAffected}件のオーダーを付け替え`);
  }

  console.log("デモ薬剤(未参照分)を削除します...");
  const del = await dest.execute(`DELETE FROM DrugMaster WHERE hotCode LIKE 'HOT-%'`);
  console.log(`削除: ${del.rowsAffected}件`);

  source.close();
  dest.close();
  console.log("完了しました。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
