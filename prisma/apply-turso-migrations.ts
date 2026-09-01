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

// 適用済みマイグレーションを記録する独自テーブル。
// prismaのmigrate deployが使えない(P1013: libsql://未対応)ための代替。
async function ensureTrackingTable() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS "_custom_migrations" (
      "name" TEXT NOT NULL PRIMARY KEY,
      "appliedAt" TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

async function getAppliedNames(): Promise<Set<string>> {
  const res = await client.execute(`SELECT "name" FROM "_custom_migrations"`);
  return new Set(res.rows.map((r) => r.name as string));
}

// 既存のTursoDBには追跡テーブル導入前に適用済みのマイグレーションがある。
// 「既に存在する」系のエラーはブートストラップとして適用済み扱いにし、
// それ以外のエラーは本当の異常として中断する。
const ALREADY_APPLIED_PATTERNS = [/already exists/i, /duplicate column name/i];

async function main() {
  await ensureTrackingTable();
  const applied = await getAppliedNames();

  for (const folder of folders) {
    if (applied.has(folder)) {
      console.log(`Skipping ${folder} (already applied).`);
      continue;
    }

    const sqlPath = path.join(migrationsDir, folder, "migration.sql");
    const sql = readFileSync(sqlPath, "utf-8");
    console.log(`Applying ${folder}...`);
    try {
      await client.executeMultiple(sql);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const looksAlreadyApplied = ALREADY_APPLIED_PATTERNS.some((p) => p.test(message));
      if (!looksAlreadyApplied) throw err;
      console.log(`  -> already present on remote (bootstrapping tracking record): ${message}`);
    }
    await client.execute({
      sql: `INSERT INTO "_custom_migrations" ("name") VALUES (?)`,
      args: [folder],
    });
  }

  console.log(`Done. ${folders.length} migration(s) accounted for on ${host}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => client.close());
