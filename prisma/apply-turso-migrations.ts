import { createClient } from "@libsql/client";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url || url.startsWith("file:")) {
  throw new Error(
    "DATABASE_URL must point at a remote Turso database (libsql://...?authToken=...), not a local file."
  );
}

const migrationsDir = path.join(__dirname, "migrations");
const folders = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const client = createClient({ url });
const host = new URL(url).host;

async function main() {
  for (const folder of folders) {
    const sqlPath = path.join(migrationsDir, folder, "migration.sql");
    const sql = readFileSync(sqlPath, "utf-8");
    console.log(`Applying ${folder}...`);
    await client.executeMultiple(sql);
  }
  console.log(`Done. Applied ${folders.length} migration(s) to ${host}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => client.close());
