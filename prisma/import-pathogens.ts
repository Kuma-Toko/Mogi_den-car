import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// 感染症エンジンの原因菌マスター(PathogenMaster)+感受性データ(PathogenSusceptibility)の初期投入。
// 抗菌薬の系統(DrugCategoryMaster、majorCategory="抗菌薬")は既存のものをそのまま参照する
// (prisma/import-drug-categories.ts で投入済み)。既に投入済みの菌は上書き更新、感受性行は
// (pathogenId, categoryId)のunique制約でupsertするため、何度実行しても安全。
//
// 免責: 感受性データは標準的な教科書的知識をもとにこのスクリプト内で作成した参考値であり、
// 医学監修は受けていない（急変シナリオの臨床値と同様の位置づけ）。実際の教材として使う前に
// 医学的な確認を推奨する。

const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });
const db = new PrismaClient({ adapter });

type SusceptibilityLevel = "S" | "I" | "R";

type PathogenSeed = {
  name: string;
  gramStain: string | null;
  note: string;
  // 系統名(DrugCategoryMaster.subCategory)ごとの感受性。ここに無い系統は「データなし＝
  // カバーしない」として扱う(スキーマのコメント参照)。
  susceptibilities: Record<string, SusceptibilityLevel>;
};

const PATHOGENS: PathogenSeed[] = [
  {
    name: "肺炎球菌 (Streptococcus pneumoniae)",
    gramStain: "グラム陽性球菌",
    note: "市中肺炎の最多起因菌。莢膜を有し、髄膜炎・菌血症の原因にもなる。",
    susceptibilities: {
      "ペニシリン系(天然ペニシリン)": "S",
      "ペニシリン系(アミノペニシリン)": "S",
      "セフェム系(第3世代)": "S",
      "セフェム系(第1世代)": "I",
      "マクロライド系": "S",
      "ニューキノロン系": "S",
      "グリコペプチド系": "S",
      "カルバペネム系": "S",
    },
  },
  {
    name: "インフルエンザ菌 (Haemophilus influenzae)",
    gramStain: "グラム陰性桿菌",
    note: "市中肺炎・COPD増悪の主要起因菌。β-ラクタマーゼ産生株が多い。",
    susceptibilities: {
      "ペニシリン系(アミノペニシリン)": "I",
      "ペニシリン系(アミノペニシリン+βラクタマーゼ阻害薬配合)": "S",
      "セフェム系(第2世代)": "S",
      "セフェム系(第3世代)": "S",
      "マクロライド系": "S",
      "ニューキノロン系": "S",
      "テトラサイクリン系": "S",
    },
  },
  {
    name: "マイコプラズマ (Mycoplasma pneumoniae)",
    gramStain: null,
    note: "非定型肺炎の代表的起因菌。細胞壁を持たないためグラム染色されず、βラクタム系は無効。",
    susceptibilities: {
      "マクロライド系": "S",
      "ニューキノロン系": "S",
      "テトラサイクリン系": "S",
    },
  },
  {
    name: "レジオネラ属 (Legionella pneumophila)",
    gramStain: "グラム陰性桿菌",
    note: "非定型肺炎。染色性が弱くグラム染色での検出は困難。細胞内寄生菌でβラクタム系は無効。",
    susceptibilities: {
      "ニューキノロン系": "S",
      "マクロライド系": "S",
    },
  },
  {
    name: "黄色ブドウ球菌 MSSA (Staphylococcus aureus, MSSA)",
    gramStain: "グラム陽性球菌",
    note: "メチシリン感受性黄色ブドウ球菌。皮膚軟部組織感染・菌血症・心内膜炎など。",
    susceptibilities: {
      "セフェム系(第1世代)": "S",
      "セフェム系(第2世代)": "S",
      "ペニシリン系(広域・抗緑膿菌+βラクタマーゼ阻害薬配合)": "S",
      "リンコマイシン系": "S",
      "グリコペプチド系": "S",
      "オキサゾリジノン系": "S",
      "ニューキノロン系": "S",
      "マクロライド系": "I",
    },
  },
  {
    name: "黄色ブドウ球菌 MRSA (Staphylococcus aureus, MRSA)",
    gramStain: "グラム陽性球菌",
    note: "メチシリン耐性黄色ブドウ球菌。定義上、セフェム系・ペニシリン系は全て無効（本データでは意図的に空欄）。",
    susceptibilities: {
      "グリコペプチド系": "S",
      "オキサゾリジノン系": "S",
      "サルファ剤": "S",
      "リンコマイシン系": "I",
    },
  },
  {
    name: "大腸菌 (Escherichia coli)",
    gramStain: "グラム陰性桿菌",
    note: "尿路感染症・腹腔内感染・菌血症の代表的起因菌。",
    susceptibilities: {
      "セフェム系(第2世代)": "S",
      "セフェム系(第3世代)": "S",
      "ペニシリン系(アミノペニシリン+βラクタマーゼ阻害薬配合)": "S",
      "ペニシリン系(アミノペニシリン)": "I",
      "カルバペネム系": "S",
      "ニューキノロン系": "S",
      "アミノグリコシド系": "S",
      "ホスホマイシン系": "S",
      "サルファ剤": "S",
    },
  },
  {
    name: "肺炎桿菌 (Klebsiella pneumoniae)",
    gramStain: "グラム陰性桿菌",
    note: "院内肺炎・尿路感染・肝膿瘍など。アミノペニシリン系に天然耐性。",
    susceptibilities: {
      "セフェム系(第2世代)": "S",
      "セフェム系(第3世代)": "S",
      "カルバペネム系": "S",
      "ニューキノロン系": "S",
      "アミノグリコシド系": "S",
    },
  },
  {
    name: "緑膿菌 (Pseudomonas aeruginosa)",
    gramStain: "グラム陰性桿菌",
    note: "院内感染・免疫不全患者の重症感染症。狭域抗菌薬は無効で、抗緑膿菌活性を持つ薬剤が必要。",
    susceptibilities: {
      "ペニシリン系(広域・抗緑膿菌)": "S",
      "ペニシリン系(広域・抗緑膿菌+βラクタマーゼ阻害薬配合)": "S",
      "セフェム系(第4世代)": "S",
      "カルバペネム系": "S",
      "アミノグリコシド系": "S",
      "ニューキノロン系": "S",
      "ポリペプチド系": "S",
    },
  },
  {
    name: "化膿レンサ球菌 (Streptococcus pyogenes)",
    gramStain: "グラム陽性球菌",
    note: "咽頭炎・蜂窩織炎・劇症型溶血性レンサ球菌感染症の起因菌。ペニシリン耐性はほぼ報告されない。",
    susceptibilities: {
      "ペニシリン系(天然ペニシリン)": "S",
      "ペニシリン系(アミノペニシリン)": "S",
      "セフェム系(第1世代)": "S",
      "マクロライド系": "S",
      "リンコマイシン系": "S",
      "グリコペプチド系": "S",
    },
  },
  {
    name: "腸球菌 (Enterococcus faecalis)",
    gramStain: "グラム陽性球菌",
    note: "尿路感染・胆道感染・感染性心内膜炎など。セフェム系に天然耐性。",
    susceptibilities: {
      "ペニシリン系(天然ペニシリン)": "S",
      "ペニシリン系(アミノペニシリン)": "S",
      "グリコペプチド系": "S",
      "アミノグリコシド系": "I",
    },
  },
  {
    name: "バクテロイデス属 (Bacteroides fragilis、嫌気性菌代表)",
    gramStain: "グラム陰性桿菌（嫌気性）",
    note: "誤嚥性肺炎・腹腔内感染・骨盤内感染などの嫌気性菌代表。アミノグリコシド系は嫌気性菌に無効。",
    susceptibilities: {
      "ペニシリン系(アミノペニシリン+βラクタマーゼ阻害薬配合)": "S",
      "ペニシリン系(広域・抗緑膿菌+βラクタマーゼ阻害薬配合)": "S",
      "カルバペネム系": "S",
      "リンコマイシン系": "S",
      "オキサセフェム系(セフェム系近縁)": "S",
    },
  },
];

async function main() {
  const antibioticCategories = await db.drugCategoryMaster.findMany({ where: { majorCategory: "抗菌薬" } });
  const categoryIdBySubCategory = new Map(antibioticCategories.map((c) => [c.subCategory, c.id]));

  let pathogensUpserted = 0;
  let susceptibilityRowsUpserted = 0;
  let unknownCategoryWarnings = 0;

  for (const p of PATHOGENS) {
    const pathogen = await db.pathogenMaster.upsert({
      where: { name: p.name },
      update: { gramStain: p.gramStain, note: p.note },
      create: { name: p.name, gramStain: p.gramStain, note: p.note, sortOrder: pathogensUpserted },
    });
    pathogensUpserted++;

    for (const [subCategory, susceptibility] of Object.entries(p.susceptibilities)) {
      const categoryId = categoryIdBySubCategory.get(subCategory);
      if (!categoryId) {
        console.warn(`  警告: 抗菌薬の系統「${subCategory}」が DrugCategoryMaster に見つかりません(${p.name})。スキップします。`);
        unknownCategoryWarnings++;
        continue;
      }
      await db.pathogenSusceptibility.upsert({
        where: { pathogenId_categoryId: { pathogenId: pathogen.id, categoryId } },
        update: { susceptibility },
        create: { pathogenId: pathogen.id, categoryId, susceptibility },
      });
      susceptibilityRowsUpserted++;
    }
  }

  console.log(`原因菌: ${pathogensUpserted}件 / 感受性データ: ${susceptibilityRowsUpserted}件 を投入しました。`);
  if (unknownCategoryWarnings > 0) console.warn(`未解決の系統参照: ${unknownCategoryWarnings}件`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
