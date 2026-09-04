"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const SUSCEPTIBILITY_LEVELS = ["S", "I", "R"] as const;

function readPathogenFields(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    gramStain: String(formData.get("gramStain") ?? "").trim() || null,
    note: String(formData.get("note") ?? "").trim() || null,
  };
}

export async function createPathogen(formData: FormData) {
  const user = await requireAdmin();
  const fields = readPathogenFields(formData);
  if (!fields.name) return;

  const maxSort = await db.pathogenMaster.aggregate({ _max: { sortOrder: true } });
  const created = await db.pathogenMaster.create({
    data: { ...fields, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 },
  });
  await logAudit({ userId: user.id, action: "master_pathogen_create", targetType: "PathogenMaster", targetId: created.id });

  revalidatePath("/admin/pathogens");
}

export async function updatePathogen(id: string, formData: FormData) {
  const user = await requireAdmin();
  const fields = readPathogenFields(formData);
  if (!fields.name) return;

  await db.pathogenMaster.update({ where: { id }, data: fields });
  await logAudit({ userId: user.id, action: "master_pathogen_update", targetType: "PathogenMaster", targetId: id });

  revalidatePath("/admin/pathogens");
}

export async function deletePathogen(id: string) {
  const user = await requireAdmin();

  await db.pathogenMaster.delete({ where: { id } });
  await logAudit({ userId: user.id, action: "master_pathogen_delete", targetType: "PathogenMaster", targetId: id });

  revalidatePath("/admin/pathogens");
}

// ── 感受性（PathogenSusceptibility。原因菌×抗菌薬系統ごとに最大1件） ──────────────

export async function addSusceptibility(pathogenId: string, formData: FormData) {
  const user = await requireAdmin();

  const categoryId = String(formData.get("categoryId") ?? "").trim();
  const susceptibilityRaw = String(formData.get("susceptibility") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!categoryId || !SUSCEPTIBILITY_LEVELS.includes(susceptibilityRaw as (typeof SUSCEPTIBILITY_LEVELS)[number])) return;

  const existing = await db.pathogenSusceptibility.findUnique({
    where: { pathogenId_categoryId: { pathogenId, categoryId } },
  });
  if (existing) return; // 同一(菌,系統)の重複は黙って無視する。既存行は下の更新フォームから編集する

  const created = await db.pathogenSusceptibility.create({
    data: { pathogenId, categoryId, susceptibility: susceptibilityRaw, note },
  });
  await logAudit({ userId: user.id, action: "master_pathogen_susceptibility_create", targetType: "PathogenSusceptibility", targetId: created.id });

  revalidatePath("/admin/pathogens");
}

export async function updateSusceptibility(id: string, formData: FormData) {
  const user = await requireAdmin();

  const susceptibilityRaw = String(formData.get("susceptibility") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!SUSCEPTIBILITY_LEVELS.includes(susceptibilityRaw as (typeof SUSCEPTIBILITY_LEVELS)[number])) return;

  await db.pathogenSusceptibility.update({ where: { id }, data: { susceptibility: susceptibilityRaw, note } });
  await logAudit({ userId: user.id, action: "master_pathogen_susceptibility_update", targetType: "PathogenSusceptibility", targetId: id });

  revalidatePath("/admin/pathogens");
}

export async function deleteSusceptibility(id: string) {
  const user = await requireAdmin();
  await db.pathogenSusceptibility.delete({ where: { id } });
  await logAudit({ userId: user.id, action: "master_pathogen_susceptibility_delete", targetType: "PathogenSusceptibility", targetId: id });

  revalidatePath("/admin/pathogens");
}
