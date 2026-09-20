import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import type { Case, CaseType, CrisisMode } from "@prisma/client";
import type { PhysiologyParams } from "@/lib/physiology";
import { caseTypeSchema, clampPatientAge, clampSlider0to100, patientGenderSchema } from "@/lib/schemas";

// 症例作成・編集フォーム（CaseForm、症例テンプレート作成・編集フォームも含む）で共有する読み取り・
// 検証ロジック。Server Actionファイル（"use server"）はexportする関数を全てasyncにする必要があるため、
// 非asyncなヘルパーはこの素のモジュールへ切り出し、症例／症例テンプレート双方のactions.tsから読み込む。

export const CRISIS_MODES: CrisisMode[] = ["OFF", "REVERSIBLE", "LETHAL"];

// prefix-digits形式（P-1042, SIM-07, TPL-0031等）の症例コードをcount個、重複なくまとめて払い出す。
// 既存コードをまとめて1回読み込み、未使用の最小連番から順に割り当てる。指定桁数の枠（10^digits通り）を
// 使い切ったら桁を1つ増やして続行する（従来のgenerateCaseCodeはSIMULATIONが2桁ランダム=100枠しかなく、
// テンプレートからの一括生成のような数十件単位の採番では現実的な確率で衝突していた）。
export async function allocateCaseCodes(prefix: string, digits: number, count: number): Promise<string[]> {
  if (count <= 0) return [];

  const existing = await db.case.findMany({
    where: { caseCode: { startsWith: `${prefix}-` } },
    select: { caseCode: true },
  });
  const used = new Set<number>();
  for (const { caseCode } of existing) {
    const suffix = caseCode.slice(prefix.length + 1);
    if (/^\d+$/.test(suffix)) used.add(Number(suffix));
  }

  const codes: string[] = [];
  let currentDigits = digits;
  let next = 0;
  while (codes.length < count) {
    const capacity = 10 ** currentDigits;
    while (next < capacity && used.has(next)) next++;
    if (next >= capacity) {
      currentDigits++;
      next = 0;
      continue;
    }
    const code = `${prefix}-${String(next).padStart(currentDigits, "0")}`;
    codes.push(code);
    used.add(next);
    next++;
  }
  return codes;
}

export function caseCodePrefixFor(caseType: CaseType): { prefix: string; digits: number } {
  return caseType === "SIMULATION" ? { prefix: "SIM", digits: 2 } : { prefix: "P", digits: 4 };
}

export async function generateCaseCode(caseType: CaseType): Promise<string> {
  const { prefix, digits } = caseCodePrefixFor(caseType);
  const [code] = await allocateCaseCodes(prefix, digits, 1);
  return code;
}

export function timeProgressModeFor(caseType: CaseType) {
  return caseType === "SIMULATION" ? "MANUAL" : "REALTIME";
}

// 症例作成・編集フォームの共通フィールドをパースする。症例テンプレートの作成・編集フォームも同じ
// フィールド構成（担当学生欄を除く）を使うため共有する。
export function readCaseFields(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  // Prisma/SQLiteのenumはCHECK制約を生成しないため、whitelist無しにキャストすると任意の文字列が
  // 永続化されうる（後続のRecord<CaseType, …>系ラベル参照が全てundefinedになる）。
  const caseTypeParsed = caseTypeSchema.safeParse(formData.get("caseType"));
  const caseType: CaseType = caseTypeParsed.success ? caseTypeParsed.data : "SIMULATION";
  const patientName = String(formData.get("patientName") ?? "").trim();
  // NaN・負数・小数・異常値が生理モデルの年齢帯マッチングへそのまま渡ると意図しない基準値が選ばれるため、
  // 0〜120歳の整数へクランプする（"Number(x) || 0"だとNaNが黙って0歳＝乳児帯になっていた）。
  const patientAge = clampPatientAge(Number(formData.get("patientAge")));
  const patientGenderParsed = patientGenderSchema.safeParse(String(formData.get("patientGender") ?? ""));
  const patientGender = patientGenderParsed.success ? patientGenderParsed.data : "男性";
  const ward = String(formData.get("ward") ?? "").trim() || null;
  const bed = String(formData.get("bed") ?? "").trim() || null;
  const visibilityScope = String(formData.get("visibilityScope") ?? "").trim() || null;
  const historyScript = String(formData.get("historyScript") ?? "").trim() || null;
  const examScript = String(formData.get("examScript") ?? "").trim() || null;
  const problemsRaw = String(formData.get("problems") ?? "");
  const diseaseTemplateIds = formData
    .getAll("diseaseTemplateIds")
    .map((v) => String(v))
    .filter(Boolean);
  const primaryTemplateIdRaw = String(formData.get("primaryTemplateId") ?? "") || null;
  const primaryTemplateId =
    primaryTemplateIdRaw && diseaseTemplateIds.includes(primaryTemplateIdRaw) ? primaryTemplateIdRaw : (diseaseTemplateIds[0] ?? null);
  const resultTiming = String(formData.get("resultTiming") ?? "IMMEDIATE");
  const crisisModeRaw = String(formData.get("crisisMode") ?? "LETHAL");
  const crisisMode = CRISIS_MODES.includes(crisisModeRaw as CrisisMode) ? (crisisModeRaw as CrisisMode) : "LETHAL";
  const sharingMode = String(formData.get("sharingMode") ?? "SOLO");
  const assigneeLoginIds = String(formData.get("assigneeLoginIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const problemLabels = problemsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const physiologyParamsByTemplate: Record<string, PhysiologyParams> = {};
  const pathogenIdByTemplate: Record<string, string | null> = {};
  const relevantSpecimenSitesByTemplate: Record<string, string[] | null> = {};
  for (const templateId of diseaseTemplateIds) {
    // "Number(x) ?? 50"は非数値文字列に対してNaNを返す（??はnullish coalescingでNaNを素通りさせる）ため、
    // JSON.stringify(NaN)がnullになって重症度カーブ全体がNaN化しうる。0〜100へ必ず数値クランプする。
    physiologyParamsByTemplate[templateId] = {
      initialTempSlider: clampSlider0to100(Number(formData.get(`tpl_${templateId}_initialTempSlider`))),
      improvementSpeedSlider: clampSlider0to100(Number(formData.get(`tpl_${templateId}_improvementSpeedSlider`))),
      initialSpo2Slider: clampSlider0to100(Number(formData.get(`tpl_${templateId}_initialSpo2Slider`))),
      severitySlider: clampSlider0to100(Number(formData.get(`tpl_${templateId}_severitySlider`))),
    };
    pathogenIdByTemplate[templateId] = String(formData.get(`tpl_${templateId}_pathogenId`) ?? "").trim() || null;
    // 検体部位制限: チェックボックスがONのときだけ配列（空配列もありうる）、OFFならnull（=制限なし、既存挙動）。
    const specimenSiteRestricted = formData.get(`tpl_${templateId}_specimenSiteRestricted`) != null;
    relevantSpecimenSitesByTemplate[templateId] = specimenSiteRestricted
      ? formData.getAll(`tpl_${templateId}_relevantSpecimenSites`).map((v) => String(v))
      : null;
  }

  return {
    title,
    caseType,
    patientName,
    patientAge,
    patientGender,
    ward,
    bed,
    visibilityScope,
    historyScript,
    examScript,
    problemLabels,
    diseaseTemplateIds,
    primaryTemplateId,
    resultTiming,
    crisisMode,
    sharingMode,
    assigneeLoginIds,
    physiologyParamsByTemplate,
    pathogenIdByTemplate,
    relevantSpecimenSitesByTemplate,
  };
}

// 教員は自分が作成した症例（テンプレートも含む）のみ、管理者は全症例を編集・削除できる。
export async function requireOwnedCase(
  caseId: string
): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; caseRecord: Case }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "STUDENT") redirect("/patients");

  const caseRecord = await db.case.findUnique({ where: { id: caseId } });
  if (!caseRecord) redirect("/teacher/cases");
  if (user.role === "TEACHER" && caseRecord.createdByUserId !== user.id) redirect("/teacher/cases");

  return { user, caseRecord };
}
