"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireCaseAccess } from "@/lib/case-access";
import { generatePatientReply } from "@/lib/gemini";
import { logAudit } from "@/lib/audit";
import { loadEncounterLog, type EncounterLogItem } from "@/lib/encounter-log";

export type EncounterMessageView = EncounterLogItem;

export async function getEncounterMessages(caseId: string): Promise<EncounterMessageView[]> {
  await requireCaseAccess(caseId);
  return loadEncounterLog(caseId);
}

// 学生の発言をAI（模擬患者役）に送り、応答を1往復分DBへ保存して最新の会話ログを返す。
export async function sendEncounterMessage(caseId: string, content: string): Promise<EncounterMessageView[]> {
  const { user, case: caseRecord } = await requireCaseAccess(caseId);
  const trimmed = content.trim();
  if (!trimmed) return getEncounterMessages(caseId);

  await db.encounterMessage.create({
    data: { caseId, authorUserId: user.id, role: "STUDENT", content: trimmed },
  });

  const [history, problems, latestVital] = await Promise.all([
    db.encounterMessage.findMany({ where: { caseId }, orderBy: { createdAt: "asc" } }),
    db.problem.findMany({ where: { caseId } }),
    db.vital.findFirst({ where: { caseId }, orderBy: { recordedAt: "desc" } }),
  ]);

  let reply: string;
  try {
    reply = await generatePatientReply({
      caseRecord,
      problems,
      latestVital,
      history: history.map((m) => ({ role: m.role, content: m.content })),
    });
  } catch (err) {
    reply = `（AI応答の取得に失敗しました: ${err instanceof Error ? err.message : "不明なエラー"}）`;
  }

  await db.encounterMessage.create({
    data: { caseId, authorUserId: user.id, role: "PATIENT", content: reply },
  });

  await logAudit({
    userId: user.id,
    action: "encounter_message",
    targetType: "Case",
    targetId: caseId,
    detail: { length: trimmed.length },
  });

  revalidatePath(`/patients/${caseId}`);
  return getEncounterMessages(caseId);
}
