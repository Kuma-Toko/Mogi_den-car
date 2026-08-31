import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import bcrypt from "bcryptjs";

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
    await db.drugMaster.upsert({ where: { hotCode: d.hotCode }, update: d, create: d });
  }

  const labItems = [
    {
      code: "LAB-001",
      name: "血液一般（CBC）",
      category: "検体・生理検査",
      subcategory: "血算",
      sampleResult: null,
      sampleValues: JSON.stringify([
        { label: "WBC", value: 14200, unit: "/μL", note: "好中球優位" },
        { label: "Hb", value: 13.1, unit: "g/dL" },
        { label: "Plt", value: 21.4, unit: "万/μL" },
      ]),
    },
    {
      code: "LAB-002",
      name: "生化学一般",
      category: "検体・生理検査",
      subcategory: "生化学",
      sampleResult: null,
      sampleValues: JSON.stringify([
        { label: "AST", value: 28, unit: "U/L" },
        { label: "ALT", value: 22, unit: "U/L" },
        { label: "Cr", value: 0.9, unit: "mg/dL" },
        { label: "Na", value: 138, unit: "mEq/L" },
        { label: "K", value: 4.1, unit: "mEq/L" },
      ]),
    },
    {
      code: "LAB-003",
      name: "CRP",
      category: "検体・生理検査",
      subcategory: "免疫",
      sampleResult: null,
      sampleValues: JSON.stringify([{ label: "CRP", value: 8.9, unit: "mg/dL" }]),
    },
    {
      code: "LAB-004",
      name: "血液培養（2セット）",
      category: "検体・生理検査",
      subcategory: "微生物",
      sampleResult: "グラム陽性球菌を少数検出（同定検査中）",
      sampleValues: null,
    },
    {
      code: "LAB-005",
      name: "胸部X線",
      category: "画像検査",
      subcategory: "単純写真",
      sampleResult: "右下肺野に浸潤影を認める",
      sampleValues: null,
    },
    {
      code: "LAB-006",
      name: "BNP",
      category: "検体・生理検査",
      subcategory: "免疫",
      sampleResult: null,
      sampleValues: JSON.stringify([{ label: "BNP", value: 620, unit: "pg/mL" }]),
    },
    {
      code: "LAB-007",
      name: "腹部エコー",
      category: "画像検査",
      subcategory: "超音波",
      sampleResult: "右下腹部に腫大した虫垂様構造を認める",
      sampleValues: null,
    },
    {
      code: "LAB-008",
      name: "腹部CT",
      category: "画像検査",
      subcategory: "CT",
      sampleResult: "肝・胆・膵・脾・腎に明らかな異常を指摘できない。",
      sampleValues: null,
    },
    {
      code: "LAB-009",
      name: "頭部MRI",
      category: "画像検査",
      subcategory: "MRI",
      sampleResult: "明らかな急性期病変を指摘できない。",
      sampleValues: null,
    },
  ];
  for (const l of labItems) {
    await db.labItemMaster.upsert({ where: { code: l.code }, update: l, create: l });
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
      },
    });
    templates[t.key] = rec;
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
        diseaseTemplateId: input.templateKey ? templates[input.templateKey]?.id : undefined,
        physiologyParams: input.templateKey ? JSON.stringify(templateDefs.find((t) => t.key === input.templateKey)!.defaultParams) : undefined,
        imagingPattern: "moderate",
        createdByUserId: teacher1.id,
        publishedAt: input.status === "DRAFT" ? null : new Date(),
      },
    });

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
    templateKey: "infection",
    problems: ["急性虫垂炎 疑い"],
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

  for (const c of [caseP1042, caseP1039, caseP1035, caseP1028, caseSim07]) {
    await db.caseAssignment.upsert({
      where: { caseId_studentId: { caseId: c.id, studentId: student1.id } },
      update: {},
      create: { caseId: c.id, studentId: student1.id },
    });
  }

  const existingSoap = await db.soapNote.findFirst({ where: { caseId: caseP1042.id } });
  if (!existingSoap) {
    await db.soapNote.create({
      data: {
        caseId: caseP1042.id,
        authorUserId: student1.id,
        subjective: "発熱・咳嗽が3日前より持続。昨日より息切れを自覚。",
        objective: "体温38.9℃ SpO2 92%(室内気) 右下肺野にcoarse crackles",
        assessment: "",
        plan: "",
      },
    });
  }

  const existingOrders = await db.order.count({ where: { caseId: caseP1042.id } });
  if (existingOrders === 0) {
    const bloodCulture = await db.labItemMaster.findUnique({ where: { code: "LAB-004" } });
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
