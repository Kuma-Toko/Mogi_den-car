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

  console.log("\n=== DrugCategoryMaster / DrugCategoryLink ===");
  try {
    const catCount = await client.execute(`SELECT COUNT(*) as c FROM "DrugCategoryMaster"`);
    console.log(`DrugCategoryMaster row count: ${catCount.rows[0].c}`);
    const linkCount = await client.execute(`SELECT COUNT(*) as c FROM "DrugCategoryLink"`);
    console.log(`DrugCategoryLink row count: ${linkCount.rows[0].c}`);
  } catch (err) {
    console.log(`DrugCategoryMaster/Link query failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log("\n=== DiseaseTemplate ===");
  try {
    const tplCount = await client.execute(`SELECT COUNT(*) as c FROM "DiseaseTemplate"`);
    console.log(`DiseaseTemplate row count: ${tplCount.rows[0].c}`);
    const keys = await client.execute(`SELECT "key" FROM "DiseaseTemplate" ORDER BY "key"`);
    console.log(`  keys: ${keys.rows.map((r) => r.key).join(", ")}`);
  } catch (err) {
    console.log(`DiseaseTemplate query failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log("\n=== Case columns (multi-disease model migration check) ===");
  try {
    const caseCols = await client.execute(`PRAGMA table_info("Case")`);
    const names = caseCols.rows.map((r) => String(r.name));
    for (const n of names) console.log(`  ${n}`);
    const oldFields = ["diseaseTemplateId", "physiologyParams", "severityBaselineAt", "aiSeverityRatePerHour"];
    const stillPresent = oldFields.filter((f) => names.includes(f));
    console.log(`  old Case fields still present (should be empty): ${stillPresent.join(", ") || "(none)"}`);
    console.log(`  has crisisConditionSince: ${names.includes("crisisConditionSince")}`);
    const caseCount = await client.execute(`SELECT COUNT(*) as c FROM "Case"`);
    console.log(`Case row count: ${caseCount.rows[0].c}`);
  } catch (err) {
    console.log(`Case columns query failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log("\n=== BasePhysiologyModel / CaseDiseaseLink ===");
  try {
    const base = await client.execute(`SELECT * FROM "BasePhysiologyModel"`);
    console.log(`BasePhysiologyModel row count: ${base.rows.length}`);
    for (const r of base.rows) console.log(`  ${JSON.stringify(r)}`);
    const linkCount = await client.execute(`SELECT COUNT(*) as c FROM "CaseDiseaseLink"`);
    console.log(`CaseDiseaseLink row count: ${linkCount.rows[0].c}`);
    const primaryCount = await client.execute(`SELECT COUNT(*) as c FROM "CaseDiseaseLink" WHERE "isPrimary" = 1`);
    console.log(`CaseDiseaseLink rows with isPrimary=true: ${primaryCount.rows[0].c}`);
    const casesWithoutLink = await client.execute(
      `SELECT COUNT(*) as c FROM "Case" c WHERE NOT EXISTS (SELECT 1 FROM "CaseDiseaseLink" l WHERE l."caseId" = c."id")`
    );
    console.log(`Case rows with zero CaseDiseaseLink (expected for cases with no template): ${casesWithoutLink.rows[0].c}`);
  } catch (err) {
    console.log(`BasePhysiologyModel/CaseDiseaseLink query failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log("\n=== TemplateCrisisScenario ===");
  try {
    const cols = await client.execute(`PRAGMA table_info("TemplateCrisisScenario")`);
    const names = cols.rows.map((r) => String(r.name));
    console.log(`  has sustainMinutes: ${names.includes("sustainMinutes")}`);
    const count = await client.execute(`SELECT COUNT(*) as c FROM "TemplateCrisisScenario"`);
    console.log(`TemplateCrisisScenario row count: ${count.rows[0].c}`);
  } catch (err) {
    console.log(`TemplateCrisisScenario query failed: ${err instanceof Error ? err.message : err}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => client.close());
