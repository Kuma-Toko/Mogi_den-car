import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
if (!url || url.startsWith("file:")) {
  throw new Error(
    "DATABASE_URL must point at the remote Turso database (libsql://...?authToken=...), not a local file."
  );
}

const client = createClient({ url });

async function main() {
  console.log("=== DrugMaster columns ===");
  const drugCols = await client.execute(`PRAGMA table_info("DrugMaster")`);
  for (const r of drugCols.rows) console.log(`  ${r.name} (${r.type})`);

  const hasNormalizedName = drugCols.rows.some((r) => r.name === "normalizedName");
  console.log(`\nhasNormalizedName: ${hasNormalizedName}`);

  const drugCount = await client.execute(`SELECT COUNT(*) as c FROM "DrugMaster"`);
  console.log(`DrugMaster row count: ${drugCount.rows[0].c}`);

  if (hasNormalizedName) {
    const nonEmpty = await client.execute(
      `SELECT COUNT(*) as c FROM "DrugMaster" WHERE "normalizedName" != ''`
    );
    console.log(`DrugMaster rows with non-empty normalizedName: ${nonEmpty.rows[0].c}`);
  }

  console.log("\n=== DrugAlias ===");
  try {
    const aliasCount = await client.execute(`SELECT COUNT(*) as c FROM "DrugAlias"`);
    console.log(`DrugAlias row count: ${aliasCount.rows[0].c}`);
  } catch (err) {
    console.log(`DrugAlias query failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log("\n=== _custom_migrations ===");
  try {
    const applied = await client.execute(
      `SELECT "name", "appliedAt" FROM "_custom_migrations" ORDER BY "appliedAt"`
    );
    for (const r of applied.rows) console.log(`  ${r.name} @ ${r.appliedAt}`);
  } catch (err) {
    console.log(`_custom_migrations query failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log("\n=== LabItemMaster columns ===");
  const labCols = await client.execute(`PRAGMA table_info("LabItemMaster")`);
  for (const r of labCols.rows) console.log(`  ${r.name} (${r.type})`);

  console.log("\n=== SoapNote / KarteEntry ===");
  const tables = await client.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('SoapNote', 'KarteEntry')`
  );
  for (const r of tables.rows) console.log(`  table present: ${r.name}`);

  console.log("\n=== isInjectable sanity ===");
  const injectableCount = await client.execute(
    `SELECT COUNT(*) as c FROM "DrugMaster" WHERE "isInjectable" = 1`
  );
  console.log(`DrugMaster rows with isInjectable=true: ${injectableCount.rows[0].c}`);

  console.log("\n=== Order columns ===");
  const orderCols = await client.execute(`PRAGMA table_info("Order")`);
  for (const r of orderCols.rows) console.log(`  ${r.name} (${r.type})`);
  const orderCount = await client.execute(`SELECT COUNT(*) as c FROM "Order"`);
  console.log(`Order row count: ${orderCount.rows[0].c}`);
  const orderWithResult = await client.execute(
    `SELECT COUNT(*) as c FROM "Order" WHERE "resultText" IS NOT NULL OR "resultValues" IS NOT NULL`
  );
  console.log(`Order rows with non-null resultText/resultValues: ${orderWithResult.rows[0].c}`);

  console.log("\n=== LabItemMaster sanity ===");
  const labCount = await client.execute(`SELECT COUNT(*) as c FROM "LabItemMaster"`);
  console.log(`LabItemMaster row count: ${labCount.rows[0].c}`);
  const labWithSubcategory = await client.execute(
    `SELECT COUNT(*) as c FROM "LabItemMaster" WHERE "subcategory" IS NOT NULL`
  );
  console.log(`LabItemMaster rows with non-null subcategory: ${labWithSubcategory.rows[0].c}`);
  const labWithSampleValues = await client.execute(
    `SELECT COUNT(*) as c FROM "LabItemMaster" WHERE "sampleValues" IS NOT NULL`
  );
  console.log(`LabItemMaster rows with non-null sampleValues: ${labWithSampleValues.rows[0].c}`);

  console.log("\n=== KarteEntry columns ===");
  const karteCols = await client.execute(`PRAGMA table_info("KarteEntry")`);
  for (const r of karteCols.rows) console.log(`  ${r.name} (${r.type})`);
  const karteCount = await client.execute(`SELECT COUNT(*) as c FROM "KarteEntry"`);
  console.log(`KarteEntry row count: ${karteCount.rows[0].c}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => client.close());
