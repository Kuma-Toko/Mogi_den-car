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

// 2026-09-01の事故: RedefineTables形式(SQLiteのテーブル再構築によるALTER)は、
// 「既に追跡テーブル導入前の時点で適用済み」でもエラーなく再実行できてしまい、
// マイグレーション作成時点より後に追加された列を静かに消してしまう
// (DrugMaster.normalizedName消失・isInjectable全リセットの原因)。
// これを防ぐため、RedefineTables形式のマイグレーションは実行前に
// 「再構築後のテーブルが期待する列を、実DBの対象テーブルが既に全て持っているか」を
// 確認し、既に満たしていれば実行せずスキップする(実行しても安全な場合のみ実行する)。
function extractRedefineTarget(sql: string): { table: string; columns: string[] } | null {
  const match = sql.match(/CREATE TABLE "new_(\w+)" \(([\s\S]*?)\n\);/);
  if (!match) return null;
  const [, table, body] = match;
  const columns = [...body.matchAll(/^\s*"(\w+)"/gm)].map((m) => m[1]);
  return { table, columns };
}

async function tableAlreadySatisfies(table: string, expectedColumns: string[]): Promise<boolean> {
  const res = await client.execute(`PRAGMA table_info("${table}")`);
  const liveColumns = new Set(res.rows.map((r) => r.name as string));
  return expectedColumns.every((c) => liveColumns.has(c));
}

// 2026-09-16の事故: 1つのmigration.sql内に「独立したDDL(例: 新規CREATE TABLE)」と
// 「RedefineTables(列削減等のテーブル再構築)」が混在する場合、旧ロジックは
// tableAlreadySatisfies()の判定だけでファイル全体を丸ごとスキップしてしまい、
// RedefineTablesより前にある独立したCREATE TABLE文まで実行されずに「適用済み」と
// 記録されてしまった(TreatmentEvaluationDiseaseResultテーブルが本番に作られない事故)。
// これを防ぐため、ファイルを「RedefineTablesブロック」とそれ以外(plain)のセグメントに分割し、
// plainセグメントは常に実行、RedefineTablesブロックだけを個別に安全判定する。
type Segment = { type: "plain" | "redefine"; sql: string };

function splitIntoSegments(sql: string): Segment[] {
  const segments: Segment[] = [];
  const redefineBlockRe = /-- RedefineTables[\s\S]*?PRAGMA defer_foreign_keys=OFF;\r?\n?/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = redefineBlockRe.exec(sql))) {
    if (match.index > lastIndex) segments.push({ type: "plain", sql: sql.slice(lastIndex, match.index) });
    segments.push({ type: "redefine", sql: match[0] });
    lastIndex = redefineBlockRe.lastIndex;
  }
  if (lastIndex < sql.length) segments.push({ type: "plain", sql: sql.slice(lastIndex) });
  return segments;
}

async function executeWithBootstrapGuard(sql: string, context: string): Promise<void> {
  try {
    await client.executeMultiple(sql);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const looksAlreadyApplied = ALREADY_APPLIED_PATTERNS.some((p) => p.test(message));
    if (!looksAlreadyApplied) throw err;
    console.log(`  -> ${context}: already present on remote (bootstrapping tracking record): ${message}`);
  }
}

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
    for (const segment of splitIntoSegments(sql)) {
      if (!segment.sql.trim()) continue;

      if (segment.type === "redefine") {
        const target = extractRedefineTarget(segment.sql);
        if (target && (await tableAlreadySatisfies(target.table, target.columns))) {
          console.log(
            `  -> skipping RedefineTable target "${target.table}" (already has all expected columns; running it would risk dropping newer columns)`
          );
          continue;
        }
      }

      await executeWithBootstrapGuard(segment.sql, segment.type === "redefine" ? "RedefineTables block" : "statement");
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
