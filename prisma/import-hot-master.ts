import { readFileSync } from "node:fs";
import iconv from "iconv-lite";
import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { normalizeDrugName } from "../src/lib/drugName";

// MEDIS-DC HOTコードマスタ(HOT9形式)の取込スクリプト。
// 使い方: npx tsx prisma/import-hot-master.ts "C:\path\to\MEDISyyyymmdd_HOT9.TXT"
//
// 元ファイルはCP932(Shift-JIS+NEC/IBM拡張)エンコードの固定カラムCSV。
// 実データのhotCodeは9桁の数字のみなので、デモ用シード("HOT-100001"等)とは
// 名前空間が重ならず、このスクリプトは数字hotCodeの行だけを対象に総入れ替えする。
//
// 教育目的のため、以下は同一薬剤とみなして1件に統合する:
//   - 販売名が完全一致するだけの他社品(同じ薬を複数社が販売しているだけ)
//   - 後発品の「[製造会社]」表記違いのみの他社品(例: アモキシシリンカプセル125mg
//     の「NP」「TCK」「トーワ」等 → 会社名を外した名前だけで統合)
// 逆に、名前は同じでも規格単位の内容量(例: 生理食塩液の100mL/500mL/1L)が複数
// 存在する場合は別製品として残し、名前に内容量を補って区別する。

const HOT9_COL = {
  hotCode: 0, // 基準番号(HOTコード)
  hot7: 1, // 処方用番号(HOT7)
  kokujiName: 10, // 告示名称
  salesName: 11, // 販売名
  spec: 13, // 規格単位
  kubun: 19, // 区分(内/外/注/歯)
} as const;

const KUBUN_TO_ROUTE: Record<string, string> = {
  内: "内服",
  外: "外用",
  注: "注射・点滴",
  歯: "歯科用",
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // skip
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// 全角英数字・記号・スペースを半角化する(仮名・漢字・全角句読点はU+FF00帯の外にあるため対象外)。
function toHalfWidth(input: string): string {
  return input
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ")
    .trim();
}

// spec (e.g. "300mg1管", "500mL1瓶") -> { contentAmount: "300mg"/"500mL", dispenseUnit: "1管"/"1瓶" }.
// The order dialog's parseDose() treats the leading number in defaultDose as
// the order quantity, so dispenseUnit (not the full spec) is what gets stored
// there - otherwise the drug's content amount (300mg) would be misread as the
// quantity to order instead of the dispensing count (1).
function splitSpec(spec: string): { contentAmount: string; dispenseUnit: string } {
  const m = spec.match(/(\d+(?:\.\d+)?[^\d]+)$/);
  if (!m) return { contentAmount: spec, dispenseUnit: "" };
  return { contentAmount: spec.slice(0, m.index).trim(), dispenseUnit: m[0] };
}

// Generic drugs are named "[ingredient][form][strength]"Manufacturer"" (e.g.
// "Amoxicillin capsule 125mg "NP""). That trailing bracket is only a
// manufacturer/distributor tag - for teaching purposes it's the same product
// as every other manufacturer's version, so strip it before dedup so all of
// them collapse into one row. Guard: if the bracket content is purely numeric
// (e.g. "10"), it's an old-style brand name using the bracket to mark
// strength/variant (different product), not a manufacturer - leave it alone.
const MANUFACTURER_SUFFIX = /「([^「」]+)」$/;
const DOSE_LIKE_BRACKET = /^[0-9.]+[a-zA-Z%]*$/;

function stripManufacturerSuffix(name: string): string {
  const m = name.match(MANUFACTURER_SUFFIX);
  if (!m || DOSE_LIKE_BRACKET.test(m[1])) return name;
  return name.slice(0, m.index).trim();
}

// ごく一部の品目は、この教材での命名方針(一般名寄りの表記に統一)に対して
// MEDISの販売名がブランド色の強い愛称になっている。会社名除去後の基準名で
// 上書きする(hotCode単位だと、重複排除で別の会社の行が生き残った場合に
// 上書きが effectively 無効になってしまうため)。
// (対応する愛称は別途 prisma/seed-drug-aliases.ts でDrugAliasとして登録する)
//
// タゾピペ(タゾバクタム・ピペラシリン合剤)は2.25g/4.5g×瓶/バッグの4製品が
// 各10社弱から発売されており、「サンド」ブランドのみバッグ製剤の語順が
// 「2.25バッグ」と他社(「バッグ2.25」)から入れ替わっているため別エントリで補う。
const NAME_OVERRIDES: Record<string, string> = {
  "タゾピペ配合静注用2.25": "タゾバクタム・ピペラシリン2.25g",
  "タゾピペ配合静注用4.5": "タゾバクタム・ピペラシリン4.5g",
  "タゾピペ配合点滴静注用バッグ2.25": "タゾバクタム・ピペラシリン2.25gキット",
  "タゾピペ配合点滴静注用バッグ4.5": "タゾバクタム・ピペラシリン4.5gキット",
  "タゾピペ配合点滴静注用2.25バッグ": "タゾバクタム・ピペラシリン2.25gキット",
  "タゾピペ配合点滴静注用4.5バッグ": "タゾバクタム・ピペラシリン4.5gキット",
};

interface ImportedDrug {
  hotCode: string;
  name: string;
  normalizedName: string;
  category: null;
  defaultDose: string | null;
  unit: null;
  route: string | null;
  isInjectable: boolean;
}

interface RawEntry {
  hotCode: string;
  baseName: string;
  contentAmount: string;
  dispenseUnit: string;
  kubun: string;
}

function loadDrugs(filePath: string): ImportedDrug[] {
  const buffer = readFileSync(filePath);
  const text = iconv.decode(buffer, "cp932");
  const rows = parseCsv(text);
  const dataRows = rows.slice(1).filter((r) => r.length > 1);

  const seenHotCodes = new Set<string>();
  const entries: RawEntry[] = [];

  for (const r of dataRows) {
    const hotCode = r[HOT9_COL.hotCode]?.trim();
    if (!hotCode) continue;
    // ごく一部の基準番号(HOTコード)は同一コードに複数の販売名が紐づく(共同販売品など)。
    // hotCodeがUNIQUE制約のため、先勝ちで1件だけ残す。
    if (seenHotCodes.has(hotCode)) continue;
    seenHotCodes.add(hotCode);

    const rawName = toHalfWidth(r[HOT9_COL.salesName] ?? "") || toHalfWidth(r[HOT9_COL.kokujiName] ?? "");
    if (!rawName) continue;
    const strippedName = stripManufacturerSuffix(rawName);
    const baseName = NAME_OVERRIDES[strippedName] ?? strippedName;
    const { contentAmount, dispenseUnit } = splitSpec(toHalfWidth(r[HOT9_COL.spec] ?? ""));

    entries.push({ hotCode, baseName, contentAmount, dispenseUnit, kubun: r[HOT9_COL.kubun]?.trim() ?? "" });
  }

  // 輸液・浣腸液・血小板製剤・透析液などは商品名だけでは容量を区別しない
  // (例: "生理食塩液"が5mL~1Lまで規格単位でしか容量を示さない)。
  // 同じbaseNameの中でcontentAmountが複数種類ある場合だけ、名前に容量を
  // 補って区別する。1種類しかない場合(大半のケース)は素の名前のままにする。
  const amountsByBase = new Map<string, Set<string>>();
  for (const e of entries) {
    if (!amountsByBase.has(e.baseName)) amountsByBase.set(e.baseName, new Set());
    amountsByBase.get(e.baseName)!.add(e.contentAmount);
  }

  const seenNames = new Set<string>();
  const drugs: ImportedDrug[] = [];
  for (const e of entries) {
    const hasMultipleAmounts = (amountsByBase.get(e.baseName)?.size ?? 0) > 1;
    const name = hasMultipleAmounts && e.contentAmount ? `${e.baseName} ${e.contentAmount}` : e.baseName;
    if (seenNames.has(name)) continue; // 同一(会社名を除いた)名称+容量の他社品は重複として除外
    seenNames.add(name);

    drugs.push({
      hotCode: e.hotCode,
      name,
      normalizedName: normalizeDrugName(name),
      category: null,
      defaultDose: e.dispenseUnit || null,
      unit: null,
      route: KUBUN_TO_ROUTE[e.kubun] ?? null,
      isInjectable: e.kubun === "注",
    });
  }

  return drugs;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('使い方: npx tsx prisma/import-hot-master.ts "C:\\path\\to\\MEDISyyyymmdd_HOT9.TXT"');
    process.exit(1);
  }

  const drugs = loadDrugs(filePath);
  console.log(`読込: ${drugs.length}件(販売名で重複排除済み)`);

  const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });
  const db = new PrismaClient({ adapter });

  try {
    const numericHotCodeFilter = { hotCode: { not: { contains: "-" } } };

    // 総入れ替え(delete→create)だと、実データの薬剤が1件でもオーダーで
    // 参照された時点で以後ずっと再インポートできなくなる(削除でOrder.drugIdが
    // NULLになるため)。既存行はidを保ったままupdateし、今回の取込結果に
    // 存在しなくなった行だけ削除対象にする(それもオーダー未使用の場合のみ)。
    const existing = await db.drugMaster.findMany({ where: numericHotCodeFilter, select: { id: true, hotCode: true } });
    const existingByHotCode = new Map(existing.map((d) => [d.hotCode, d]));
    const newHotCodes = new Set(drugs.map((d) => d.hotCode));

    const toCreate = drugs.filter((d) => !existingByHotCode.has(d.hotCode));
    const toUpdate = drugs.filter((d) => existingByHotCode.has(d.hotCode));

    let created = 0;
    for (const batch of chunk(toCreate, 1000)) {
      const result = await db.drugMaster.createMany({ data: batch });
      created += result.count;
    }

    let updated = 0;
    for (const d of toUpdate) {
      await db.drugMaster.update({ where: { id: existingByHotCode.get(d.hotCode)!.id }, data: d });
      updated++;
    }

    const stale = existing.filter((d) => !newHotCodes.has(d.hotCode));
    let deleted = 0;
    let skippedInUse = 0;
    for (const d of stale) {
      const usageCount = await db.order.count({ where: { drugId: d.id } });
      if (usageCount > 0) {
        skippedInUse++;
        continue;
      }
      await db.drugMaster.delete({ where: { id: d.id } });
      deleted++;
    }

    console.log(`更新: ${updated}件 / 新規: ${created}件 / 削除: ${deleted}件` + (skippedInUse > 0 ? ` / オーダー使用中のためスキップ: ${skippedInUse}件` : ""));

    const routeCounts = await db.drugMaster.groupBy({
      by: ["route"],
      where: numericHotCodeFilter,
      _count: true,
    });
    console.log("route内訳:", routeCounts.map((r) => `${r.route ?? "(null)"}=${r._count}`).join(", "));
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
