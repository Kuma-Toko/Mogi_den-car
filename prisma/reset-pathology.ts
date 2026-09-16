import { createClient } from "@libsql/client";

// 病態モデル（DiseaseTemplate）とそれに紐づくデータを全削除する破壊的スクリプト。
// 「既存の病態モデルはすべて削除して（紐づいている模擬患者も全部削除して良い）、現状のものをより
// 整理された形にする」というユーザー指示に基づき、apply-engine-config.tsで新しいpathology-catalogを
// 適用する前に実行する。DrugMaster/LabItemMaster/PathogenMaster/User等のマスターデータは一切触れない。
//
// 安全装置: --confirm を明示的に渡さない限り何もしない（DRY RUNで削除対象件数のみ表示する）。
// 接続先ホストを必ず表示し、ローカルdev.dbか本番Tursoかを目視確認できるようにする。
//
// 削除順序（FK制約を明示的に尊重し、DBドライバのカスケードには依存しない）:
//   CaseCrisisTriggerProgress → TreatmentEvaluationDiseaseResult → TreatmentEvaluation →
//   Notification(caseId非null) → EncounterMessage → KarteEntry → Order → Vital → Problem →
//   CaseAssignment → CaseDiseaseLink → Case →
//   CrisisTriggerRow → TemplateCrisisScenario → CrisisRescueActionRow → CrisisRescueConfig →
//   TemplateLabPatternValue → TemplateLabPattern → DiseaseTemplate

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) throw new Error("DATABASE_URL is not set.");
const destUrl: string = rawUrl;
const confirmed = process.argv.includes("--confirm");

// URLのホスト部分だけを安全に表示する（トークン等の認証情報を含む可能性があるクエリ文字列は出さない）。
function describeUrl(url: string): string {
  if (url.startsWith("file:")) return url;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "(解析できないURL)";
  }
}

const TABLES_IN_DELETE_ORDER = [
  "CaseCrisisTriggerProgress",
  "TreatmentEvaluationDiseaseResult",
  "TreatmentEvaluation",
  "Notification", // caseIdがnullの行(症例に紐づかない通知)も含めて削除する。全通知を消してよいことは既に確認済み。
  "EncounterMessage",
  "KarteEntry",
  "Order",
  "Vital",
  "Problem",
  "CaseAssignment",
  "CaseDiseaseLink",
  "Case",
  "CrisisTriggerRow",
  "TemplateCrisisScenario",
  "CrisisRescueActionRow",
  "CrisisRescueConfig",
  "TemplateLabPatternValue",
  "TemplateLabPattern",
  "DiseaseTemplate",
] as const;

async function main() {
  const db = createClient({ url: destUrl });

  console.log(`接続先: ${describeUrl(destUrl)}`);
  console.log(confirmed ? "*** --confirm 指定あり: 実際に削除します ***" : "DRY RUN（削除は行いません。実行するには --confirm を付けてください）");
  console.log("");

  const counts: { table: string; count: number }[] = [];
  for (const table of TABLES_IN_DELETE_ORDER) {
    const result = await db.execute(`SELECT COUNT(*) as n FROM "${table}"`);
    counts.push({ table, count: Number(result.rows[0].n) });
  }

  console.log("削除対象件数:");
  for (const c of counts) console.log(`  ${c.table}: ${c.count}件`);

  if (!confirmed) {
    console.log("\nDRY RUNのため何も削除していません。実行するには `--confirm` を付けて再実行してください。");
    db.close();
    return;
  }

  console.log("\n削除を実行します...");
  for (const table of TABLES_IN_DELETE_ORDER) {
    await db.execute(`DELETE FROM "${table}"`);
    console.log(`  ${table}: 削除しました`);
  }

  db.close();
  console.log("\n完了しました。次に `npm run db:apply-engine-config` を実行して新しい病態モデルを投入してください。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
