"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

function readFields(formData: FormData) {
  return {
    code: String(formData.get("code") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    category: String(formData.get("category") ?? "").trim(),
    subcategory: String(formData.get("subcategory") ?? "").trim() || null,
    unit: String(formData.get("unit") ?? "").trim() || null,
    sampleResult: String(formData.get("sampleResult") ?? "").trim() || null,
    isCulture: formData.get("isCulture") === "on",
  };
}

export async function createLabItem(formData: FormData) {
  const user = await requireAdmin();
  const fields = readFields(formData);
  if (!fields.code || !fields.name || !fields.category) return;

  const created = await db.labItemMaster.create({ data: fields });
  await logAudit({ userId: user.id, action: "master_lab_item_create", targetType: "LabItemMaster", targetId: created.id });

  revalidatePath("/admin/lab-items");
}

export async function updateLabItem(id: string, formData: FormData) {
  const user = await requireAdmin();
  const fields = readFields(formData);
  if (!fields.code || !fields.name || !fields.category) return;

  await db.labItemMaster.update({ where: { id }, data: fields });
  await logAudit({ userId: user.id, action: "master_lab_item_update", targetType: "LabItemMaster", targetId: id });

  revalidatePath("/admin/lab-items");
}

export async function deleteLabItem(id: string) {
  const user = await requireAdmin();

  // 外部キーはON DELETE SET NULLのため、削除自体はチェックなしでも例外を投げない。
  // 既存オーダーの検査項目参照が黙ってNULLになるのを防ぐため、事前に使用状況を確認する。
  const usageCount = await db.order.count({ where: { labItemId: id } });
  if (usageCount > 0) {
    redirect("/admin/lab-items?error=in_use");
  }

  await db.labItemMaster.delete({ where: { id } });
  await logAudit({ userId: user.id, action: "master_lab_item_delete", targetType: "LabItemMaster", targetId: id });
  revalidatePath("/admin/lab-items");
  redirect("/admin/lab-items");
}
