"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { VITAL_FIELDS } from "@/lib/vital-fields";

const VITAL_FIELD_KEYS = VITAL_FIELDS.map((f) => f.key);

function readRuleFields(formData: FormData) {
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  const targetType = formData.get("targetType") === "vital" ? "vital" : "lab";
  const targetRaw = String(formData.get("target") ?? "").trim();
  const target = targetType === "vital" && !(VITAL_FIELD_KEYS as readonly string[]).includes(targetRaw) ? "" : targetRaw;
  const shiftValueRaw = String(formData.get("shiftValue") ?? "").trim();
  const shiftValue = shiftValueRaw === "" ? null : Number(shiftValueRaw);
  const effectText = String(formData.get("effectText") ?? "").trim() || null;
  const onsetDelayHours = Math.max(0, Number(formData.get("onsetDelayHours") ?? 0) || 0);
  const note = String(formData.get("note") ?? "").trim() || null;
  return { categoryId, targetType, target, shiftValue, effectText, onsetDelayHours, note };
}

export async function createDrugEffectRule(formData: FormData) {
  const user = await requireAdmin();

  const fields = readRuleFields(formData);
  if (!fields.categoryId || !fields.target) return;
  if (fields.shiftValue !== null && !Number.isFinite(fields.shiftValue)) return;

  const category = await db.drugCategoryMaster.findUnique({ where: { id: fields.categoryId } });
  if (!category) return;

  const existing = await db.drugEffectRule.findUnique({
    where: { categoryId_targetType_target: { categoryId: fields.categoryId, targetType: fields.targetType, target: fields.target } },
  });
  if (existing) return; // 同一カテゴリ・同一対象の重複ルールは黙って無視する（既存行を編集してもらう想定）

  const maxSort = await db.drugEffectRule.aggregate({ where: { categoryId: fields.categoryId }, _max: { sortOrder: true } });
  const created = await db.drugEffectRule.create({
    data: { ...fields, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 },
  });
  await logAudit({ userId: user.id, action: "master_drug_effect_rule_create", targetType: "DrugEffectRule", targetId: created.id });

  revalidatePath("/admin/drug-effects");
}

export async function updateDrugEffectRule(id: string, formData: FormData) {
  const user = await requireAdmin();

  const fields = readRuleFields(formData);
  if (!fields.target) return;
  if (fields.shiftValue !== null && !Number.isFinite(fields.shiftValue)) return;

  await db.drugEffectRule.update({
    where: { id },
    data: {
      targetType: fields.targetType,
      target: fields.target,
      shiftValue: fields.shiftValue,
      effectText: fields.effectText,
      onsetDelayHours: fields.onsetDelayHours,
      note: fields.note,
    },
  });
  await logAudit({ userId: user.id, action: "master_drug_effect_rule_update", targetType: "DrugEffectRule", targetId: id });

  revalidatePath("/admin/drug-effects");
}

export async function deleteDrugEffectRule(id: string) {
  const user = await requireAdmin();
  await db.drugEffectRule.delete({ where: { id } });
  await logAudit({ userId: user.id, action: "master_drug_effect_rule_delete", targetType: "DrugEffectRule", targetId: id });

  revalidatePath("/admin/drug-effects");
}
