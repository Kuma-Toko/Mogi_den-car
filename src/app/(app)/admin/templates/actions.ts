"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { DEFAULT_PHYSIOLOGY_PARAMS } from "@/lib/physiology";
import { VITAL_FIELDS } from "@/lib/vital-fields";

function readParams(formData: FormData) {
  return {
    ...DEFAULT_PHYSIOLOGY_PARAMS,
    initialTempSlider: Number(formData.get("initialTempSlider") ?? 50),
    improvementSpeedSlider: Number(formData.get("improvementSpeedSlider") ?? 50),
    initialSpo2Slider: Number(formData.get("initialSpo2Slider") ?? 50),
    severitySlider: Number(formData.get("severitySlider") ?? 50),
  };
}

export async function createTemplate(formData: FormData) {
  const user = await requireAdmin();

  const key = String(formData.get("key") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const isCommon = formData.get("isCommon") === "on";
  if (!key || !name) return;

  const existing = await db.diseaseTemplate.findUnique({ where: { key } });
  if (existing) {
    redirect("/admin/templates?error=duplicate_key");
  }

  const created = await db.diseaseTemplate.create({
    data: { key, name, description, isCommon, defaultParams: JSON.stringify(readParams(formData)) },
  });
  await logAudit({ userId: user.id, action: "master_template_create", targetType: "DiseaseTemplate", targetId: created.id });

  revalidatePath("/admin/templates");
}

export async function updateTemplate(id: string, formData: FormData) {
  const user = await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const isCommon = formData.get("isCommon") === "on";
  if (!name) return;

  await db.diseaseTemplate.update({
    where: { id },
    data: { name, description, isCommon, defaultParams: JSON.stringify(readParams(formData)) },
  });
  await logAudit({ userId: user.id, action: "master_template_update", targetType: "DiseaseTemplate", targetId: id });

  revalidatePath("/admin/templates");
}

export async function deleteTemplate(id: string) {
  const user = await requireAdmin();

  // 症例がこのテンプレートをアタッチ中（CaseDiseaseLink経由）なら削除できないよう事前に確認する
  // （外部キーはON DELETE RESTRICTのため、確認なしでも例外にはなるが、事前にエラーメッセージで案内する）。
  const usageCount = await db.caseDiseaseLink.count({ where: { templateId: id } });
  if (usageCount > 0) {
    redirect("/admin/templates?error=in_use");
  }

  await db.diseaseTemplate.delete({ where: { id } });
  await logAudit({ userId: user.id, action: "master_template_delete", targetType: "DiseaseTemplate", targetId: id });
  revalidatePath("/admin/templates");
  redirect("/admin/templates");
}

// ── 病態エンジン設定（治療開始条件・バイタル係数） ──────────────────────────────

function readVitalPoint(formData: FormData, prefix: string) {
  const point: Record<string, number> = {};
  for (const f of VITAL_FIELDS) {
    point[f.key] = Number(formData.get(`${prefix}_${f.key}`) ?? 0);
  }
  return point;
}

function splitList(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function updateTemplateEngineConfig(id: string, formData: FormData) {
  const user = await requireAdmin();

  const treatment = {
    drugCategories: splitList(formData.get("drugCategories")),
    procedureKeywords: splitList(formData.get("procedureKeywords")),
  };
  // baseは持たない（基礎生理モデルが一元管理する）。テンプレートは重症度100あたりの増減量のみを持つ。
  const vitals = {
    perSeverity: readVitalPoint(formData, "perSeverity"),
  };

  await db.diseaseTemplate.update({
    where: { id },
    data: { treatmentConfig: JSON.stringify(treatment), vitalsConfig: JSON.stringify(vitals) },
  });
  await logAudit({ userId: user.id, action: "master_template_engine_config_update", targetType: "DiseaseTemplate", targetId: id });

  revalidatePath("/admin/templates");
}

// ── 基礎生理モデル（BasePhysiologyModel、症例・疾患非依存のシングルトン） ────────────────

export async function updateBasePhysiologyModel(formData: FormData) {
  const user = await requireAdmin();

  const point = readVitalPoint(formData, "base");
  await db.basePhysiologyModel.upsert({
    where: { id: "default" },
    update: point,
    create: { id: "default", ...point },
  });
  await logAudit({ userId: user.id, action: "master_base_physiology_update", targetType: "BasePhysiologyModel", targetId: "default" });

  revalidatePath("/admin/templates");
}

// ── AI治療評価ルーブリック ────────────────────────────────────────────────

export async function updateAiEvaluationGuideline(id: string, formData: FormData) {
  const user = await requireAdmin();

  const aiEvaluationGuideline = String(formData.get("aiEvaluationGuideline") ?? "").trim() || null;

  await db.diseaseTemplate.update({ where: { id }, data: { aiEvaluationGuideline } });
  await logAudit({ userId: user.id, action: "master_ai_evaluation_guideline_update", targetType: "DiseaseTemplate", targetId: id });

  revalidatePath("/admin/templates");
}

// ── 検査所見パターン（labPatterns） ──────────────────────────────────────────

export async function createLabPattern(templateId: string, formData: FormData) {
  const user = await requireAdmin();

  const labItemCode = String(formData.get("labItemCode") ?? "").trim();
  const kind = formData.get("kind") === "values" ? "values" : "text";
  if (!labItemCode) return;

  const existing = await db.templateLabPattern.findUnique({
    where: { templateId_labItemCode: { templateId, labItemCode } },
  });
  if (existing) return; // 同一テンプレート内でのコード重複は黙って無視する

  const maxSort = await db.templateLabPattern.aggregate({ where: { templateId }, _max: { sortOrder: true } });
  const created = await db.templateLabPattern.create({
    data: {
      templateId,
      labItemCode,
      kind,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
    },
  });
  await logAudit({ userId: user.id, action: "master_lab_pattern_create", targetType: "TemplateLabPattern", targetId: created.id });

  revalidatePath("/admin/templates");
}

export async function updateLabPatternText(id: string, formData: FormData) {
  const user = await requireAdmin();

  const labItemCode = String(formData.get("labItemCode") ?? "").trim();
  if (!labItemCode) return;

  await db.templateLabPattern.update({
    where: { id },
    data: {
      labItemCode,
      mildText: String(formData.get("mildText") ?? ""),
      moderateText: String(formData.get("moderateText") ?? ""),
      severeText: String(formData.get("severeText") ?? ""),
    },
  });
  await logAudit({ userId: user.id, action: "master_lab_pattern_update", targetType: "TemplateLabPattern", targetId: id });

  revalidatePath("/admin/templates");
}

export async function updateLabPatternCode(id: string, formData: FormData) {
  const user = await requireAdmin();

  const labItemCode = String(formData.get("labItemCode") ?? "").trim();
  if (!labItemCode) return;

  await db.templateLabPattern.update({ where: { id }, data: { labItemCode } });
  await logAudit({ userId: user.id, action: "master_lab_pattern_update", targetType: "TemplateLabPattern", targetId: id });

  revalidatePath("/admin/templates");
}

export async function deleteLabPattern(id: string) {
  const user = await requireAdmin();
  await db.templateLabPattern.delete({ where: { id } });
  await logAudit({ userId: user.id, action: "master_lab_pattern_delete", targetType: "TemplateLabPattern", targetId: id });

  revalidatePath("/admin/templates");
}

type Tier = "mild" | "moderate" | "severe";

export async function addLabPatternValue(patternId: string, tier: Tier, formData: FormData) {
  const user = await requireAdmin();

  const label = String(formData.get("label") ?? "").trim();
  const value = Number(formData.get("value") ?? NaN);
  const unit = String(formData.get("unit") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!label || !Number.isFinite(value)) return;

  const maxSort = await db.templateLabPatternValue.aggregate({
    where: { patternId, tier },
    _max: { sortOrder: true },
  });
  const created = await db.templateLabPatternValue.create({
    data: { patternId, tier, label, value, unit, note, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 },
  });
  await logAudit({ userId: user.id, action: "master_lab_pattern_value_create", targetType: "TemplateLabPatternValue", targetId: created.id });

  revalidatePath("/admin/templates");
}

export async function updateLabPatternValue(id: string, formData: FormData) {
  const user = await requireAdmin();

  const label = String(formData.get("label") ?? "").trim();
  const value = Number(formData.get("value") ?? NaN);
  const unit = String(formData.get("unit") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!label || !Number.isFinite(value)) return;

  await db.templateLabPatternValue.update({ where: { id }, data: { label, value, unit, note } });
  await logAudit({ userId: user.id, action: "master_lab_pattern_value_update", targetType: "TemplateLabPatternValue", targetId: id });

  revalidatePath("/admin/templates");
}

export async function deleteLabPatternValue(id: string) {
  const user = await requireAdmin();
  await db.templateLabPatternValue.delete({ where: { id } });
  await logAudit({ userId: user.id, action: "master_lab_pattern_value_delete", targetType: "TemplateLabPatternValue", targetId: id });

  revalidatePath("/admin/templates");
}

// ── 急変シナリオ（crisis） ──────────────────────────────────────────────────

function readCrisisScenarioFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    sustainMinutes: Math.max(0, Math.round(Number(formData.get("sustainMinutes") ?? 0))),
    windowMinutes: Math.max(1, Math.round(Number(formData.get("windowMinutes") ?? 480))),
    postRescueSeverity: Math.min(100, Math.max(0, Math.round(Number(formData.get("postRescueSeverity") ?? 50)))),
    crisisVitals: JSON.stringify(readVitalPoint(formData, "crisisVitals")),
  };
}

export async function createCrisisScenario(templateId: string, formData: FormData) {
  const user = await requireAdmin();

  const fields = readCrisisScenarioFields(formData);
  if (!fields.name) return;

  const existing = await db.templateCrisisScenario.findUnique({ where: { templateId } });
  if (existing) return; // 1テンプレート1シナリオ

  const created = await db.templateCrisisScenario.create({ data: { templateId, ...fields } });
  await logAudit({ userId: user.id, action: "master_crisis_scenario_create", targetType: "TemplateCrisisScenario", targetId: created.id });

  revalidatePath("/admin/templates");
}

export async function updateCrisisScenario(id: string, formData: FormData) {
  const user = await requireAdmin();

  const fields = readCrisisScenarioFields(formData);
  if (!fields.name) return;

  await db.templateCrisisScenario.update({ where: { id }, data: fields });
  await logAudit({ userId: user.id, action: "master_crisis_scenario_update", targetType: "TemplateCrisisScenario", targetId: id });

  revalidatePath("/admin/templates");
}

export async function deleteCrisisScenario(id: string) {
  const user = await requireAdmin();
  await db.templateCrisisScenario.delete({ where: { id } });
  await logAudit({ userId: user.id, action: "master_crisis_scenario_delete", targetType: "TemplateCrisisScenario", targetId: id });

  revalidatePath("/admin/templates");
}

const TRIGGER_TYPES = ["severity", "lab", "vital"] as const;
const OPS = [">=", "<="] as const;
const VITAL_FIELD_KEYS = VITAL_FIELDS.map((f) => f.key);

function readTriggerFields(formData: FormData) {
  const typeRaw = String(formData.get("type") ?? "");
  const type = (TRIGGER_TYPES as readonly string[]).includes(typeRaw) ? typeRaw : "severity";
  const opRaw = String(formData.get("op") ?? "");
  const op = (OPS as readonly string[]).includes(opRaw) ? opRaw : ">=";
  const value = Number(formData.get("value") ?? NaN);
  const code = String(formData.get("code") ?? "").trim() || null;
  const label = String(formData.get("label") ?? "").trim() || null;
  const fieldRaw = String(formData.get("field") ?? "");
  const field = (VITAL_FIELD_KEYS as readonly string[]).includes(fieldRaw) ? fieldRaw : null;
  return { type, op, value, code: type === "lab" ? code : null, label: type === "lab" ? label : null, field: type === "vital" ? field : null };
}

export async function addCrisisTrigger(scenarioId: string, formData: FormData) {
  const user = await requireAdmin();

  const fields = readTriggerFields(formData);
  if (!Number.isFinite(fields.value)) return;
  if (fields.type === "lab" && !fields.code) return;
  if (fields.type === "vital" && !fields.field) return;

  const maxSort = await db.crisisTriggerRow.aggregate({ where: { scenarioId }, _max: { sortOrder: true } });
  const created = await db.crisisTriggerRow.create({
    data: { scenarioId, ...fields, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 },
  });
  await logAudit({ userId: user.id, action: "master_crisis_trigger_create", targetType: "CrisisTriggerRow", targetId: created.id });

  revalidatePath("/admin/templates");
}

export async function updateCrisisTrigger(id: string, formData: FormData) {
  const user = await requireAdmin();

  const fields = readTriggerFields(formData);
  if (!Number.isFinite(fields.value)) return;
  if (fields.type === "lab" && !fields.code) return;
  if (fields.type === "vital" && !fields.field) return;

  await db.crisisTriggerRow.update({ where: { id }, data: fields });
  await logAudit({ userId: user.id, action: "master_crisis_trigger_update", targetType: "CrisisTriggerRow", targetId: id });

  revalidatePath("/admin/templates");
}

export async function deleteCrisisTrigger(id: string) {
  const user = await requireAdmin();
  await db.crisisTriggerRow.delete({ where: { id } });
  await logAudit({ userId: user.id, action: "master_crisis_trigger_delete", targetType: "CrisisTriggerRow", targetId: id });

  revalidatePath("/admin/templates");
}

function readRescueActionFields(formData: FormData) {
  return {
    label: String(formData.get("label") ?? "").trim(),
    drugCategories: JSON.stringify(splitList(formData.get("drugCategories"))),
    procedureKeywords: JSON.stringify(splitList(formData.get("procedureKeywords"))),
  };
}

export async function addCrisisRescueAction(scenarioId: string, formData: FormData) {
  const user = await requireAdmin();

  const fields = readRescueActionFields(formData);
  if (!fields.label) return;

  const maxSort = await db.crisisRescueActionRow.aggregate({ where: { scenarioId }, _max: { sortOrder: true } });
  const created = await db.crisisRescueActionRow.create({
    data: { scenarioId, ...fields, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 },
  });
  await logAudit({ userId: user.id, action: "master_crisis_rescue_action_create", targetType: "CrisisRescueActionRow", targetId: created.id });

  revalidatePath("/admin/templates");
}

export async function updateCrisisRescueAction(id: string, formData: FormData) {
  const user = await requireAdmin();

  const fields = readRescueActionFields(formData);
  if (!fields.label) return;

  await db.crisisRescueActionRow.update({ where: { id }, data: fields });
  await logAudit({ userId: user.id, action: "master_crisis_rescue_action_update", targetType: "CrisisRescueActionRow", targetId: id });

  revalidatePath("/admin/templates");
}

export async function deleteCrisisRescueAction(id: string) {
  const user = await requireAdmin();
  await db.crisisRescueActionRow.delete({ where: { id } });
  await logAudit({ userId: user.id, action: "master_crisis_rescue_action_delete", targetType: "CrisisRescueActionRow", targetId: id });

  revalidatePath("/admin/templates");
}
