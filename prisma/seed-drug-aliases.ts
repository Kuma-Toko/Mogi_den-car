import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { normalizeDrugName } from "../src/lib/drugName";

// 既知の略称・俗称・表記ゆれをDrugAliasとして登録する。何度実行しても安全
// (drugMasterId+aliasTextの重複はスキップする)。管理画面からの追加分はここで
// 上書きされない。今後もこの形式で末尾に追記していく想定。
const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });
const db = new PrismaClient({ adapter });

async function addAlias(drugMasterId: string, aliasText: string, aliasType: string | null) {
  const existing = await db.drugAlias.findUnique({
    where: { drugMasterId_aliasText: { drugMasterId, aliasText } },
  });
  if (existing) return false;
  await db.drugAlias.create({
    data: { drugMasterId, aliasText, normalizedText: normalizeDrugName(aliasText), aliasType },
  });
  return true;
}

async function main() {
  let created = 0;

  // 「生食」: 生理食塩液系の全製品(容量・ブランド違いを含む)に付与し、
  // 検索時に候補として一覧表示させる(どの容量かはユーザーに選ばせる想定)。
  const salineDrugs = await db.drugMaster.findMany({
    where: { name: { startsWith: "生理食塩液" } },
    select: { id: true, name: true },
  });
  console.log(`生食 -> ${salineDrugs.length}件の生理食塩液系製品に付与`);
  for (const d of salineDrugs) {
    if (await addAlias(d.id, "生食", "略称")) created++;
  }

  // 「タゾピペ」: タゾバクタム・ピペラシリン配合剤(2.25g/4.5g×瓶/バッグの4製品)
  // 全てに、俗称・一般名の順序違い・略号表記をまとめて登録する。強さ・剤形は
  // 生食と同様にユーザーに候補から選ばせる想定。
  const tazoDrugs = await db.drugMaster.findMany({
    where: { name: { startsWith: "タゾバクタム・ピペラシリン" } },
    select: { id: true, name: true },
  });
  if (tazoDrugs.length === 0) {
    console.warn("警告: タゾバクタム・ピペラシリン配合剤が見つかりません。スキップします。");
  } else {
    console.log(`タゾピペ関連 -> ${tazoDrugs.length}件に付与`);
    const tazoAliases: [string, string][] = [
      ["タゾピペ", "俗称"],
      ["タゾバクタム・ピペラシリン", "表記ゆれ"],
      ["タゾバクタム/ピペラシリン", "表記ゆれ"],
      ["ピペラシリン・タゾバクタム", "表記ゆれ"],
      ["ピペラシリン/タゾバクタム", "表記ゆれ"],
      ["PIPC/TAZ", "略称"],
    ];
    for (const d of tazoDrugs) {
      for (const [aliasText, aliasType] of tazoAliases) {
        if (await addAlias(d.id, aliasText, aliasType)) created++;
      }
    }
  }

  console.log(`新規登録した別名: ${created}件`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
