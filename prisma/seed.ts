import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import bcrypt from "bcryptjs";
import { normalizeDrugName } from "../src/lib/drugName";
import type { AmbulanceDetail, ReferralDetail } from "../src/app/(app)/patients/[caseId]/actions";

const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });
const db = new PrismaClient({ adapter });

async function hash(pw: string) {
  return bcrypt.hash(pw, 10);
}

async function main() {
  const passwordHash = await hash("password1");

  const student1 = await db.user.upsert({
    where: { loginId: "student1" },
    update: {},
    create: {
      loginId: "student1",
      passwordHash,
      name: "模擬 学生太郎",
      role: "STUDENT",
      grade: "医学部5年",
      affiliation: "消化器内科ローテーション",
    },
  });

  const teacher1 = await db.user.upsert({
    where: { loginId: "teacher1" },
    update: {},
    create: {
      loginId: "teacher1",
      passwordHash,
      name: "模擬 指導医一郎",
      role: "TEACHER",
      affiliation: "消化器内科 指導医",
    },
  });

  await db.user.upsert({
    where: { loginId: "admin1" },
    update: {},
    create: {
      loginId: "admin1",
      passwordHash,
      name: "システム管理者",
      role: "ADMIN",
      affiliation: "情報システム部門",
    },
  });

  const drugs = [
    { hotCode: "HOT-100001", name: "セフトリアキソン注射用 1g", category: "抗菌薬", defaultDose: "2g", unit: "g", route: "点滴静注", isInjectable: true },
    { hotCode: "HOT-100002", name: "アセトアミノフェン錠 500mg", category: "解熱鎮痛薬", defaultDose: "1錠", unit: "錠", route: "内服", isInjectable: false },
    { hotCode: "HOT-100003", name: "フロセミド注 20mg", category: "利尿薬", defaultDose: "20mg", unit: "mg", route: "静注", isInjectable: true },
    { hotCode: "HOT-100004", name: "生理食塩液 500mL", category: "輸液", defaultDose: "500mL", unit: "mL", route: "点滴静注", isInjectable: true },
    { hotCode: "HOT-100005", name: "インスリン グラルギン注", category: "糖尿病治療薬", defaultDose: "10単位", unit: "単位", route: "皮下注射", isInjectable: true },
    { hotCode: "HOT-100006", name: "ロキソプロフェン錠 60mg", category: "解熱鎮痛薬", defaultDose: "1錠", unit: "錠", route: "内服", isInjectable: false },
    { hotCode: "HOT-100007", name: "アジスロマイシン錠 250mg", category: "抗菌薬", defaultDose: "2錠", unit: "錠", route: "内服", isInjectable: false },
  ];
  for (const d of drugs) {
    const data = { ...d, normalizedName: normalizeDrugName(d.name) };
    await db.drugMaster.upsert({ where: { hotCode: d.hotCode }, update: data, create: data });
  }

  // JLAC11（日本臨床検査医学会 検査項目分類コード）の17桁コードリストを測定物単位で集約し、
  // 電子カルテのオーダー項目として粒度変換したマスターデータ（2026-08-31、jlac11_3_1.1a.xlsxより抽出）。
  // 旧バージョンはパネル単位（例:「血液一般（CBC）」1項目にWBC/Hb/Pltを内包）だったが、
  // 個別測定物単位（例: WBC/Hb/Pltをそれぞれ別項目）に全面移行した。
  // 一部の旧コードは新コードへ「その場でリネーム」してid（＝既存Orderの参照）を保持する。
  // 対応関係は RENAME_MAP を参照。同一コード内での複数値パネルは、値ごとに分解して各行へ振り分けた
  // （例: 旧LAB-002の [AST28, ALT22, Cr0.9, Na138, K4.1] → C2008/C2011/C3002/C7002/C7003 各1値）。
  const RENAME_MAP: Record<string, string> = {
    "LAB-001": "B1002", // 血液一般（CBC） → 白血球数（WBC）
    "LAB-002": "C3002", // 生化学一般 → クレアチニン（Cr）
    "LAB-003": "E3019", // CRP → C反応性蛋白（CRP）
    "LAB-004": "MB-001", // 血液培養（2セット）
    "LAB-005": "IMG-001", // 胸部X線
    "LAB-006": "H8039", // BNP → ヒト脳性Na利尿ペプチド（BNP）
    "LAB-007": "IMG-002", // 腹部エコー
    "LAB-008": "IMG-003", // 腹部CT
    "LAB-009": "IMG-004", // 頭部MRI
  };
  for (const [oldCode, newCode] of Object.entries(RENAME_MAP)) {
    const old = await db.labItemMaster.findUnique({ where: { code: oldCode } });
    if (old) await db.labItemMaster.update({ where: { id: old.id }, data: { code: newCode } });
  }

  // JLAC10（日本臨床検査医学会 検査項目分類コード）の「頻用項目 標準セット（224件）」に基づき、
  // 前回のJLAC11個別測定物ベースから、より体系的にレビューされた分析物コード体系へ移行した
  // （2026-08-31、JLAC10_分析物コード_頻用項目_最終版.xlsxより）。
  // 実オーダー実績がある項目はその場でリネームしてid（＝既存Orderの参照）を保持する。
  // 画像検査・血液培養・BNP/NT-proBNPはJLAC10の分析物コード体系でカバーされないため据え置き
  // （NT-proBNPはオーダー実績がなく対応項目も無いため削除）。
  const RENAME_MAP2: Record<string, string> = {
    "B1002": "2A010", // 白血球数（WBC）
    "C3002": "3C015", // クレアチニン
    "C3005": "3C025", // 尿素窒素（BUN）
    "E3019": "5C070", // C反応性蛋白（CRP）
    "C7002": "3H010", // ナトリウム（Na）
  };
  for (const [oldCode, newCode] of Object.entries(RENAME_MAP2)) {
    const old = await db.labItemMaster.findUnique({ where: { code: oldCode } });
    if (old) await db.labItemMaster.update({ where: { id: old.id }, data: { code: newCode } });
  }

  // 作成時の選択ミスにより誤ったコード（TNFレセプター2）が割り当てられていたため、
  // 正しいsIL-2Rのコードへ「その場でリネーム」してid（＝既存Orderの参照）を保持する（2026-09-02）。
  const RENAME_MAP3: Record<string, string> = {
    "5J016": "5J095", // 可溶性TNFレセプター2 → 可溶性IL-2レセプター
  };
  for (const [oldCode, newCode] of Object.entries(RENAME_MAP3)) {
    const old = await db.labItemMaster.findUnique({ where: { code: oldCode } });
    if (old) await db.labItemMaster.update({ where: { id: old.id }, data: { code: newCode } });
  }

  const OBSOLETE_CODES = [
    "A0001", "A2007", "B1001", "B1003", "B1004", "B2003", "B2006", "B2019", "B3009",
    "C1002", "C1003", "C1009", "C1010", "C2001", "C2008", "C2011", "C2012", "C2017", "C2024", "C2028", "C2042",
    "C3003", "C3004", "C4001", "C6002", "C6005", "C6008", "C6011", "C7003", "C7004", "C7006", "C8011", "C8012",
    "H8040", "K1001", "K1006",
    "V1055", "V1061", "V2010", "V2011", "V2026", "V2168", "V2171", "V2184", "V2252", "V2256", "V2259", "V2263",
    // 2026-09-02、項目整理により削除（血液ガスへ統合／重複・低頻度項目のため）
    "3H050", "3H055", "3H060", "3H065", "3H070", "3H075",
    "2A990", "2B032", "3C010", "3D050", "3E010", "3G125", "5C090",
    "IMG-CT-011", "IMG-CT-012", "IMG-MG-003", "IMG-MR-010", "IMG-US-005",
  ];
  for (const code of OBSOLETE_CODES) {
    const old = await db.labItemMaster.findUnique({ where: { code } });
    if (old) await db.labItemMaster.delete({ where: { id: old.id } });
  }

  const labItems = [
    // ── 据え置き（JLAC10の分析物コード体系ではカバーされない項目） ──
    {
      code: "MB-001",
      name: "血液培養（2セット）",
      category: "微生物学的検査",
      subcategory: "培養",
      unit: null,
      sampleResult: "グラム陽性球菌を少数検出（同定検査中）",
      sampleValues: null,
      isCulture: true,
      specimenSite: "blood",
    },
    // 検体別の塗抹・培養検査（感染症エンジン: LabItemMaster.specimenSite/microbiologyKind参照）。
    // microbiologyKind省略＝GENERAL（グラム染色速報→培養確定の2段階、既存のMB-001と同じ挙動）。
    {
      code: "MB-002",
      name: "喀痰培養（一般細菌）",
      category: "微生物学的検査",
      subcategory: "培養",
      unit: null,
      sampleResult: "口腔内常在菌のみ検出。病原性を有する菌の明らかな優位増殖は認めません。",
      sampleValues: null,
      isCulture: true,
      specimenSite: "sputum",
    },
    {
      code: "MB-003",
      name: "喀痰抗酸菌塗抹・培養",
      category: "微生物学的検査",
      subcategory: "培養",
      unit: null,
      sampleResult: "抗酸菌染色陰性。培養でも抗酸菌の発育を認めません。",
      sampleValues: null,
      isCulture: true,
      specimenSite: "sputum",
      microbiologyKind: "AFB",
    },
    {
      code: "MB-004",
      name: "咽頭ぬぐい液培養",
      category: "微生物学的検査",
      subcategory: "培養",
      unit: null,
      sampleResult: "上気道常在菌のみ検出。病原性を有する菌の明らかな優位増殖は認めません。",
      sampleValues: null,
      isCulture: true,
      specimenSite: "throat",
    },
    {
      code: "MB-005",
      name: "尿培養",
      category: "微生物学的検査",
      subcategory: "培養",
      unit: null,
      sampleResult: "有意な菌の発育を認めません（コロニーカウント基準未満）。",
      sampleValues: null,
      isCulture: true,
      specimenSite: "urine",
    },
    {
      code: "MB-006",
      name: "便培養（一般細菌）",
      category: "微生物学的検査",
      subcategory: "培養",
      unit: null,
      sampleResult: "サルモネラ・赤痢菌等の病原性腸内細菌は検出されません。通常の腸内細菌叢のみ検出。",
      sampleValues: null,
      isCulture: true,
      specimenSite: "stool",
      microbiologyKind: "STOOL",
    },
    {
      code: "MB-007",
      name: "便培養（Clostridioides difficile毒素）",
      category: "微生物学的検査",
      subcategory: "培養",
      unit: null,
      sampleResult: "CDトキシン抗原 陰性。",
      sampleValues: null,
      isCulture: true,
      specimenSite: "stool",
      microbiologyKind: "TOXIN",
    },
    {
      code: "MB-008",
      name: "便培養（腸管出血性大腸菌O157）",
      category: "微生物学的検査",
      subcategory: "培養",
      unit: null,
      sampleResult: "腸管出血性大腸菌(O157)は検出されません。",
      sampleValues: null,
      isCulture: true,
      specimenSite: "stool",
      microbiologyKind: "STOOL",
    },
    {
      code: "MB-009",
      name: "穿刺・排膿液培養",
      category: "微生物学的検査",
      subcategory: "培養",
      unit: null,
      sampleResult: "有意な病原菌の発育を認めません。",
      sampleValues: null,
      isCulture: true,
      specimenSite: "pus",
    },
    {
      code: "MB-010",
      name: "腟分泌物培養",
      category: "微生物学的検査",
      subcategory: "培養",
      unit: null,
      sampleResult: "腟内常在菌叢のみ検出。病原性を有する菌の明らかな優位増殖は認めません。",
      sampleValues: null,
      isCulture: true,
      specimenSite: "vaginal",
    },
    {
      code: "MB-011",
      name: "薬剤感受性検査",
      category: "微生物学的検査",
      subcategory: "培養",
      unit: null,
      sampleResult: "感受性検査の対象となる培養陽性所見がありません。",
      sampleValues: null,
      isCulture: true,
      microbiologyKind: "SUSCEPTIBILITY",
    },
    {
      code: "H8039",
      name: "ヒト脳性Na利尿ペプチド（BNP）",
      category: "内分泌学的検査",
      subcategory: "心不全マーカー",
      unit: "pg/mL",
      sampleResult: null,
      sampleValues: JSON.stringify([{ label: "BNP", value: 620, unit: "pg/mL" }]),
    },
    {
      code: "IMG-001",
      name: "胸部X線",
      category: "画像検査",
      subcategory: "単純写真",
      unit: null,
      sampleResult: "右下肺野に浸潤影を認める",
      sampleValues: null,
    },
    {
      code: "IMG-002",
      name: "腹部エコー",
      category: "画像検査",
      subcategory: "超音波",
      unit: null,
      sampleResult: "右下腹部に腫大した虫垂様構造を認める",
      sampleValues: null,
    },
    {
      code: "IMG-003",
      name: "腹部CT",
      category: "画像検査",
      subcategory: "CT",
      unit: null,
      sampleResult: "肝・胆・膵・脾・腎に明らかな異常を指摘できない。",
      sampleValues: null,
    },
    {
      code: "IMG-004",
      name: "頭部MRI",
      category: "画像検査",
      subcategory: "MRI",
      unit: null,
      sampleResult: "明らかな急性期病変を指摘できない。",
      sampleValues: null,
    },
    // ── 一般検査/尿一般検査 ──
    { code: "1A010", name: "蛋白定性[尿]", category: "一般検査", subcategory: "尿一般検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "1A015", name: "蛋白定量[尿]", category: "一般検査", subcategory: "尿一般検査", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "尿蛋白定量", value: 8, unit: "mg/dL" }]) },
    { code: "1A020", name: "糖定性[尿]", category: "一般検査", subcategory: "尿一般検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "1A030", name: "比重[尿]", category: "一般検査", subcategory: "尿一般検査", unit: null, sampleResult: null, sampleValues: JSON.stringify([{ label: "尿比重", value: 1.015, unit: "" }]) },
    { code: "1A035", name: "pH[尿]", category: "一般検査", subcategory: "尿一般検査", unit: null, sampleResult: null, sampleValues: JSON.stringify([{ label: "尿pH", value: 6.0, unit: "" }]) },
    { code: "1A060", name: "ケトン体定性[尿]（アセトン体）", category: "一般検査", subcategory: "尿一般検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "1A075", name: "白血球検査(試験紙)[尿]", category: "一般検査", subcategory: "尿一般検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "1A080", name: "亜硝酸塩(試験紙)[尿]", category: "一般検査", subcategory: "尿一般検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "1A100", name: "潜血反応[尿]", category: "一般検査", subcategory: "尿一般検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "1A105", name: "沈渣[尿]", category: "一般検査", subcategory: "尿一般検査", unit: null, sampleResult: "赤血球0-1/HPF　白血球0-1/HPF　上皮細胞少数", sampleValues: null },
    // ── 一般検査/糞便検査 ──
    { code: "1B030", name: "潜血反応(グアヤック法)[便]", category: "一般検査", subcategory: "糞便検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "1B040", name: "ヘモグロビン[便]", category: "一般検査", subcategory: "糞便検査", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "便Hb", value: 10, unit: "ng/mL" }]) },
    { code: "1B045", name: "ウロビリノーゲン定性[便]", category: "一般検査", subcategory: "糞便検査", unit: null, sampleResult: "正常(±)", sampleValues: null },
    // ── 一般検査/髄液検査 ──
    { code: "1C010", name: "蛋白定量[髄液]", category: "一般検査", subcategory: "髄液検査", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "髄液蛋白", value: 30, unit: "mg/dL" }]) },
    { code: "1C015", name: "糖定量[髄液]", category: "一般検査", subcategory: "髄液検査", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "髄液糖", value: 60, unit: "mg/dL" }]) },
    { code: "1C030", name: "細胞数[髄液]", category: "一般検査", subcategory: "髄液検査", unit: "/μL", sampleResult: null, sampleValues: JSON.stringify([{ label: "髄液細胞数", value: 2, unit: "/μL" }]) },
    { code: "1C990", name: "髄液一般検査", category: "一般検査", subcategory: "髄液検査", unit: null, sampleResult: "無色透明　細胞数2/μL　蛋白30mg/dL　糖60mg/dL　異常所見なし", sampleValues: null },
    // ── 血液学的検査/血液一般・形態検査 ──
    { code: "2A010", name: "白血球数（WBC）", category: "血液学的検査", subcategory: "血液一般・形態検査", unit: "/μL", sampleResult: null, sampleValues: JSON.stringify([{ label: "WBC", value: 6200, unit: "/μL" }]) },
    { code: "2A020", name: "赤血球数（RBC）", category: "血液学的検査", subcategory: "血液一般・形態検査", unit: "万/μL", sampleResult: null, sampleValues: JSON.stringify([{ label: "RBC", value: 480, unit: "万/μL" }]) },
    { code: "2A030", name: "ヘモグロビン（Hb）", category: "血液学的検査", subcategory: "血液一般・形態検査", unit: "g/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "Hb", value: 14.5, unit: "g/dL" }]) },
    { code: "2A040", name: "ヘマトクリット（Ht）", category: "血液学的検査", subcategory: "血液一般・形態検査", unit: "%", sampleResult: null, sampleValues: JSON.stringify([{ label: "Ht", value: 43.0, unit: "%" }]) },
    { code: "2A050", name: "血小板数（PLT）", category: "血液学的検査", subcategory: "血液一般・形態検査", unit: "万/μL", sampleResult: null, sampleValues: JSON.stringify([{ label: "Plt", value: 24.0, unit: "万/μL" }]) },
    { code: "2A060", name: "平均赤血球容積（MCV）", category: "血液学的検査", subcategory: "血液一般・形態検査", unit: "fL", sampleResult: null, sampleValues: JSON.stringify([{ label: "MCV", value: 90, unit: "fL" }]) },
    { code: "2A070", name: "平均赤血球血色素量（MCH）", category: "血液学的検査", subcategory: "血液一般・形態検査", unit: "pg", sampleResult: null, sampleValues: JSON.stringify([{ label: "MCH", value: 30, unit: "pg" }]) },
    { code: "2A080", name: "平均赤血球血色素濃度（MCHC）", category: "血液学的検査", subcategory: "血液一般・形態検査", unit: "%", sampleResult: null, sampleValues: JSON.stringify([{ label: "MCHC", value: 33.5, unit: "%" }]) },
    { code: "2A110", name: "網赤血球数（網状赤血球数）", category: "血液学的検査", subcategory: "血液一般・形態検査", unit: "‰", sampleResult: null, sampleValues: JSON.stringify([{ label: "網赤血球", value: 10, unit: "‰" }]) },
    { code: "2A160", name: "血液像（白血球分類）", category: "血液学的検査", subcategory: "血液一般・形態検査", unit: null, sampleResult: "好中球58%　リンパ球32%　単球6%　好酸球3%　好塩基球1%（異常細胞なし）", sampleValues: null },
    { code: "2A170", name: "骨髄像", category: "血液学的検査", subcategory: "血液一般・形態検査", unit: null, sampleResult: "有核細胞数・M/E比とも正常範囲、異常細胞なし", sampleValues: null },
    // ── 血液学的検査/凝固・線溶関連検査 ──
    { code: "2B010", name: "出血時間", category: "血液学的検査", subcategory: "凝固・線溶関連検査", unit: "分", sampleResult: null, sampleValues: JSON.stringify([{ label: "出血時間", value: 3, unit: "分" }]) },
    { code: "2B020", name: "活性化部分トロンボプラスチン時間（APTT）", category: "血液学的検査", subcategory: "凝固・線溶関連検査", unit: "秒", sampleResult: null, sampleValues: JSON.stringify([{ label: "APTT", value: 30, unit: "秒" }]) },
    { code: "2B030", name: "プロトロンビン時間（PT）", category: "血液学的検査", subcategory: "凝固・線溶関連検査", unit: "秒", sampleResult: null, sampleValues: JSON.stringify([{ label: "PT秒", value: 11.5, unit: "秒" }]) },
    { code: "2B100", name: "フィブリノゲン", category: "血液学的検査", subcategory: "凝固・線溶関連検査", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "フィブリノゲン", value: 280, unit: "mg/dL" }]) },
    { code: "2B120", name: "フィブリン・フィブリノゲン分解産物（FDP）", category: "血液学的検査", subcategory: "凝固・線溶関連検査", unit: "μg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "FDP", value: 3, unit: "μg/mL" }]) },
    { code: "2B140", name: "D-Dダイマー（FDP Dダイマー）", category: "血液学的検査", subcategory: "凝固・線溶関連検査", unit: "μg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "Dダイマー", value: 0.5, unit: "μg/mL" }]) },
    { code: "2B200", name: "アンチトロンビン", category: "血液学的検査", subcategory: "凝固・線溶関連検査", unit: "%", sampleResult: null, sampleValues: JSON.stringify([{ label: "アンチトロンビン", value: 100, unit: "%" }]) },
    { code: "2B475", name: "APTTクロスミキシング試験（凝固インヒビター(AＰＴT)）", category: "血液学的検査", subcategory: "凝固・線溶関連検査", unit: null, sampleResult: "正常パターン（是正あり、インヒビター疑い所見なし）", sampleValues: null },
    { code: "2B476", name: "PTクロスミキシング試験（凝固インヒビター(ＰＴ)）", category: "血液学的検査", subcategory: "凝固・線溶関連検査", unit: null, sampleResult: "正常パターン（是正あり、インヒビター疑い所見なし）", sampleValues: null },
    { code: "2B480", name: "von Willebrand因子（フォン・ウィルレブランド因子）", category: "血液学的検査", subcategory: "凝固・線溶関連検査", unit: "%", sampleResult: null, sampleValues: JSON.stringify([{ label: "VWF", value: 100, unit: "%" }]) },
    { code: "2B495", name: "ADAMTS13", category: "血液学的検査", subcategory: "凝固・線溶関連検査", unit: "%", sampleResult: null, sampleValues: JSON.stringify([{ label: "ADAMTS13", value: 100, unit: "%" }]) },
    { code: "2B700", name: "プロテインC", category: "血液学的検査", subcategory: "凝固・線溶関連検査", unit: "%", sampleResult: null, sampleValues: JSON.stringify([{ label: "プロテインC", value: 100, unit: "%" }]) },
    { code: "2B710", name: "プロテインS", category: "血液学的検査", subcategory: "凝固・線溶関連検査", unit: "%", sampleResult: null, sampleValues: JSON.stringify([{ label: "プロテインS", value: 100, unit: "%" }]) },
    // ── 血液学的検査/その他 ──
    { code: "2Z010", name: "血沈", category: "血液学的検査", subcategory: "その他", unit: "mm/時", sampleResult: null, sampleValues: JSON.stringify([{ label: "血沈", value: 8, unit: "mm/時" }]) },
    // ── 生化学的検査/蛋白・膠質反応 ──
    { code: "3A010", name: "総蛋白（TP）", category: "生化学的検査", subcategory: "蛋白・膠質反応", unit: "g/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "TP", value: 7.2, unit: "g/dL" }]) },
    { code: "3A015", name: "アルブミン", category: "生化学的検査", subcategory: "蛋白・膠質反応", unit: "g/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "Alb", value: 4.5, unit: "g/dL" }]) },
    { code: "3A016", name: "A/G比（アルブミン/グロブリン比）", category: "生化学的検査", subcategory: "蛋白・膠質反応", unit: null, sampleResult: null, sampleValues: JSON.stringify([{ label: "A/G比", value: 1.6, unit: "" }]) },
    { code: "3A020", name: "蛋白分画", category: "生化学的検査", subcategory: "蛋白・膠質反応", unit: null, sampleResult: "アルブミン62%　α1 3%　α2 8%　β 11%　γ 16%（正常パターン）", sampleValues: null },
    // ── 生化学的検査/酵素および関連物質 ──
    { code: "3B010", name: "クレアチンキナーゼ（CK）", category: "生化学的検査", subcategory: "酵素および関連物質", unit: "U/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "CK", value: 110, unit: "U/L" }]) },
    { code: "3B015", name: "CK-MB", category: "生化学的検査", subcategory: "酵素および関連物質", unit: "U/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "CK-MB", value: 12, unit: "U/L" }]) },
    { code: "3B035", name: "AST（GOT）", category: "生化学的検査", subcategory: "酵素および関連物質", unit: "U/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "AST", value: 22, unit: "U/L" }]) },
    { code: "3B045", name: "ALT（GPT）", category: "生化学的検査", subcategory: "酵素および関連物質", unit: "U/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "ALT", value: 20, unit: "U/L" }]) },
    { code: "3B050", name: "乳酸脱水素酵素（LD）", category: "生化学的検査", subcategory: "酵素および関連物質", unit: "U/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "LD", value: 180, unit: "U/L" }]) },
    { code: "3B070", name: "アルカリフォスファターゼ（ALP）", category: "生化学的検査", subcategory: "酵素および関連物質", unit: "U/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "ALP", value: 75, unit: "U/L" }]) },
    { code: "3B090", name: "γ-グルタミルトランスペプチダーゼ（γ-GT）", category: "生化学的検査", subcategory: "酵素および関連物質", unit: "U/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "γ-GTP", value: 25, unit: "U/L" }]) },
    { code: "3B110", name: "コリンエステラーゼ（ChE）", category: "生化学的検査", subcategory: "酵素および関連物質", unit: "U/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "ChE", value: 320, unit: "U/L" }]) },
    { code: "3B160", name: "アミラーゼ", category: "生化学的検査", subcategory: "酵素および関連物質", unit: "U/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "Amy", value: 80, unit: "U/L" }]) },
    { code: "3B175", name: "膵アミラーゼ（P-アミラーゼ）", category: "生化学的検査", subcategory: "酵素および関連物質", unit: "U/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "P-アミラーゼ", value: 45, unit: "U/L" }]) },
    { code: "3B176", name: "唾液腺アミラーゼ（S-アミラーゼ）", category: "生化学的検査", subcategory: "酵素および関連物質", unit: "U/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "S-アミラーゼ", value: 35, unit: "U/L" }]) },
    { code: "3B180", name: "リパーゼ", category: "生化学的検査", subcategory: "酵素および関連物質", unit: "U/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "リパーゼ", value: 40, unit: "U/L" }]) },
    // ── 生化学的検査/低分子窒素化合物 ──
    { code: "3C015", name: "クレアチニン", category: "生化学的検査", subcategory: "低分子窒素化合物", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "Cr", value: 0.8, unit: "mg/dL" }]) },
    { code: "3C020", name: "尿酸（UA）", category: "生化学的検査", subcategory: "低分子窒素化合物", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "UA", value: 5.0, unit: "mg/dL" }]) },
    { code: "3C025", name: "尿素窒素（UN）", category: "生化学的検査", subcategory: "低分子窒素化合物", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "BUN", value: 14, unit: "mg/dL" }]) },
    { code: "3C040", name: "アンモニア", category: "生化学的検査", subcategory: "低分子窒素化合物", unit: "μg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "アンモニア", value: 40, unit: "μg/dL" }]) },
    { code: "3C047", name: "総分岐鎖アミノ酸/チロシン モル比", category: "生化学的検査", subcategory: "低分子窒素化合物", unit: null, sampleResult: null, sampleValues: JSON.stringify([{ label: "BTR", value: 5.5, unit: "" }]) },
    // ── 生化学的検査/糖質および関連物質 ──
    { code: "3D010", name: "グルコース", category: "生化学的検査", subcategory: "糖質および関連物質", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "Glu", value: 92, unit: "mg/dL" }]) },
    { code: "3D045", name: "グリコヘモグロビンA1c（HbA1c）", category: "生化学的検査", subcategory: "糖質および関連物質", unit: "%", sampleResult: null, sampleValues: JSON.stringify([{ label: "HbA1c", value: 5.4, unit: "%" }]) },
    { code: "3D055", name: "グリコアルブミン", category: "生化学的検査", subcategory: "糖質および関連物質", unit: "%", sampleResult: null, sampleValues: JSON.stringify([{ label: "GA", value: 14.5, unit: "%" }]) },
    { code: "3D085", name: "1,5アンヒドログルシトール（1,5AG）", category: "生化学的検査", subcategory: "糖質および関連物質", unit: "μg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "1,5AG", value: 15, unit: "μg/mL" }]) },
    // ── 生化学的検査/有機酸 ──
    // ── 生化学的検査/脂質および関連物質 ──
    { code: "3F015", name: "トリグリセリド（TG）", category: "生化学的検査", subcategory: "脂質および関連物質", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "TG", value: 90, unit: "mg/dL" }]) },
    { code: "3F050", name: "コレステロール（TC）", category: "生化学的検査", subcategory: "脂質および関連物質", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "T-Cho", value: 190, unit: "mg/dL" }]) },
    { code: "3F069", name: "non HDL-コレステロール", category: "生化学的検査", subcategory: "脂質および関連物質", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "non-HDL-C", value: 150, unit: "mg/dL" }]) },
    { code: "3F070", name: "HDL-コレステロール（HDL-C）", category: "生化学的検査", subcategory: "脂質および関連物質", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "HDL", value: 60, unit: "mg/dL" }]) },
    { code: "3F077", name: "LDL-コレステロール", category: "生化学的検査", subcategory: "脂質および関連物質", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "LDL", value: 110, unit: "mg/dL" }]) },
    { code: "3F150", name: "リポ蛋白コレステロール分画", category: "生化学的検査", subcategory: "脂質および関連物質", unit: null, sampleResult: "HDL 32%　LDL 58%　VLDL 10%（正常パターン）", sampleValues: null },
    { code: "3F253", name: "肺サーファクタント蛋白D（SP-D）", category: "生化学的検査", subcategory: "脂質および関連物質", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "SP-D", value: 100, unit: "ng/mL" }]) },
    { code: "3F260", name: "マイクロバブルテスト", category: "生化学的検査", subcategory: "脂質および関連物質", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    // ── 生化学的検査/ビタミンおよび関連物質 ──
    { code: "3G025", name: "ビタミンB1（チアミン）", category: "生化学的検査", subcategory: "ビタミンおよび関連物質", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "VB1", value: 30, unit: "ng/mL" }]) },
    { code: "3G040", name: "ビタミンB12", category: "生化学的検査", subcategory: "ビタミンおよび関連物質", unit: "pg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "VB12", value: 500, unit: "pg/mL" }]) },
    { code: "3G065", name: "25-ヒドロキシビタミンD3", category: "生化学的検査", subcategory: "ビタミンおよび関連物質", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "25(OH)VD3", value: 25, unit: "ng/mL" }]) },
    { code: "3G070", name: "1,25-ジヒドロキシビタミンD3", category: "生化学的検査", subcategory: "ビタミンおよび関連物質", unit: "pg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "1,25(OH)2VD3", value: 40, unit: "pg/mL" }]) },
    { code: "3G105", name: "葉酸（FA）", category: "生化学的検査", subcategory: "ビタミンおよび関連物質", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "葉酸", value: 6, unit: "ng/mL" }]) },
    // ── 生化学的検査/電解質 ──
    { code: "3H010", name: "ナトリウム（Na）", category: "生化学的検査", subcategory: "電解質", unit: "mEq/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "Na", value: 140, unit: "mEq/L" }]) },
    { code: "3H015", name: "カリウム（K）", category: "生化学的検査", subcategory: "電解質", unit: "mEq/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "K", value: 4.2, unit: "mEq/L" }]) },
    { code: "3H020", name: "クロール（Cl）", category: "生化学的検査", subcategory: "電解質", unit: "mEq/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "Cl", value: 103, unit: "mEq/L" }]) },
    { code: "3H025", name: "マグネシウム（Mg）", category: "生化学的検査", subcategory: "電解質", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "Mg", value: 2.1, unit: "mg/dL" }]) },
    { code: "3H030", name: "カルシウム（Ca）", category: "生化学的検査", subcategory: "電解質", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "Ca", value: 9.5, unit: "mg/dL" }]) },
    { code: "3H035", name: "イオン化カルシウム", category: "生化学的検査", subcategory: "電解質", unit: "mmol/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "iCa", value: 1.2, unit: "mmol/L" }]) },
    { code: "3H040", name: "無機リン（IP）", category: "生化学的検査", subcategory: "電解質", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "IP", value: 3.4, unit: "mg/dL" }]) },
    { code: "3H045", name: "浸透圧", category: "生化学的検査", subcategory: "電解質", unit: "mOsm/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "浸透圧", value: 285, unit: "mOsm/L" }]) },
    // ── 生化学的検査/血液ガス（2026-09-02、単一項目「血液ガス」を動脈・静脈の2項目に分割し独立） ──
    { code: "3H080", name: "動脈血液ガス分析", category: "生化学的検査", subcategory: "血液ガス", unit: null, sampleResult: "pH 7.40　pCO2 40mmHg　pO2 90mmHg　HCO3 24mEq/L　BE 0mEq/L（room air、異常所見なし）", sampleValues: null },
    { code: "3H081", name: "静脈血液ガス分析", category: "生化学的検査", subcategory: "血液ガス", unit: null, sampleResult: "pH 7.36　pCO2 46mmHg　pO2 40mmHg　HCO3 25mEq/L　BE 1mEq/L（異常所見なし）", sampleValues: null },
    // ── 生化学的検査/生体微量金属 ──
    { code: "3I010", name: "鉄（Fe）", category: "生化学的検査", subcategory: "生体微量金属", unit: "μg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "Fe", value: 100, unit: "μg/dL" }]) },
    { code: "3I015", name: "総鉄結合能（TIBC）", category: "生化学的検査", subcategory: "生体微量金属", unit: "μg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "TIBC", value: 330, unit: "μg/dL" }]) },
    { code: "3I030", name: "亜鉛（Zn）", category: "生化学的検査", subcategory: "生体微量金属", unit: "μg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "Zn", value: 90, unit: "μg/dL" }]) },
    // ── 生化学的検査/生体色素関連物質 ──
    { code: "3J010", name: "総ビリルビン（TB）", category: "生化学的検査", subcategory: "生体色素関連物質", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "T-Bil", value: 0.8, unit: "mg/dL" }]) },
    { code: "3J015", name: "直接ビリルビン（DB）", category: "生化学的検査", subcategory: "生体色素関連物質", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "D-Bil", value: 0.2, unit: "mg/dL" }]) },
    // ── 内分泌学的検査/視床下部・下垂体ホルモン ──
    { code: "4A010", name: "成長ホルモン（GH）", category: "内分泌学的検査", subcategory: "視床下部・下垂体ホルモン", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "GH", value: 0.5, unit: "ng/mL" }]) },
    { code: "4A015", name: "ソマトメジンC（IGF-1）", category: "内分泌学的検査", subcategory: "視床下部・下垂体ホルモン", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "IGF-1", value: 180, unit: "ng/mL" }]) },
    { code: "4A020", name: "プロラクチン", category: "内分泌学的検査", subcategory: "視床下部・下垂体ホルモン", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "プロラクチン", value: 8, unit: "ng/mL" }]) },
    { code: "4A025", name: "副腎皮質刺激ホルモン（ACTH）", category: "内分泌学的検査", subcategory: "視床下部・下垂体ホルモン", unit: "pg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "ACTH", value: 25, unit: "pg/mL" }]) },
    { code: "4A030", name: "黄体形成ホルモン（LH）", category: "内分泌学的検査", subcategory: "視床下部・下垂体ホルモン", unit: "mIU/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "LH", value: 5, unit: "mIU/mL" }]) },
    { code: "4A035", name: "卵胞刺激ホルモン（FSH）", category: "内分泌学的検査", subcategory: "視床下部・下垂体ホルモン", unit: "mIU/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "FSH", value: 6, unit: "mIU/mL" }]) },
    { code: "4A055", name: "甲状腺刺激ホルモン（TSH）", category: "内分泌学的検査", subcategory: "視床下部・下垂体ホルモン", unit: "μIU/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "TSH", value: 1.8, unit: "μIU/mL" }]) },
    { code: "4A070", name: "アルギニンバソプレッシン（抗利尿ホルモン(ADH)）", category: "内分泌学的検査", subcategory: "視床下部・下垂体ホルモン", unit: "pg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "ADH", value: 1.0, unit: "pg/mL" }]) },
    // ── 内分泌学的検査/甲状腺ホルモンおよび結合蛋白 ──
    { code: "4B015", name: "遊離トリヨードサイロニン（FT3）", category: "内分泌学的検査", subcategory: "甲状腺ホルモンおよび結合蛋白", unit: "pg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "FT3", value: 3.0, unit: "pg/mL" }]) },
    { code: "4B035", name: "遊離サイロキシン（FT4）", category: "内分泌学的検査", subcategory: "甲状腺ホルモンおよび結合蛋白", unit: "ng/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "FT4", value: 1.2, unit: "ng/dL" }]) },
    // ── 内分泌学的検査/副甲状腺ホルモン ──
    { code: "4C025", name: "PTH-I（PTH-intact）", category: "内分泌学的検査", subcategory: "副甲状腺ホルモン", unit: "pg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "PTH-intact", value: 40, unit: "pg/mL" }]) },
    { code: "4C030", name: "PTH関連ペプチド（PTHrP）", category: "内分泌学的検査", subcategory: "副甲状腺ホルモン", unit: "pmol/L", sampleResult: null, sampleValues: JSON.stringify([{ label: "PTHrP", value: 1.0, unit: "pmol/L" }]) },
    { code: "4C035", name: "カルシトニン", category: "内分泌学的検査", subcategory: "副甲状腺ホルモン", unit: "pg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "カルシトニン", value: 10, unit: "pg/mL" }]) },
    // ── 内分泌学的検査/副腎皮質ホルモンおよび結合蛋白 ──
    { code: "4D030", name: "17-ヒドロキシコルチコステロイド（17-OHCS）", category: "内分泌学的検査", subcategory: "副腎皮質ホルモンおよび結合蛋白", unit: "mg/日", sampleResult: null, sampleValues: JSON.stringify([{ label: "17-OHCS", value: 5, unit: "mg/日" }]) },
    { code: "4D040", name: "コルチゾール", category: "内分泌学的検査", subcategory: "副腎皮質ホルモンおよび結合蛋白", unit: "μg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "コルチゾール", value: 12, unit: "μg/dL" }]) },
    { code: "4D090", name: "デヒドロエピアンドロステロン硫酸塩（DHEA-S）", category: "内分泌学的検査", subcategory: "副腎皮質ホルモンおよび結合蛋白", unit: "μg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "DHEA-S", value: 150, unit: "μg/dL" }]) },
    { code: "4D115", name: "アルドステロン（ALD）", category: "内分泌学的検査", subcategory: "副腎皮質ホルモンおよび結合蛋白", unit: "pg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "アルドステロン", value: 80, unit: "pg/mL" }]) },
    // ── 内分泌学的検査/副腎髄質ホルモン ──
    { code: "4E010", name: "カテコールアミン", category: "内分泌学的検査", subcategory: "副腎髄質ホルモン", unit: null, sampleResult: "アドレナリン0.03ng/mL　ノルアドレナリン0.30ng/mL　ドパミン0.02ng/mL（基準範囲内）", sampleValues: null },
    // ── 内分泌学的検査/性腺・胎盤ホルモンおよび結合蛋白 ──
    { code: "4F025", name: "エストラジオール（E2）", category: "内分泌学的検査", subcategory: "性腺・胎盤ホルモンおよび結合蛋白", unit: "pg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "E2", value: 80, unit: "pg/mL" }]) },
    { code: "4F045", name: "プロジェステロン", category: "内分泌学的検査", subcategory: "性腺・胎盤ホルモンおよび結合蛋白", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "プロゲステロン", value: 5, unit: "ng/mL" }]) },
    { code: "4F065", name: "テストステロン", category: "内分泌学的検査", subcategory: "性腺・胎盤ホルモンおよび結合蛋白", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "テストステロン", value: 5.0, unit: "ng/mL" }]) },
    { code: "4F080", name: "HCG", category: "内分泌学的検査", subcategory: "性腺・胎盤ホルモンおよび結合蛋白", unit: "mIU/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "HCG", value: 1, unit: "mIU/mL" }]) },
    { code: "4F100", name: "抗ミューラー管ホルモン（AMH/MIS）", category: "内分泌学的検査", subcategory: "性腺・胎盤ホルモンおよび結合蛋白", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "AMH", value: 3.0, unit: "ng/mL" }]) },
    // ── 内分泌学的検査/膵・消化管ホルモン ──
    { code: "4G010", name: "インスリン（インシュリン）", category: "内分泌学的検査", subcategory: "膵・消化管ホルモン", unit: "μU/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "インスリン", value: 6, unit: "μU/mL" }]) },
    { code: "4G020", name: "C-ペプチド", category: "内分泌学的検査", subcategory: "膵・消化管ホルモン", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "Cペプチド", value: 1.8, unit: "ng/mL" }]) },
    { code: "4G040", name: "ガストリン", category: "内分泌学的検査", subcategory: "膵・消化管ホルモン", unit: "pg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "ガストリン", value: 80, unit: "pg/mL" }]) },
    // ── 免疫学的検査/免疫グロブリン ──
    { code: "5A010", name: "IgG", category: "免疫学的検査", subcategory: "免疫グロブリン", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "IgG", value: 1200, unit: "mg/dL" }]) },
    { code: "5A015", name: "IgA", category: "免疫学的検査", subcategory: "免疫グロブリン", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "IgA", value: 220, unit: "mg/dL" }]) },
    { code: "5A020", name: "IgM", category: "免疫学的検査", subcategory: "免疫グロブリン", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "IgM", value: 110, unit: "mg/dL" }]) },
    { code: "5A058", name: "IgG4", category: "免疫学的検査", subcategory: "免疫グロブリン", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "IgG4", value: 40, unit: "mg/dL" }]) },
    { code: "5A090", name: "IgE", category: "免疫学的検査", subcategory: "免疫グロブリン", unit: "IU/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "IgE", value: 150, unit: "IU/mL" }]) },
    // ── 免疫学的検査/補体および関連物質 ──
    { code: "5B010", name: "血清補体価（CH50）", category: "免疫学的検査", subcategory: "補体および関連物質", unit: "U/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "CH50", value: 40, unit: "U/mL" }]) },
    { code: "5B023", name: "β1C/β1Aグロブリン（C3）", category: "免疫学的検査", subcategory: "補体および関連物質", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "C3", value: 100, unit: "mg/dL" }]) },
    { code: "5B024", name: "β1Eグロブリン（C4）", category: "免疫学的検査", subcategory: "補体および関連物質", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "C4", value: 25, unit: "mg/dL" }]) },
    // ── 免疫学的検査/血漿蛋白 ──
    { code: "5C040", name: "ハプトグロビン（Hp）", category: "免疫学的検査", subcategory: "血漿蛋白", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "ハプトグロビン", value: 120, unit: "mg/dL" }]) },
    { code: "5C045", name: "セルロプラスミン（Cp）", category: "免疫学的検査", subcategory: "血漿蛋白", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "セルロプラスミン", value: 28, unit: "mg/dL" }]) },
    { code: "5C065", name: "β2マイクログロブリン（BMG）", category: "免疫学的検査", subcategory: "血漿蛋白", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "β2MG", value: 0.18, unit: "mg/dL" }]) },
    { code: "5C070", name: "C反応性蛋白（CRP）", category: "免疫学的検査", subcategory: "血漿蛋白", unit: "mg/dL", sampleResult: null, sampleValues: JSON.stringify([{ label: "CRP", value: 0.15, unit: "mg/dL" }]) },
    { code: "5C093", name: "トロポニンT", category: "免疫学的検査", subcategory: "血漿蛋白", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "トロポニンT", value: 0.01, unit: "ng/mL" }]) },
    { code: "5C094", name: "トロポニンI", category: "免疫学的検査", subcategory: "血漿蛋白", unit: "pg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "トロポニンI", value: 5, unit: "pg/mL" }]) },
    { code: "5C095", name: "フェリチン", category: "免疫学的検査", subcategory: "血漿蛋白", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "フェリチン", value: 80, unit: "ng/mL" }]) },
    { code: "5C111", name: "癌胎児性フィブロネクチン", category: "免疫学的検査", subcategory: "血漿蛋白", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5C210", name: "KL-6", category: "免疫学的検査", subcategory: "血漿蛋白", unit: "U/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "KL-6", value: 300, unit: "U/mL" }]) },
    { code: "5C215", name: "プロカルシトニン（PCT）", category: "免疫学的検査", subcategory: "血漿蛋白", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "PCT", value: 0.03, unit: "ng/mL" }]) },
    // ── 免疫学的検査/腫瘍関連抗原 ──
    { code: "5D010", name: "CEA", category: "免疫学的検査", subcategory: "腫瘍関連抗原", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "CEA", value: 2.0, unit: "ng/mL" }]) },
    { code: "5D015", name: "α-フェトプロテイン（AFP）", category: "免疫学的検査", subcategory: "腫瘍関連抗原", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "AFP", value: 4, unit: "ng/mL" }]) },
    { code: "5D100", name: "CA125", category: "免疫学的検査", subcategory: "腫瘍関連抗原", unit: "U/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "CA125", value: 18, unit: "U/mL" }]) },
    { code: "5D130", name: "CA19-9", category: "免疫学的検査", subcategory: "腫瘍関連抗原", unit: "U/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "CA19-9", value: 15, unit: "U/mL" }]) },
    { code: "5D170", name: "DU-PAN-2", category: "免疫学的検査", subcategory: "腫瘍関連抗原", unit: "U/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "DU-PAN-2", value: 100, unit: "U/mL" }]) },
    { code: "5D175", name: "シアリルLeX-i抗原（SLX）", category: "免疫学的検査", subcategory: "腫瘍関連抗原", unit: "U/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "SLX", value: 30, unit: "U/mL" }]) },
    { code: "5D220", name: "SPan-1", category: "免疫学的検査", subcategory: "腫瘍関連抗原", unit: "U/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "SPan-1", value: 20, unit: "U/mL" }]) },
    { code: "5D300", name: "SCC", category: "免疫学的検査", subcategory: "腫瘍関連抗原", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "SCC", value: 1.0, unit: "ng/mL" }]) },
    { code: "5D305", name: "前立腺特異抗原（PSA）", category: "免疫学的検査", subcategory: "腫瘍関連抗原", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "PSA", value: 1.0, unit: "ng/mL" }]) },
    { code: "5D410", name: "神経特異エノラーゼ（NSE）", category: "免疫学的検査", subcategory: "腫瘍関連抗原", unit: "ng/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "NSE", value: 10, unit: "ng/mL" }]) },
    { code: "5D520", name: "PIVKA-2", category: "免疫学的検査", subcategory: "腫瘍関連抗原", unit: "mAU/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "PIVKA-2", value: 20, unit: "mAU/mL" }]) },
    { code: "5D550", name: "ガストリン放出ペプチド前駆体（ProGRP）", category: "免疫学的検査", subcategory: "腫瘍関連抗原", unit: "pg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "ProGRP", value: 40, unit: "pg/mL" }]) },
    // ── 免疫学的検査/感染症(非ウイルス)関連検査 ──
    { code: "5E035", name: "ASO", category: "免疫学的検査", subcategory: "感染症(非ウイルス)関連検査", unit: "IU/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "ASO", value: 150, unit: "IU/mL" }]) },
    { code: "5E036", name: "ASK", category: "免疫学的検査", subcategory: "感染症(非ウイルス)関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5E040", name: "A群β溶連菌迅速試験", category: "免疫学的検査", subcategory: "感染症(非ウイルス)関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5E042", name: "肺炎球菌抗原", category: "免疫学的検査", subcategory: "感染症(非ウイルス)関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5E064", name: "ヘリコバクター・ピロリ抗体", category: "免疫学的検査", subcategory: "感染症(非ウイルス)関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5E068", name: "ヘリコバクター・ピロリ抗原", category: "免疫学的検査", subcategory: "感染症(非ウイルス)関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5E074", name: "RPR法", category: "免疫学的検査", subcategory: "感染症(非ウイルス)関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5E075", name: "抗TP抗体", category: "免疫学的検査", subcategory: "感染症(非ウイルス)関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5E105", name: "寒冷凝集反応", category: "免疫学的検査", subcategory: "感染症(非ウイルス)関連検査", unit: null, sampleResult: "陰性　1:32未満", sampleValues: null },
    { code: "5E106", name: "マイコプラズマ抗体", category: "免疫学的検査", subcategory: "感染症(非ウイルス)関連検査", unit: null, sampleResult: "陰性　1:40未満", sampleValues: null },
    { code: "5E151", name: "(1→3)-β-Dグルカン", category: "免疫学的検査", subcategory: "感染症(非ウイルス)関連検査", unit: "pg/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "β-Dグルカン", value: 5, unit: "pg/mL" }]) },
    { code: "5E301", name: "結核菌特異蛋白刺激性遊離インターフェロン-γ（IGRA）", category: "免疫学的検査", subcategory: "感染症(非ウイルス)関連検査", unit: null, sampleResult: "陰性", sampleValues: null },
    // ── 免疫学的検査/ウイルス感染症検査 ──
    { code: "5F016", name: "HBs抗原", category: "免疫学的検査", subcategory: "ウイルス感染症検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5F191", name: "単純ヘルペスウイルス1型", category: "免疫学的検査", subcategory: "ウイルス感染症検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5F194", name: "サイトメガロウイルス", category: "免疫学的検査", subcategory: "ウイルス感染症検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5F202", name: "EBウイルス VCA", category: "免疫学的検査", subcategory: "ウイルス感染症検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5F360", name: "HCウイルス", category: "免疫学的検査", subcategory: "ウイルス感染症検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5F395", name: "風疹ウイルス", category: "免疫学的検査", subcategory: "ウイルス感染症検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5F399", name: "インフルエンザウイルスA・B型", category: "免疫学的検査", subcategory: "ウイルス感染症検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5F430", name: "RSウイルス", category: "免疫学的検査", subcategory: "ウイルス感染症検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5F560", name: "HIV-1+2", category: "免疫学的検査", subcategory: "ウイルス感染症検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5F625", name: "SARS-CoV-2", category: "免疫学的検査", subcategory: "ウイルス感染症検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5F630", name: "ノロウイルス", category: "免疫学的検査", subcategory: "ウイルス感染症検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    // ── 免疫学的検査/自己免疫関連検査 ──
    { code: "5G010", name: "抗核抗体（ANA）", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性　40倍未満", sampleValues: null },
    { code: "5G035", name: "抗dsDNA抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: "IU/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "抗dsDNA抗体", value: 5, unit: "IU/mL" }]) },
    { code: "5G065", name: "抗Sm抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G066", name: "抗RNP抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G076", name: "抗SS-A抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G077", name: "抗SS-B抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G085", name: "抗Scl-70抗体（抗トポイソメラーゼ1抗体）", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G090", name: "抗セントロメア抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G120", name: "抗Jo-1抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G121", name: "抗ARS抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G122", name: "抗MDA5抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G123", name: "抗Mi-2抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G124", name: "抗TIF1-γ抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G160", name: "リウマトイド因子（リウマトイド）", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: "IU/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "RF", value: 8, unit: "IU/mL" }]) },
    { code: "5G167", name: "抗CCP抗体（抗環状シトルリン化ペプチド抗体）", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: "U/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "抗CCP抗体", value: 2, unit: "U/mL" }]) },
    { code: "5G175", name: "抗ミトコンドリア抗体（AMA）", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G180", name: "抗平滑筋抗体（SMA）", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G185", name: "抗胃壁細胞抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G190", name: "抗内因子抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G285", name: "抗甲状腺ペルオキシダーゼ抗体（抗甲状腺マイクロゾーム抗体）", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: "IU/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "抗TPO抗体", value: 10, unit: "IU/mL" }]) },
    { code: "5G290", name: "抗サイログロブリン抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: "IU/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "抗Tg抗体", value: 20, unit: "IU/mL" }]) },
    { code: "5G340", name: "抗GAD抗体（抗グルタミン酸脱炭酸酵素抗体）", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: "U/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "抗GAD抗体", value: 1.0, unit: "U/mL" }]) },
    { code: "5G342", name: "抗IA-2抗体（ICA512抗体）", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G500", name: "ループスアンチコアグラント", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G505", name: "抗カルジオリピン抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性　10U/mL未満", sampleValues: null },
    { code: "5G515", name: "抗β2グリコプロテイン1抗体-IgG", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性　3.5U/mL未満", sampleValues: null },
    { code: "5G551", name: "PR3-ANCA（C-ANCA）", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性　U/mL未満", sampleValues: null },
    { code: "5G552", name: "MPO-ANCA（P-ANCA）", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: "U/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "MPO-ANCA", value: 1.0, unit: "U/mL" }]) },
    { code: "5G801", name: "抗GM1抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    { code: "5G821", name: "抗アクアポリン4抗体", category: "免疫学的検査", subcategory: "自己免疫関連検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    // ── 免疫学的検査/免疫血液学的検査 ──
    { code: "5H010", name: "血液型-ABO式", category: "免疫学的検査", subcategory: "免疫血液学的検査", unit: null, sampleResult: "A型", sampleValues: null },
    { code: "5H020", name: "血液型-Rh(D)因子", category: "免疫学的検査", subcategory: "免疫血液学的検査", unit: null, sampleResult: "Rh(D)陽性", sampleValues: null },
    { code: "5H025", name: "血液型-Rh-Hr式", category: "免疫学的検査", subcategory: "免疫血液学的検査", unit: null, sampleResult: "CcDee", sampleValues: null },
    { code: "5H120", name: "Coombs試験（クームス試験）", category: "免疫学的検査", subcategory: "免疫血液学的検査", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    // ── 免疫学的検査/細胞性免疫検査 ──
    { code: "5I014", name: "リンパ球刺激試験-薬剤（DLST）", category: "免疫学的検査", subcategory: "細胞性免疫検査", unit: null, sampleResult: "SI 105%（陰性、判定基準180%未満）", sampleValues: null },
    // ── 免疫学的検査/サイトカイン ──
    { code: "5J095", name: "可溶性IL-2レセプター（可溶性インターロイキン-2レセプター）", category: "免疫学的検査", subcategory: "サイトカイン", unit: "U/mL", sampleResult: null, sampleValues: JSON.stringify([{ label: "sIL-2R", value: 400, unit: "U/mL" }]) },
    // ── 微生物学的検査/その他 ──
    { code: "6Z100", name: "13C尿素呼気試験", category: "微生物学的検査", subcategory: "その他", unit: "‰", sampleResult: null, sampleValues: JSON.stringify([{ label: "13C尿素呼気試験", value: 2.0, unit: "‰" }]) },
    { code: "6Z200", name: "迅速ウレアーゼ試験", category: "微生物学的検査", subcategory: "その他", unit: null, sampleResult: "陰性(-)", sampleValues: null },
    // ── 画像検査 拡充（2026-09-01、JJ1017コード表 別表10/11の頻用部位・診療報酬点数表の命名慣行を参考に追加。
    // 既存のIMG-001〜004（胸部X線／腹部エコー／腹部CT／頭部MRI）とは別枠として、単純X線・超音波はJJ1017の
    // 頻用コード一覧に実在する部位名を体位バリエーションを集約して部位単位に整理し、CT・MRI・核医学・
    // 血管造影・マンモグラフィはJJ1017に頻用リストが無いため点数表準拠の一般的な命名で構成した） ──
    // 単純X線
    { code: "IMG-XP-001", name: "頭部X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "頭蓋骨に明らかな骨折・骨破壊像を認めない。", sampleValues: null },
    { code: "IMG-XP-002", name: "副鼻腔X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "上顎洞・篩骨洞に明らかな透亮性低下を認めない。", sampleValues: null },
    { code: "IMG-XP-003", name: "顔面骨X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "顔面骨に明らかな骨折線を認めない。", sampleValues: null },
    { code: "IMG-XP-004", name: "頸椎X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "頸椎の配列は保たれ、明らかな圧迫骨折・脱臼を認めない。", sampleValues: null },
    { code: "IMG-XP-005", name: "頸部軟部組織X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "咽頭後壁軟部組織の腫脹を認めない。気道の狭窄を認めない。", sampleValues: null },
    { code: "IMG-XP-006", name: "腹部X線（立位）", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "異常ガス像やニボー形成を認めない。フリーエアを認めない。", sampleValues: null },
    { code: "IMG-XP-007", name: "腹部X線（臥位）", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "腸管ガスパターンに明らかな異常を認めない。", sampleValues: null },
    { code: "IMG-XP-008", name: "胸椎X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "胸椎の配列は保たれ、明らかな圧迫骨折を認めない。", sampleValues: null },
    { code: "IMG-XP-009", name: "腰椎X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "腰椎の配列は保たれ、明らかなすべり症・圧迫骨折を認めない。", sampleValues: null },
    { code: "IMG-XP-010", name: "仙骨・尾骨X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "仙骨・尾骨に明らかな骨折線を認めない。", sampleValues: null },
    { code: "IMG-XP-011", name: "骨盤X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "骨盤骨に明らかな骨折を認めない。股関節の適合性は保たれる。", sampleValues: null },
    { code: "IMG-XP-012", name: "股関節X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "関節裂隙は保たれ、明らかな骨折・脱臼を認めない。", sampleValues: null },
    { code: "IMG-XP-013", name: "肩関節X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "肩関節の適合性は保たれ、明らかな骨折・脱臼を認めない。", sampleValues: null },
    { code: "IMG-XP-014", name: "鎖骨X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "鎖骨に明らかな骨折線を認めない。", sampleValues: null },
    { code: "IMG-XP-015", name: "上腕骨X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "上腕骨に明らかな骨折線を認めない。", sampleValues: null },
    { code: "IMG-XP-016", name: "肘関節X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "関節裂隙は保たれ、明らかな骨折・脱臼を認めない。fat pad signを認めない。", sampleValues: null },
    { code: "IMG-XP-017", name: "前腕骨X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "橈骨・尺骨に明らかな骨折線を認めない。", sampleValues: null },
    { code: "IMG-XP-018", name: "手関節X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "手根骨の配列は保たれ、明らかな骨折を認めない。", sampleValues: null },
    { code: "IMG-XP-019", name: "手部X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "中手骨・指骨に明らかな骨折を認めない。", sampleValues: null },
    { code: "IMG-XP-020", name: "大腿骨X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "大腿骨に明らかな骨折線を認めない。", sampleValues: null },
    { code: "IMG-XP-021", name: "膝関節X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "関節裂隙は保たれ、明らかな骨折・変形性変化を認めない。", sampleValues: null },
    { code: "IMG-XP-022", name: "下腿骨X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "脛骨・腓骨に明らかな骨折線を認めない。", sampleValues: null },
    { code: "IMG-XP-023", name: "足関節X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "関節裂隙は保たれ、明らかな骨折・脱臼を認めない。", sampleValues: null },
    { code: "IMG-XP-024", name: "足部X線", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "中足骨・趾骨に明らかな骨折を認めない。", sampleValues: null },
    { code: "IMG-XP-025", name: "骨密度検査（DEXA法）", category: "画像検査", subcategory: "単純写真", unit: null, sampleResult: "腰椎・大腿骨近位部の骨密度はYAM 80%以上で、骨粗鬆症の基準を満たさない。", sampleValues: null },
    // CT
    { code: "IMG-CT-001", name: "頭部CT（単純）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "明らかな出血・梗塞・占拠性病変を認めない。", sampleValues: null },
    { code: "IMG-CT-002", name: "頭部CT（造影）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "明らかな造影効果を伴う異常病変を認めない。", sampleValues: null },
    { code: "IMG-CT-003", name: "副鼻腔CT（単純）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "副鼻腔に明らかな粘膜肥厚・貯留液を認めない。", sampleValues: null },
    { code: "IMG-CT-004", name: "側頭骨CT（単純）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "中耳・内耳構造に明らかな骨破壊・奇形を認めない。", sampleValues: null },
    { code: "IMG-CT-005", name: "頸部CT（単純）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "頸部リンパ節の明らかな腫大を認めない。", sampleValues: null },
    { code: "IMG-CT-006", name: "頸部CT（造影）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "頸部主要血管・軟部組織に明らかな異常を認めない。", sampleValues: null },
    { code: "IMG-CT-007", name: "胸部CT（単純）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "肺野に明らかな結節影・浸潤影を認めない。", sampleValues: null },
    { code: "IMG-CT-008", name: "胸部CT（造影）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "縦隔・肺門に明らかなリンパ節腫大を認めない。", sampleValues: null },
    { code: "IMG-CT-009", name: "肺動脈CT（造影・肺塞栓プロトコル）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "肺動脈本幹〜区域枝に明らかな造影欠損（塞栓）を認めない。", sampleValues: null },
    { code: "IMG-CT-010", name: "冠動脈CT（造影）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "冠動脈に明らかな有意狭窄を認めない。石灰化スコアは軽度。", sampleValues: null },
    { code: "IMG-CT-013", name: "腹部・骨盤CT（単純）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "腹腔内に明らかな異常所見を認めない。", sampleValues: null },
    { code: "IMG-CT-014", name: "腹部・骨盤CT（造影）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "腹腔内臓器に明らかな造影効果異常を認めない。腸間膜・後腹膜に有意なリンパ節腫大を認めない。", sampleValues: null },
    { code: "IMG-CT-015", name: "下肢動脈CT（造影）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "大腿〜下腿動脈に明らかな有意狭窄・閉塞を認めない。", sampleValues: null },
    { code: "IMG-CT-016", name: "頸椎CT（単純）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "頸椎に明らかな骨折線を認めない。", sampleValues: null },
    { code: "IMG-CT-017", name: "腰椎CT（単純）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "腰椎に明らかな骨折線を認めない。椎間関節の変性は軽度。", sampleValues: null },
    { code: "IMG-CT-018", name: "骨盤・股関節CT（単純）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "骨盤骨・股関節に明らかな骨折を認めない。", sampleValues: null },
    { code: "IMG-CT-019", name: "全身CT（単純・外傷評価）", category: "画像検査", subcategory: "CT", unit: null, sampleResult: "頭部〜骨盤にかけて明らかな外傷性所見（出血・臓器損傷・骨折）を認めない。", sampleValues: null },
    // MRI
    { code: "IMG-MR-001", name: "頭部MRI（造影）", category: "画像検査", subcategory: "MRI", unit: null, sampleResult: "明らかな造影効果を伴う異常病変を認めない。", sampleValues: null },
    { code: "IMG-MR-002", name: "頭部MRA（単純・脳血管）", category: "画像検査", subcategory: "MRI", unit: null, sampleResult: "主幹脳動脈に明らかな狭窄・動脈瘤を認めない。", sampleValues: null },
    { code: "IMG-MR-003", name: "頸部MRA（単純・頸動脈）", category: "画像検査", subcategory: "MRI", unit: null, sampleResult: "総頸動脈〜内頸動脈に明らかな狭窄を認めない。", sampleValues: null },
    { code: "IMG-MR-004", name: "頸椎MRI（単純）", category: "画像検査", subcategory: "MRI", unit: null, sampleResult: "頸髄の圧迫や明らかな信号異常を認めない。", sampleValues: null },
    { code: "IMG-MR-005", name: "胸椎MRI（単純）", category: "画像検査", subcategory: "MRI", unit: null, sampleResult: "胸髄の圧迫や明らかな信号異常を認めない。", sampleValues: null },
    { code: "IMG-MR-006", name: "腰椎MRI（単純）", category: "画像検査", subcategory: "MRI", unit: null, sampleResult: "明らかな椎間板ヘルニア・神経根圧迫を認めない。", sampleValues: null },
    { code: "IMG-MR-007", name: "肩関節MRI（単純）", category: "画像検査", subcategory: "MRI", unit: null, sampleResult: "腱板に明らかな断裂所見を認めない。", sampleValues: null },
    { code: "IMG-MR-008", name: "膝関節MRI（単純）", category: "画像検査", subcategory: "MRI", unit: null, sampleResult: "半月板・靭帯に明らかな損傷を認めない。", sampleValues: null },
    { code: "IMG-MR-009", name: "股関節MRI（単純）", category: "画像検査", subcategory: "MRI", unit: null, sampleResult: "大腿骨頭に明らかな壊死像・骨髄浮腫を認めない。", sampleValues: null },
    { code: "IMG-MR-011", name: "MRCP（胆膵管撮影）", category: "画像検査", subcategory: "MRI", unit: null, sampleResult: "総胆管・膵管の拡張や明らかな結石像を認めない。", sampleValues: null },
    { code: "IMG-MR-012", name: "骨盤部MRI（単純）", category: "画像検査", subcategory: "MRI", unit: null, sampleResult: "骨盤内臓器に明らかな占拠性病変を認めない。", sampleValues: null },
    { code: "IMG-MR-013", name: "骨盤部MRI（造影）", category: "画像検査", subcategory: "MRI", unit: null, sampleResult: "骨盤内臓器に明らかな造影効果異常を認めない。", sampleValues: null },
    { code: "IMG-MR-014", name: "乳房MRI（造影）", category: "画像検査", subcategory: "MRI", unit: null, sampleResult: "明らかな造影効果を伴う腫瘤性病変を認めない。", sampleValues: null },
    { code: "IMG-MR-015", name: "心臓MRI（単純+造影）", category: "画像検査", subcategory: "MRI", unit: null, sampleResult: "左室壁運動は良好で、明らかな遅延造影（線維化）を認めない。", sampleValues: null },
    // 超音波
    { code: "IMG-US-001", name: "心エコー（経胸壁）", category: "画像検査", subcategory: "超音波", unit: null, sampleResult: "左室駆出率は正常範囲、明らかな弁膜症・壁運動異常を認めない。", sampleValues: null },
    { code: "IMG-US-002", name: "心エコー（経食道）", category: "画像検査", subcategory: "超音波", unit: null, sampleResult: "左房内に明らかな血栓を認めない。弁構造は保たれる。", sampleValues: null },
    { code: "IMG-US-003", name: "頸動脈エコー", category: "画像検査", subcategory: "超音波", unit: null, sampleResult: "頸動脈に明らかなプラーク・有意狭窄を認めない。IMTは正常範囲。", sampleValues: null },
    { code: "IMG-US-004", name: "下肢エコー", category: "画像検査", subcategory: "超音波", unit: null, sampleResult: "下肢動静脈に明らかな閉塞・血栓を認めない。", sampleValues: null },
    { code: "IMG-US-006", name: "頚部エコー", category: "画像検査", subcategory: "超音波", unit: null, sampleResult: "甲状腺の腫大・結節を認めない。頸部リンパ節の有意な腫大を認めない。", sampleValues: null },
    { code: "IMG-US-007", name: "乳房エコー", category: "画像検査", subcategory: "超音波", unit: null, sampleResult: "明らかな腫瘤性病変を認めない。", sampleValues: null },
    { code: "IMG-US-008", name: "骨盤部エコー（経腹）", category: "画像検査", subcategory: "超音波", unit: null, sampleResult: "子宮・付属器（または膀胱・前立腺）に明らかな異常を認めない。", sampleValues: null },
    { code: "IMG-US-009", name: "経腟エコー", category: "画像検査", subcategory: "超音波", unit: null, sampleResult: "子宮・卵巣に明らかな占拠性病変を認めない。", sampleValues: null },
    { code: "IMG-US-010", name: "産科超音波（胎児）", category: "画像検査", subcategory: "超音波", unit: null, sampleResult: "胎児心拍を確認。推定体重は相当週数範囲内。明らかな形態異常を認めない。", sampleValues: null },
    { code: "IMG-US-011", name: "関節エコー（運動器）", category: "画像検査", subcategory: "超音波", unit: null, sampleResult: "関節液貯留や明らかな滑膜肥厚を認めない。", sampleValues: null },
    // 核医学
    { code: "IMG-NM-001", name: "骨シンチグラフィ", category: "画像検査", subcategory: "核医学", unit: null, sampleResult: "全身骨に明らかな異常集積を認めない。", sampleValues: null },
    { code: "IMG-NM-002", name: "心筋血流シンチグラフィ", category: "画像検査", subcategory: "核医学", unit: null, sampleResult: "負荷・安静時ともに明らかな灌流欠損を認めない。", sampleValues: null },
    { code: "IMG-NM-003", name: "甲状腺シンチグラフィ", category: "画像検査", subcategory: "核医学", unit: null, sampleResult: "甲状腺への摂取は均一で、明らかなhot/cold noduleを認めない。", sampleValues: null },
    { code: "IMG-NM-004", name: "肺換気・血流シンチグラフィ", category: "画像検査", subcategory: "核医学", unit: null, sampleResult: "換気・血流分布に明らかなミスマッチ欠損を認めない。", sampleValues: null },
    { code: "IMG-NM-005", name: "脳血流SPECT", category: "画像検査", subcategory: "核医学", unit: null, sampleResult: "脳血流分布に明らかな左右差・限局性の低下を認めない。", sampleValues: null },
    { code: "IMG-NM-006", name: "腎シンチグラフィ（レノグラム）", category: "画像検査", subcategory: "核医学", unit: null, sampleResult: "左右腎の分腎機能はほぼ均等で、明らかな排泄遅延を認めない。", sampleValues: null },
    { code: "IMG-NM-007", name: "ガリウムシンチグラフィ", category: "画像検査", subcategory: "核医学", unit: null, sampleResult: "明らかな異常集積を認めない。", sampleValues: null },
    { code: "IMG-NM-008", name: "FDG-PET/CT", category: "画像検査", subcategory: "核医学", unit: null, sampleResult: "明らかな異常集積（悪性腫瘍を示唆する所見）を認めない。", sampleValues: null },
    { code: "IMG-NM-009", name: "唾液腺シンチグラフィ", category: "画像検査", subcategory: "核医学", unit: null, sampleResult: "左右唾液腺の摂取・排泄機能に明らかな左右差を認めない。", sampleValues: null },
    { code: "IMG-NM-010", name: "ドパミントランスポーターシンチグラフィ（DATスキャン）", category: "画像検査", subcategory: "核医学", unit: null, sampleResult: "線条体への取り込みは左右対称に保たれ、明らかな低下を認めない。", sampleValues: null },
    { code: "IMG-NM-011", name: "MIBG心筋シンチグラフィ", category: "画像検査", subcategory: "核医学", unit: null, sampleResult: "心臓/縦隔比（H/M比）は正常範囲で、明らかな交感神経機能低下を認めない。", sampleValues: null },
    // 血管造影
    { code: "IMG-AG-001", name: "脳血管造影", category: "画像検査", subcategory: "血管造影", unit: null, sampleResult: "主幹脳動脈に明らかな狭窄・動脈瘤・血管奇形を認めない。", sampleValues: null },
    { code: "IMG-AG-002", name: "冠動脈造影", category: "画像検査", subcategory: "血管造影", unit: null, sampleResult: "冠動脈主要3枝に明らかな有意狭窄を認めない。", sampleValues: null },
    { code: "IMG-AG-003", name: "腹部血管造影", category: "画像検査", subcategory: "血管造影", unit: null, sampleResult: "腹部主要血管に明らかな狭窄・出血源を認めない。", sampleValues: null },
    { code: "IMG-AG-004", name: "下肢血管造影", category: "画像検査", subcategory: "血管造影", unit: null, sampleResult: "下肢動脈に明らかな有意狭窄・閉塞を認めない。", sampleValues: null },
    { code: "IMG-AG-005", name: "肝動脈造影", category: "画像検査", subcategory: "血管造影", unit: null, sampleResult: "肝動脈支配域に明らかな腫瘍濃染を認めない。", sampleValues: null },
    { code: "IMG-AG-006", name: "腎動脈造影", category: "画像検査", subcategory: "血管造影", unit: null, sampleResult: "腎動脈に明らかな有意狭窄を認めない。", sampleValues: null },
    // マンモグラフィ
    { code: "IMG-MG-001", name: "マンモグラフィ（両側2方向）", category: "画像検査", subcategory: "マンモグラフィ", unit: null, sampleResult: "カテゴリ1〜2相当。明らかな腫瘤・石灰化を認めない。", sampleValues: null },
    { code: "IMG-MG-002", name: "マンモグラフィ（片側追加撮影）", category: "画像検査", subcategory: "マンモグラフィ", unit: null, sampleResult: "圧迫拡大撮影で明らかな悪性所見を認めない。", sampleValues: null },
  ];
  // オーダー画面のタブ表示順（画像検査は別タブ群のため対象外）
  const LAB_CATEGORY_ORDER: Record<string, number> = {
    "生化学的検査": 0,
    "免疫学的検査": 1,
    "内分泌学的検査": 2,
    "血液学的検査": 3,
    "一般検査": 4,
    "微生物学的検査": 5,
  };
  for (const l of labItems) {
    const sortOrder = LAB_CATEGORY_ORDER[l.category] ?? 99;
    await db.labItemMaster.upsert({ where: { code: l.code }, update: { ...l, sortOrder }, create: { ...l, sortOrder } });
  }

  const usageTemplates = [
    { label: "分1　1日1回", sortOrder: 10 },
    { label: "分2　朝夕", sortOrder: 20 },
    { label: "分3　朝昼夕", sortOrder: 30 },
    { label: "分4　朝昼夕食後・眠前", sortOrder: 40 },
    { label: "眠前", sortOrder: 50 },
    { label: "頓用", sortOrder: 60 },
    { label: "発熱時", sortOrder: 70 },
    { label: "持続投与", sortOrder: 80 },
    { label: "1回のみ", sortOrder: 90 },
  ];
  for (const u of usageTemplates) {
    await db.usageTemplate.upsert({ where: { label: u.label }, update: u, create: u });
  }

  const templateDefs = [
    {
      key: "infection",
      name: "感染症（肺炎・敗血症系）",
      description: "発熱・炎症反応・酸素化の経時変化",
      defaultParams: { initialTempSlider: 78, improvementSpeedSlider: 45, initialSpo2Slider: 55, severitySlider: 65 },
      isInfectious: true,
    },
    {
      key: "heart_failure",
      name: "心不全",
      description: "うっ血所見・BNP・体重変化",
      defaultParams: { initialTempSlider: 30, improvementSpeedSlider: 40, initialSpo2Slider: 60, severitySlider: 55 },
    },
    {
      key: "dehydration",
      name: "脱水・電解質異常",
      description: "腎機能・電解質の推移",
      defaultParams: { initialTempSlider: 40, improvementSpeedSlider: 55, initialSpo2Slider: 25, severitySlider: 40 },
    },
    {
      key: "dka",
      name: "糖尿病性ケトアシドーシス（DKA）",
      description: "高血糖・アシドーシス・電解質異常の経時変化",
      defaultParams: { initialTempSlider: 40, improvementSpeedSlider: 35, initialSpo2Slider: 70, severitySlider: 60 },
    },
    {
      key: "acs",
      name: "急性冠症候群（ACS）",
      description: "心筋逸脱酵素・循環動態の経時変化",
      defaultParams: { initialTempSlider: 45, improvementSpeedSlider: 50, initialSpo2Slider: 60, severitySlider: 60 },
    },
    {
      key: "pe",
      name: "肺血栓塞栓症（PE）",
      description: "Dダイマー・酸素化・循環動態の経時変化",
      defaultParams: { initialTempSlider: 45, improvementSpeedSlider: 40, initialSpo2Slider: 35, severitySlider: 60 },
    },
    {
      key: "asthma_copd",
      name: "気管支喘息発作・COPD増悪",
      description: "血液ガス・酸素化の経時変化",
      defaultParams: { initialTempSlider: 45, improvementSpeedSlider: 55, initialSpo2Slider: 40, severitySlider: 55 },
    },
    {
      key: "thyroid_storm",
      name: "甲状腺クリーゼ",
      description: "甲状腺ホルモン・頻脈・発熱の経時変化",
      defaultParams: { initialTempSlider: 85, improvementSpeedSlider: 35, initialSpo2Slider: 75, severitySlider: 65 },
    },
    {
      key: "gi_bleed",
      name: "消化管出血",
      description: "貧血進行・循環動態の経時変化",
      defaultParams: { initialTempSlider: 40, improvementSpeedSlider: 45, initialSpo2Slider: 80, severitySlider: 55 },
    },
    {
      key: "pancreatitis",
      name: "急性膵炎",
      description: "膵酵素・カルシウム・循環動態の経時変化",
      defaultParams: { initialTempSlider: 60, improvementSpeedSlider: 40, initialSpo2Slider: 65, severitySlider: 55 },
    },
    {
      key: "anaphylaxis",
      name: "アナフィラキシー",
      description: "急速な循環虚脱・酸素化低下と治療への速い反応",
      defaultParams: { initialTempSlider: 35, improvementSpeedSlider: 75, initialSpo2Slider: 35, severitySlider: 70 },
    },
    {
      key: "adrenal_crisis",
      name: "副腎クリーゼ（急性副腎不全）",
      description: "低血圧・電解質異常の経時変化",
      defaultParams: { initialTempSlider: 55, improvementSpeedSlider: 40, initialSpo2Slider: 75, severitySlider: 55 },
    },
    {
      key: "arrhythmia",
      name: "頻脈性不整脈",
      description: "電解質異常を背景とした頻脈・循環動態の経時変化",
      defaultParams: { initialTempSlider: 40, improvementSpeedSlider: 45, initialSpo2Slider: 70, severitySlider: 50 },
    },
    {
      key: "appendicitis",
      name: "急性虫垂炎",
      description: "薬物治療では改善せず、虫垂切除術のみが治療開始とみなされる外科的治療モデル",
      defaultParams: { initialTempSlider: 55, improvementSpeedSlider: 70, initialSpo2Slider: 25, severitySlider: 55 },
    },
  ];
  const templates: Record<string, { id: string }> = {};
  for (const t of templateDefs) {
    const rec = await db.diseaseTemplate.upsert({
      where: { key: t.key },
      update: {},
      create: {
        key: t.key,
        name: t.name,
        description: t.description,
        isCommon: true,
        defaultParams: JSON.stringify(t.defaultParams),
        isInfectious: "isInfectious" in t ? t.isInfectious : false,
      },
    });
    templates[t.key] = rec;
  }

  await db.basePhysiologyModel.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });

  // 年齢・性別ごとの基礎生理値（暫定値）。初回のみ投入し、以降は管理画面での編集を尊重して一切上書きしない
  // （countチェックで既存行があればスキップ。LabItemMasterの手動編集がmigrate dev再実行で巻き戻った事故を踏まえた対応）。
  // 値は教育用の目安（一般的な年齢別バイタル基準の概算）であり、医学監修は未実施。ユーザー側で今後調整予定。
  if ((await db.physiologyBaselineBand.count()) === 0) {
    await db.physiologyBaselineBand.createMany({
      data: [
        { label: "乳児(0歳)", minAge: 0, maxAge: 0, gender: "共通", temperature: 37.0, systolicBp: 80, diastolicBp: 50, pulse: 130, spo2: 98, respRate: 40, sortOrder: 0 },
        { label: "幼児(1-5歳)", minAge: 1, maxAge: 5, gender: "共通", temperature: 37.0, systolicBp: 95, diastolicBp: 60, pulse: 110, spo2: 98, respRate: 26, sortOrder: 1 },
        { label: "学童(6-12歳)", minAge: 6, maxAge: 12, gender: "共通", temperature: 36.8, systolicBp: 105, diastolicBp: 65, pulse: 90, spo2: 98, respRate: 20, sortOrder: 2 },
        { label: "思春期(13-17歳)", minAge: 13, maxAge: 17, gender: "共通", temperature: 36.7, systolicBp: 115, diastolicBp: 70, pulse: 80, spo2: 98, respRate: 16, sortOrder: 3 },
        { label: "成人男性(18-64歳)", minAge: 18, maxAge: 64, gender: "男性", temperature: 36.5, systolicBp: 122, diastolicBp: 76, pulse: 70, spo2: 98, respRate: 15, sortOrder: 4 },
        { label: "成人女性(18-64歳)", minAge: 18, maxAge: 64, gender: "女性", temperature: 36.6, systolicBp: 114, diastolicBp: 70, pulse: 76, spo2: 98, respRate: 16, sortOrder: 5 },
        { label: "高齢男性(65歳以上)", minAge: 65, maxAge: 120, gender: "男性", temperature: 36.2, systolicBp: 135, diastolicBp: 78, pulse: 68, spo2: 96, respRate: 17, sortOrder: 6 },
        { label: "高齢女性(65歳以上)", minAge: 65, maxAge: 120, gender: "女性", temperature: 36.3, systolicBp: 130, diastolicBp: 74, pulse: 72, spo2: 96, respRate: 18, sortOrder: 7 },
      ],
    });
  }

  async function ensureCase(input: {
    caseCode: string;
    title: string;
    caseType: "SIMULATION" | "ROUTINE_COMMON" | "ROUTINE_PATIENT";
    status: "DRAFT" | "ACTIVE" | "SIMULATING" | "CLOSED";
    timeProgressMode: "REALTIME" | "MANUAL";
    resultTiming: "IMMEDIATE" | "DELAYED";
    patientName: string;
    patientAge: number;
    patientGender: string;
    ward?: string;
    bed?: string;
    templateKey?: string;
    problems: string[];
  }) {
    const existing = await db.case.findUnique({ where: { caseCode: input.caseCode } });
    if (existing) return existing;

    const created = await db.case.create({
      data: {
        caseCode: input.caseCode,
        title: input.title,
        caseType: input.caseType,
        status: input.status,
        timeProgressMode: input.timeProgressMode,
        resultTiming: input.resultTiming,
        sharingMode: "TEAM",
        patientName: input.patientName,
        patientAge: input.patientAge,
        patientGender: input.patientGender,
        ward: input.ward,
        bed: input.bed,
        visibilityScope: "消化器内科ローテーション学生",
        createdByUserId: teacher1.id,
        publishedAt: input.status === "DRAFT" ? null : new Date(),
      },
    });

    if (input.templateKey && templates[input.templateKey]) {
      await db.caseDiseaseLink.create({
        data: {
          caseId: created.id,
          templateId: templates[input.templateKey].id,
          isPrimary: true,
          physiologyParams: JSON.stringify(templateDefs.find((t) => t.key === input.templateKey)!.defaultParams),
        },
      });
    }

    for (let i = 0; i < input.problems.length; i++) {
      await db.problem.create({
        data: { caseId: created.id, label: input.problems[i], isPrimary: i === 0, sortOrder: i },
      });
    }

    return created;
  }

  const caseP1042 = await ensureCase({
    caseCode: "P-1042",
    title: "市中肺炎（敗血症疑い）68歳男性",
    caseType: "ROUTINE_PATIENT",
    status: "ACTIVE",
    timeProgressMode: "REALTIME",
    resultTiming: "IMMEDIATE",
    patientName: "模擬 太郎",
    patientAge: 68,
    patientGender: "男性",
    ward: "3階東",
    bed: "312",
    templateKey: "infection",
    problems: ["市中肺炎", "疑い敗血症"],
  });

  const caseP1039 = await ensureCase({
    caseCode: "P-1039",
    title: "うっ血性心不全 急性増悪 74歳女性",
    caseType: "ROUTINE_PATIENT",
    status: "ACTIVE",
    timeProgressMode: "REALTIME",
    resultTiming: "IMMEDIATE",
    patientName: "模擬 花子",
    patientAge: 74,
    patientGender: "女性",
    ward: "3階東",
    bed: "308",
    templateKey: "heart_failure",
    problems: ["うっ血性心不全 急性増悪"],
  });

  const caseP1035 = await ensureCase({
    caseCode: "P-1035",
    title: "2型糖尿病 血糖コントロール 55歳男性",
    caseType: "ROUTINE_PATIENT",
    status: "ACTIVE",
    timeProgressMode: "REALTIME",
    resultTiming: "IMMEDIATE",
    patientName: "模擬 一郎",
    patientAge: 55,
    patientGender: "男性",
    ward: "3階西",
    bed: "322",
    problems: ["2型糖尿病 血糖コントロール"],
  });

  const caseP1028 = await ensureCase({
    caseCode: "P-1028",
    title: "脱水症・電解質異常 81歳女性",
    caseType: "ROUTINE_PATIENT",
    status: "ACTIVE",
    timeProgressMode: "REALTIME",
    resultTiming: "IMMEDIATE",
    patientName: "模擬 恵子",
    patientAge: 81,
    patientGender: "女性",
    ward: "3階西",
    bed: "315",
    templateKey: "dehydration",
    problems: ["脱水症", "電解質異常"],
  });

  const caseSim07 = await ensureCase({
    caseCode: "SIM-07",
    title: "急性虫垂炎 疑い（シミュレーション症例）",
    caseType: "SIMULATION",
    status: "SIMULATING",
    timeProgressMode: "MANUAL",
    resultTiming: "DELAYED",
    patientName: "（シミュレーション症例）急性腹症",
    patientAge: 42,
    patientGender: "女性",
    templateKey: "appendicitis",
    problems: ["急性虫垂炎 疑い"],
  });

  const caseP1051 = await ensureCase({
    caseCode: "P-1051",
    title: "脳梗塞疑い（クリニックより紹介搬送）72歳女性",
    caseType: "ROUTINE_PATIENT",
    status: "ACTIVE",
    timeProgressMode: "REALTIME",
    resultTiming: "IMMEDIATE",
    patientName: "模擬 悦子",
    patientAge: 72,
    patientGender: "女性",
    ward: "4階東",
    bed: "402",
    problems: ["脳梗塞疑い（心原性塞栓症疑い）", "発作性心房細動"],
  });

  await ensureCase({
    caseCode: "P-2001",
    title: "急性膵炎 60歳男性（症例プール）",
    caseType: "ROUTINE_COMMON",
    status: "ACTIVE",
    timeProgressMode: "REALTIME",
    resultTiming: "IMMEDIATE",
    patientName: "模擬 三郎",
    patientAge: 60,
    patientGender: "男性",
    ward: "3階東",
    bed: "301",
    problems: ["急性膵炎"],
  });

  for (const c of [caseP1042, caseP1039, caseP1035, caseP1028, caseSim07, caseP1051]) {
    await db.caseAssignment.upsert({
      where: { caseId_studentId: { caseId: c.id, studentId: student1.id } },
      update: {},
      create: { caseId: c.id, studentId: student1.id },
    });
  }

  const existingSoap = await db.karteEntry.findFirst({ where: { caseId: caseP1042.id } });
  if (!existingSoap) {
    await db.karteEntry.create({
      data: {
        caseId: caseP1042.id,
        authorUserId: student1.id,
        entryType: "SOAP",
        subjective: "発熱・咳嗽が3日前より持続。昨日より息切れを自覚。",
        objective: "体温38.9℃ SpO2 92%(室内気) 右下肺野にcoarse crackles",
        assessment: "",
        plan: "",
      },
    });
  }

  const existingOrders = await db.order.count({ where: { caseId: caseP1042.id } });
  if (existingOrders === 0) {
    const bloodCulture = await db.labItemMaster.findUnique({ where: { code: "MB-001" } });
    const ceftriaxone = await db.drugMaster.findUnique({ where: { hotCode: "HOT-100001" } });

    await db.order.create({
      data: {
        caseId: caseP1042.id,
        orderedByUserId: student1.id,
        orderType: "LAB",
        label: bloodCulture!.name,
        labItemId: bloodCulture!.id,
        status: "RESULT_PENDING",
        resultReadyAt: new Date(Date.now() + 20 * 60 * 1000),
      },
    });
    await db.order.create({
      data: {
        caseId: caseP1042.id,
        orderedByUserId: student1.id,
        orderType: "INJECTION",
        label: `${ceftriaxone!.name} 2g　点滴静注`,
        drugId: ceftriaxone!.id,
        status: "ADMINISTERED",
      },
    });
    await db.order.create({
      data: {
        caseId: caseP1042.id,
        orderedByUserId: student1.id,
        orderType: "GENERAL",
        label: "安静度：ベッド上安静",
        status: "ACTIVE",
      },
    });
  }

  const existingVitals = await db.vital.count({ where: { caseId: caseP1042.id } });
  if (existingVitals === 0) {
    const base = new Date();
    base.setHours(8, 0, 0, 0);
    const rows = [
      { h: 8, temperature: 38.9, systolicBp: 128, diastolicBp: 76, pulse: 104, spo2: 92, respRate: 24 },
      { h: 12, temperature: 38.2, systolicBp: 122, diastolicBp: 74, pulse: 96, spo2: 94, respRate: 22 },
      { h: 16, temperature: 37.5, systolicBp: 118, diastolicBp: 72, pulse: 88, spo2: 96, respRate: 20 },
    ];
    for (const r of rows) {
      const recordedAt = new Date(base);
      recordedAt.setHours(r.h);
      await db.vital.create({
        data: {
          caseId: caseP1042.id,
          recordedAt,
          temperature: r.temperature,
          systolicBp: r.systolicBp,
          diastolicBp: r.diastolicBp,
          pulse: r.pulse,
          spo2: r.spo2,
          respRate: r.respRate,
        },
      });
    }
  }

  // 模擬症例: 紹介状・救急搬送記録・SOAP記録を組み合わせた複数様式カルテのサンプル。
  const existingKarteP1051 = await db.karteEntry.count({ where: { caseId: caseP1051.id } });
  if (existingKarteP1051 === 0) {
    const day0 = new Date();
    day0.setHours(0, 0, 0, 0);

    const referralAt = new Date(day0);
    referralAt.setHours(9, 10);
    const ambulanceAt = new Date(day0);
    ambulanceAt.setHours(9, 45);
    const admissionSoapAt = new Date(day0);
    admissionSoapAt.setHours(10, 0);
    const followUpSoapAt = new Date(day0);
    followUpSoapAt.setDate(followUpSoapAt.getDate() + 1);
    followUpSoapAt.setHours(8, 30);

    const referralDetail: ReferralDetail = {
      destination: "○○大学病院 脳神経内科 御中",
      referringDoctor: "医療法人△△会　△△内科クリニック　院長　△△ △△",
      diagnosis: "脳梗塞疑い",
      purpose: "精査加療のお願い",
      presentIllness:
        "本日8時50分頃、自宅にて朝食中に右上下肢の脱力とろれつが回らないことに家族が気付き、直後に当院を受診されました。症状の急速な出現から脳血管障害が疑われ、緊急の精査加療が必要と判断し救急搬送にて紹介いたします。",
      pastHistory: "高血圧症、発作性心房細動（△△病院循環器内科通院中、ワルファリン内服中）",
      medications: "ワルファリンカリウム錠1mg　2錠　分1（夕食後）／アムロジピン錠5mg　1錠　分1（朝食後）",
      physicalFindings:
        "意識清明、血圧168/94mmHg、脈拍92/分（不整）、右上下肢の筋力低下（MMT 2/5程度）、構音障害あり、右顔面神経麻痺を認める。",
      testFindings: "当院にて頭部CT施行、明らかな出血性病変は認めず。心電図で心房細動を確認。",
      notes:
        "抗凝固薬（ワルファリン）内服中のため、血栓溶解療法の適応につきましては貴院にてご判断をお願いいたします。お薬手帳を持参させております。",
    };

    const ambulanceDetail: AmbulanceDetail = {
      agencyName: "○○市消防局　△△救急隊",
      callReceivedAt: "9時16分",
      sceneArrivalAt: "9時20分（△△内科クリニック）",
      hospitalArrivalAt: "9時45分（○○大学病院 救急外来）",
      chiefComplaint: "右上下肢脱力、構音障害",
      onsetSituation:
        "本日8時50分頃、自宅で朝食中に突然発症。家族が異変に気付き、徒歩3分のかかりつけクリニックを受診したところ脳卒中疑いのため救急要請となった。",
      consciousness: "JCS I-1（清明だが軽度の反応緩慢）",
      vitalsOnScene: "血圧172/96mmHg　脈拍96/分（不整）　SpO2 96%（室内気）　呼吸数18/分　体温36.4℃",
      pastHistory: "高血圧症、発作性心房細動（ワルファリン内服中）",
      treatmentEnRoute: "酸素投与（経鼻カニューラ2L/分）、心電図モニター装着、静脈路確保、血糖測定（128mg/dL）",
      receivingDepartment: "救急科・脳神経内科",
      notes: "紹介元クリニックより紹介状およびお薬手帳を預かり、患者とともに搬送。搬送中バイタル変化なし。",
    };

    await db.karteEntry.create({
      data: {
        caseId: caseP1051.id,
        authorUserId: teacher1.id,
        entryType: "REFERRAL",
        title: `${referralDetail.destination}　宛`,
        detail: JSON.stringify(referralDetail),
        createdAt: referralAt,
      },
    });

    await db.karteEntry.create({
      data: {
        caseId: caseP1051.id,
        authorUserId: teacher1.id,
        entryType: "AMBULANCE",
        title: ambulanceDetail.agencyName,
        detail: JSON.stringify(ambulanceDetail),
        createdAt: ambulanceAt,
      },
    });

    await db.karteEntry.create({
      data: {
        caseId: caseP1051.id,
        authorUserId: student1.id,
        entryType: "SOAP",
        subjective:
          "本人は軽度の呂律困難のため詳細な問診は困難。家族によれば8時50分頃に突然の右上下肢脱力とろれつが回らない症状が出現とのこと。頭痛・嘔気は認めない。",
        objective:
          "意識清明、血圧166/92mmHg、脈拍94/分（不整）、SpO2 97%（室内気）。右上下肢MMT 2/5、右顔面神経麻痺あり、構音障害あり。NIHSS 9点。頭部CTにて明らかな出血性病変なし。心電図で心房細動確認。",
        assessment: "心原性脳塞栓症疑い（発作性心房細動、抗凝固薬内服中）。発症から搬入まで約55分。",
        plan: "頭部MRI/MRAを施行し血栓溶解療法・血管内治療の適応を検討。脳神経内科にコンサルト。抗凝固薬内服歴を踏まえ出血リスクを慎重に評価。",
        createdAt: admissionSoapAt,
      },
    });

    await db.karteEntry.create({
      data: {
        caseId: caseP1051.id,
        authorUserId: student1.id,
        entryType: "SOAP",
        subjective: "呂律障害はやや改善したと本人より訴えあり。右上肢の動かしにくさは持続。",
        objective:
          "体温36.8℃、血圧142/84mmHg、脈拍88/分（不整）。右上肢MMT 3/5に改善、右下肢MMT 4/5。NIHSS 5点に改善。頭部MRIにて左中大脳動脈領域に急性期梗塞巣を確認。",
        assessment: "心原性脳塞栓症（左MCA領域）。症状はやや改善傾向。",
        plan: "リハビリテーション科に依頼し早期離床・嚥下評価を開始。抗凝固療法の再開時期を脳神経内科・循環器内科と相談。",
        createdAt: followUpSoapAt,
      },
    });
  }

  const existingVitalsP1051 = await db.vital.count({ where: { caseId: caseP1051.id } });
  if (existingVitalsP1051 === 0) {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const rows = [
      { h: 9, m: 45, temperature: 36.6, systolicBp: 168, diastolicBp: 92, pulse: 94, spo2: 97, respRate: 20 },
      { h: 14, m: 0, temperature: 37.0, systolicBp: 150, diastolicBp: 86, pulse: 90, spo2: 97, respRate: 18 },
      { h: 20, m: 0, temperature: 36.9, systolicBp: 144, diastolicBp: 84, pulse: 88, spo2: 98, respRate: 18 },
    ];
    for (const r of rows) {
      const recordedAt = new Date(base);
      recordedAt.setHours(r.h, r.m);
      await db.vital.create({
        data: {
          caseId: caseP1051.id,
          recordedAt,
          temperature: r.temperature,
          systolicBp: r.systolicBp,
          diastolicBp: r.diastolicBp,
          pulse: r.pulse,
          spo2: r.spo2,
          respRate: r.respRate,
        },
      });
    }
  }

  console.log("Seed data ready.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
