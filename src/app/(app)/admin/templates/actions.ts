"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { DEFAULT_PHYSIOLOGY_PARAMS } from "@/lib/physiology";

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

  // 外部キーはON DELETE SET NULLのため、削除自体はチェックなしでも例外を投げない。
  // 症例のテンプレート参照が黙ってNULLになる（その症例の動的エンジンが無効化される）のを防ぐため、事前に確認する。
  const usageCount = await db.case.count({ where: { diseaseTemplateId: id } });
  if (usageCount > 0) {
    redirect("/admin/templates?error=in_use");
  }

  await db.diseaseTemplate.delete({ where: { id } });
  await logAudit({ userId: user.id, action: "master_template_delete", targetType: "DiseaseTemplate", targetId: id });
  revalidatePath("/admin/templates");
  redirect("/admin/templates");
}
