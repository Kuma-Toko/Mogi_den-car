import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import type { AmbulanceDetail, ReferralDetail } from "../src/app/(app)/patients/[caseId]/actions";

// 病態モデル再構築（pathology-catalog）に伴う、模擬患者のデモ症例（主要数件）を投入する。
// `npm run db:reset-pathology -- --confirm` → `npm run db:apply-engine-config` の後に実行する想定。
// student1/teacher1（prisma/seed.tsで作成済み）が既に存在することを前提とする。
// 何度実行しても安全（caseCodeの存在チェックでスキップする）。

const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });
const db = new PrismaClient({ adapter });

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
  historyScript?: string;
  examScript?: string;
  templateKey: string;
  pathogenName?: string;
  problems: string[];
  teacherId: string;
}) {
  const existing = await db.case.findUnique({ where: { caseCode: input.caseCode } });
  if (existing) return existing;

  const template = await db.diseaseTemplate.findUnique({ where: { key: input.templateKey } });
  if (!template) throw new Error(`DiseaseTemplate(key=${input.templateKey})が見つかりません。先にdb:apply-engine-configを実行してください。`);

  const pathogen = input.pathogenName ? await db.pathogenMaster.findUnique({ where: { name: input.pathogenName } }) : null;

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
      historyScript: input.historyScript,
      examScript: input.examScript,
      visibilityScope: "消化器内科ローテーション学生",
      createdByUserId: input.teacherId,
      publishedAt: input.status === "DRAFT" ? null : new Date(),
    },
  });

  await db.caseDiseaseLink.create({
    data: {
      caseId: created.id,
      templateId: template.id,
      isPrimary: true,
      physiologyParams: template.defaultParams,
      pathogenId: pathogen?.id,
    },
  });

  for (let i = 0; i < input.problems.length; i++) {
    await db.problem.create({ data: { caseId: created.id, label: input.problems[i], isPrimary: i === 0, sortOrder: i } });
  }

  return created;
}

async function main() {
  const student1 = await db.user.findUniqueOrThrow({ where: { loginId: "student1" } });
  const teacher1 = await db.user.findUniqueOrThrow({ where: { loginId: "teacher1" } });

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
    historyScript:
      "3日前から38℃台の発熱と咳嗽が持続。昨日より息切れを自覚し様子を見ていたが改善なく受診。既往に高血圧・2型糖尿病。喫煙歴30本/日×40年（現喫煙）。アレルギーなし。同居家族に同様の症状はない。",
    examScript: "体温38.9℃、右下肺野にcoarse cracklesを聴取。呼吸音の左右差あり。腹部は平坦・軟、圧痛なし。下腿浮腫なし。意識清明。",
    templateKey: "resp_cap",
    pathogenName: "肺炎球菌 (Streptococcus pneumoniae)",
    problems: ["市中肺炎", "疑い敗血症"],
    teacherId: teacher1.id,
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
    historyScript:
      "慢性心不全（駆出率低下型）で通院中。2日前から息切れと下腿浮腫が増悪し、昨夜から夜間臥床時の呼吸困難（起座呼吸）で受診。塩分の多い食事を数日続けていたとのこと。既往に陳旧性心筋梗塞、高血圧。",
    examScript: "血圧158/92mmHg、脈拍98/分、SpO2 91%（室内気）。両側肺野でfine cracklesを聴取。頸静脈怒張あり、下腿に圧痕性浮腫。",
    templateKey: "cv_acute_hf",
    problems: ["うっ血性心不全 急性増悪"],
    teacherId: teacher1.id,
  });

  const caseDka = await ensureCase({
    caseCode: "SIM-DKA",
    title: "糖尿病性ケトアシドーシス疑い（シミュレーション症例）",
    caseType: "SIMULATION",
    status: "SIMULATING",
    timeProgressMode: "MANUAL",
    resultTiming: "DELAYED",
    patientName: "（シミュレーション症例）1型糖尿病 急性増悪",
    patientAge: 24,
    patientGender: "女性",
    historyScript:
      "1型糖尿病で通院中だが、体調不良でここ2日間インスリン注射を自己中断していた。悪心・嘔吐と口渇が強く、様子を見ていたが意識がぼんやりしてきたため家族に連れられて受診。",
    examScript: "意識やや傾眠。深く速い呼吸（Kussmaul呼吸）を認める。呼気にアセトン臭。皮膚ツルゴール低下、口腔粘膜乾燥。腹部は平坦・軟、圧痛なし。",
    templateKey: "endo_dka",
    problems: ["糖尿病性ケトアシドーシス（DKA）疑い"],
    teacherId: teacher1.id,
  });

  const caseMi = await ensureCase({
    caseCode: "SIM-MI",
    title: "急性心筋梗塞疑い（シミュレーション症例）",
    caseType: "SIMULATION",
    status: "SIMULATING",
    timeProgressMode: "MANUAL",
    resultTiming: "DELAYED",
    patientName: "（シミュレーション症例）急性冠症候群疑い",
    patientAge: 58,
    patientGender: "男性",
    historyScript:
      "30分前から突然の前胸部絞扼感が出現し持続。冷汗を伴う。以前にも労作時の胸部不快感があったが放置していた。既往に脂質異常症、喫煙歴20本/日×35年。家族歴に父が心筋梗塞（55歳）。",
    examScript: "冷汗著明、苦悶様表情。血圧138/86mmHg、脈拍96/分。心音整、明らかな心雑音なし。肺野清。下腿浮腫なし。未治療で放置すると心原性ショック・心室細動に進展しうる想定。",
    templateKey: "cv_stemi",
    problems: ["急性冠症候群（ST上昇型心筋梗塞）疑い"],
    teacherId: teacher1.id,
  });

  const caseP2001 = await ensureCase({
    caseCode: "P-2001",
    title: "上部消化管出血 60歳男性（症例プール）",
    caseType: "ROUTINE_COMMON",
    status: "ACTIVE",
    timeProgressMode: "REALTIME",
    resultTiming: "IMMEDIATE",
    patientName: "模擬 三郎",
    patientAge: 60,
    patientGender: "男性",
    ward: "3階東",
    bed: "301",
    historyScript: "本日朝からタール便を複数回認め、めまいを自覚し受診。数日前から心窩部痛があり市販の鎮痛薬（NSAIDs）を内服していた。飲酒歴あり（機会飲酒）。",
    examScript: "血圧104/68mmHg、脈拍106/分。眼瞼結膜蒼白。腹部は平坦・軟、心窩部に軽度圧痛。直腸診でタール便付着を確認。",
    templateKey: "gi_upper_gi_bleed",
    problems: ["上部消化管出血（消化性潰瘍疑い）"],
    teacherId: teacher1.id,
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
    historyScript:
      "本日8時50分頃、自宅にて朝食中に右上下肢の脱力とろれつが回らないことに家族が気付き、直後にかかりつけクリニックを受診、救急搬送された。既往に高血圧症、発作性心房細動（ワルファリン内服中）。",
    examScript: "意識清明、血圧166/92mmHg、脈拍94/分（不整）。右上下肢MMT 2/5、右顔面神経麻痺あり、構音障害あり。NIHSS 9点。頭部CTにて明らかな出血性病変なし。心電図で心房細動確認。",
    templateKey: "neuro_cardioembolic_stroke",
    problems: ["脳梗塞疑い（心原性塞栓症疑い）", "発作性心房細動"],
    teacherId: teacher1.id,
  });

  for (const c of [caseP1042, caseP1039, caseDka, caseMi, caseP2001, caseP1051]) {
    await db.caseAssignment.upsert({
      where: { caseId_studentId: { caseId: c.id, studentId: student1.id } },
      update: {},
      create: { caseId: c.id, studentId: student1.id },
    });
  }

  // ── P-1042: SOAP記録・オーダー・バイタル推移のサンプル ──
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

    if (bloodCulture) {
      await db.order.create({
        data: {
          caseId: caseP1042.id,
          orderedByUserId: student1.id,
          orderType: "LAB",
          label: bloodCulture.name,
          labItemId: bloodCulture.id,
          status: "RESULT_PENDING",
          resultReadyAt: new Date(Date.now() + 20 * 60 * 1000),
        },
      });
    }
    if (ceftriaxone) {
      await db.order.create({
        data: {
          caseId: caseP1042.id,
          orderedByUserId: student1.id,
          orderType: "INJECTION",
          label: `${ceftriaxone.name} 2g　点滴静注`,
          drugId: ceftriaxone.id,
          status: "ADMINISTERED",
        },
      });
    }
    await db.order.create({
      data: { caseId: caseP1042.id, orderedByUserId: student1.id, orderType: "GENERAL", label: "安静度：ベッド上安静", status: "ACTIVE" },
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
    for (const { h, ...vitals } of rows) {
      const recordedAt = new Date(base);
      recordedAt.setHours(h);
      await db.vital.create({ data: { caseId: caseP1042.id, recordedAt, ...vitals } });
    }
  }

  // ── P-1051: 紹介状・救急搬送記録・SOAP記録を組み合わせた複数様式カルテのサンプル ──
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
      treatmentEnRoute: "酸素投与（経鼻カニューレ2L/分）、心電図モニター装着、静脈路確保、血糖測定（128mg/dL）",
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
    for (const { h, m, ...vitals } of rows) {
      const recordedAt = new Date(base);
      recordedAt.setHours(h, m);
      await db.vital.create({ data: { caseId: caseP1051.id, recordedAt, ...vitals } });
    }
  }

  console.log("Demo cases ready.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
