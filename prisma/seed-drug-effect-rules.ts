// 薬剤影響エンジン(DrugEffectRule)のシードスクリプト。再実行可能(upsert)。
// 対象は「教育上頻出する薬剤性検査値・バイタル異常」のうち、DrugCategoryLinkで既に分類済みの
// 薬効カテゴリのみ(ユーザー指示によるスコープ限定)。効果量・発現タイミングは教育目的の代表値であり、
// 個々の症例向けの微調整は/admin/drug-effectsから行う想定。
import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });
const db = new PrismaClient({ adapter });

type RuleSeed = {
  majorCategory: string;
  subCategory: string | null;
  targetType: "lab" | "vital";
  target: string; // targetType=lab: LabItemMaster.code / targetType=vital: VitalPointのキー
  shiftValue: number;
  onsetDelayHours: number;
  note: string;
};

const RULES: RuleSeed[] = [
  // 抗凝固薬
  { majorCategory: "抗凝固薬", subCategory: "ビタミンK拮抗薬", targetType: "lab", target: "2B030", shiftValue: 12, onsetDelayHours: 48, note: "ワルファリンによるPT延長。治療域到達まで数日を要するため発現を遅延させる" },
  { majorCategory: "抗凝固薬", subCategory: "ヘパリン", targetType: "lab", target: "2B020", shiftValue: 40, onsetDelayHours: 0, note: "ヘパリンによるAPTT延長。投与後速やかに反映" },

  // 利尿薬
  { majorCategory: "利尿薬", subCategory: "ループ利尿薬", targetType: "lab", target: "3H015", shiftValue: -0.6, onsetDelayHours: 2, note: "ループ利尿薬によるK低下" },
  { majorCategory: "利尿薬", subCategory: "ループ利尿薬", targetType: "lab", target: "3C025", shiftValue: 4, onsetDelayHours: 6, note: "ループ利尿薬による脱水傾向でBUN軽度上昇" },
  { majorCategory: "利尿薬", subCategory: "ループ利尿薬", targetType: "lab", target: "3C015", shiftValue: 0.2, onsetDelayHours: 6, note: "ループ利尿薬による脱水傾向でCr軽度上昇" },
  { majorCategory: "利尿薬", subCategory: "チアジド系", targetType: "lab", target: "3H010", shiftValue: -5, onsetDelayHours: 24, note: "サイアザイド系利尿薬によるNa低下" },
  { majorCategory: "利尿薬", subCategory: "チアジド系", targetType: "lab", target: "3H015", shiftValue: -0.5, onsetDelayHours: 24, note: "サイアザイド系利尿薬によるK低下" },
  { majorCategory: "利尿薬", subCategory: "K保持性利尿薬", targetType: "lab", target: "3H015", shiftValue: 0.6, onsetDelayHours: 24, note: "K保持性利尿薬(MR拮抗薬等)によるK上昇" },

  // 降圧薬(ACE阻害薬/ARB/Ca拮抗薬)
  { majorCategory: "降圧薬", subCategory: "ACE阻害薬", targetType: "lab", target: "3H015", shiftValue: 0.3, onsetDelayHours: 48, note: "ACE阻害薬によるK軽度上昇" },
  { majorCategory: "降圧薬", subCategory: "ACE阻害薬", targetType: "lab", target: "3C015", shiftValue: 0.2, onsetDelayHours: 48, note: "ACE阻害薬による腎血行動態変化でCr軽度上昇" },
  { majorCategory: "降圧薬", subCategory: "ARB", targetType: "lab", target: "3H015", shiftValue: 0.3, onsetDelayHours: 48, note: "ARBによるK軽度上昇" },
  { majorCategory: "降圧薬", subCategory: "ARB", targetType: "lab", target: "3C015", shiftValue: 0.2, onsetDelayHours: 48, note: "ARBによる腎血行動態変化でCr軽度上昇" },
  { majorCategory: "降圧薬", subCategory: "Ca拮抗薬", targetType: "vital", target: "systolicBp", shiftValue: -20, onsetDelayHours: 2, note: "Ca拮抗薬による収縮期血圧低下" },
  { majorCategory: "降圧薬", subCategory: "Ca拮抗薬", targetType: "vital", target: "diastolicBp", shiftValue: -10, onsetDelayHours: 2, note: "Ca拮抗薬による拡張期血圧低下" },

  // NSAIDs
  { majorCategory: "解熱鎮痛薬", subCategory: "NSAIDs", targetType: "lab", target: "3C015", shiftValue: 0.2, onsetDelayHours: 24, note: "NSAIDsによる腎血流低下でCr軽度上昇" },
  { majorCategory: "解熱鎮痛薬", subCategory: "NSAIDs", targetType: "lab", target: "2A030", shiftValue: -0.8, onsetDelayHours: 72, note: "NSAIDsによる消化管出血傾向でHb軽度低下" },

  // 副腎皮質ステロイド
  { majorCategory: "副腎皮質ステロイド", subCategory: null, targetType: "lab", target: "3D010", shiftValue: 40, onsetDelayHours: 12, note: "ステロイドによる血糖上昇" },
  { majorCategory: "副腎皮質ステロイド", subCategory: null, targetType: "lab", target: "2A010", shiftValue: 2500, onsetDelayHours: 4, note: "ステロイドによる好中球優位のWBC上昇(辺縁プール動員、比較的速やかに出現)" },
  { majorCategory: "副腎皮質ステロイド", subCategory: null, targetType: "lab", target: "3H015", shiftValue: -0.4, onsetDelayHours: 24, note: "ステロイドの鉱質コルチコイド作用によるK低下" },

  // スタチン系
  { majorCategory: "脂質異常症治療薬", subCategory: "スタチン系(HMG-CoA還元酵素阻害薬)", targetType: "lab", target: "3B035", shiftValue: 15, onsetDelayHours: 96, note: "スタチンによるAST軽度上昇" },
  { majorCategory: "脂質異常症治療薬", subCategory: "スタチン系(HMG-CoA還元酵素阻害薬)", targetType: "lab", target: "3B045", shiftValue: 15, onsetDelayHours: 96, note: "スタチンによるALT軽度上昇" },
  { majorCategory: "脂質異常症治療薬", subCategory: "スタチン系(HMG-CoA還元酵素阻害薬)", targetType: "lab", target: "3B010", shiftValue: 80, onsetDelayHours: 96, note: "スタチンによるCK上昇(横紋筋融解の前駆的所見として)" },

  // 糖尿病治療薬(低血糖リスクの高いインスリン・SU薬のみ対象。DPP-4/SGLT2/ビグアナイドは単剤での低血糖リスクが低いためスコープ外)
  { majorCategory: "糖尿病治療薬", subCategory: "インスリン製剤", targetType: "lab", target: "3D010", shiftValue: -35, onsetDelayHours: 1, note: "インスリンによる血糖低下" },
  { majorCategory: "糖尿病治療薬", subCategory: "スルホニル尿素(SU)薬", targetType: "lab", target: "3D010", shiftValue: -35, onsetDelayHours: 3, note: "SU薬による血糖低下" },

  // β遮断薬
  { majorCategory: "β遮断薬", subCategory: null, targetType: "vital", target: "pulse", shiftValue: -20, onsetDelayHours: 1, note: "β遮断薬による徐脈" },

  // 強心配糖体(ジギタリス)
  { majorCategory: "強心配糖体", subCategory: null, targetType: "vital", target: "pulse", shiftValue: -15, onsetDelayHours: 6, note: "ジギタリスによる徐脈・不整脈傾向" },
];

async function main() {
  let created = 0;
  let updated = 0;
  for (const rule of RULES) {
    const category = await db.drugCategoryMaster.findFirst({
      where: { majorCategory: rule.majorCategory, subCategory: rule.subCategory },
    });
    if (!category) {
      console.warn(`[skip] category not found: ${rule.majorCategory} / ${rule.subCategory ?? "(null)"}`);
      continue;
    }
    const existing = await db.drugEffectRule.findUnique({
      where: { categoryId_targetType_target: { categoryId: category.id, targetType: rule.targetType, target: rule.target } },
    });
    await db.drugEffectRule.upsert({
      where: { categoryId_targetType_target: { categoryId: category.id, targetType: rule.targetType, target: rule.target } },
      update: { shiftValue: rule.shiftValue, onsetDelayHours: rule.onsetDelayHours, note: rule.note },
      create: {
        categoryId: category.id,
        targetType: rule.targetType,
        target: rule.target,
        shiftValue: rule.shiftValue,
        onsetDelayHours: rule.onsetDelayHours,
        note: rule.note,
      },
    });
    if (existing) updated++;
    else created++;
  }
  console.log(`DrugEffectRule seed done: ${created} created, ${updated} updated (of ${RULES.length} defined)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
