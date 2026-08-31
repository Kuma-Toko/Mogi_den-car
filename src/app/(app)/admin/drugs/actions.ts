"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { normalizeDrugName } from "@/lib/drugName";

function readFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  return {
    hotCode: String(formData.get("hotCode") ?? "").trim(),
    name,
    normalizedName: normalizeDrugName(name),
    category: String(formData.get("category") ?? "").trim() || null,
    defaultDose: String(formData.get("defaultDose") ?? "").trim() || null,
    unit: String(formData.get("unit") ?? "").trim() || null,
    route: String(formData.get("route") ?? "").trim() || null,
    isInjectable: formData.get("isInjectable") === "on",
  };
}

export async function createDrug(formData: FormData) {
  const user = await requireAdmin();
  const fields = readFields(formData);
  if (!fields.hotCode || !fields.name) return;

  const created = await db.drugMaster.create({ data: fields });
  await logAudit({ userId: user.id, action: "master_drug_create", targetType: "DrugMaster", targetId: created.id });

  revalidatePath("/admin/drugs");
}

export async function updateDrug(id: string, formData: FormData) {
  const user = await requireAdmin();
  const fields = readFields(formData);
  if (!fields.hotCode || !fields.name) return;

  await db.drugMaster.update({ where: { id }, data: fields });
  await logAudit({ userId: user.id, action: "master_drug_update", targetType: "DrugMaster", targetId: id });

  revalidatePath("/admin/drugs");
}

export async function addDrugAlias(drugMasterId: string, formData: FormData) {
  const user = await requireAdmin();
  const aliasText = String(formData.get("aliasText") ?? "").trim();
  if (!aliasText) return;

  const existing = await db.drugAlias.findUnique({
    where: { drugMasterId_aliasText: { drugMasterId, aliasText } },
  });
  if (existing) return; // 同一薬剤への同一別名の重複登録は黙って無視する

  const created = await db.drugAlias.create({
    data: { drugMasterId, aliasText, normalizedText: normalizeDrugName(aliasText) },
  });
  await logAudit({ userId: user.id, action: "drug_alias_create", targetType: "DrugAlias", targetId: created.id });

  revalidatePath("/admin/drugs");
}

export async function deleteDrugAlias(id: string) {
  const user = await requireAdmin();
  await db.drugAlias.delete({ where: { id } });
  await logAudit({ userId: user.id, action: "drug_alias_delete", targetType: "DrugAlias", targetId: id });

  revalidatePath("/admin/drugs");
}

export async function deleteDrug(id: string) {
  const user = await requireAdmin();

  // 外部キーはON DELETE SET NULLのため、削除自体はチェックなしでも例外を投げない。
  // 既存オーダーの薬剤参照が黙ってNULLになってしまう（治療判定が壊れる）のを防ぐため、事前に使用状況を確認する。
  const usageCount = await db.order.count({ where: { drugId: id } });
  if (usageCount > 0) {
    redirect("/admin/drugs?error=in_use");
  }

  await db.drugMaster.delete({ where: { id } });
  await logAudit({ userId: user.id, action: "master_drug_delete", targetType: "DrugMaster", targetId: id });
  revalidatePath("/admin/drugs");
  redirect("/admin/drugs");
}
