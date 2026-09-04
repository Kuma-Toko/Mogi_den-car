import { db } from "@/lib/db";
import type { EncounterRole, Vital } from "@prisma/client";

export type EncounterLogItem = {
  id: string;
  role: EncounterRole | "SYSTEM";
  content: string;
  createdAt: string;
};

function formatInitialVitalMessage(vital: Vital): EncounterLogItem {
  const content = `【初期バイタル】体温${vital.temperature}℃　血圧${vital.systolicBp}/${vital.diastolicBp}　脈拍${vital.pulse}/分　SpO2 ${vital.spo2}%　呼吸数${vital.respRate}/分`;
  return { id: `initial-vital-${vital.id}`, role: "SYSTEM", content, createdAt: vital.recordedAt.toISOString() };
}

// 問診・身体診察チャット（EncounterChat）とカルテ記載タブの参照用ログ（EncounterLogPanel）が
// 共通で使う会話ログ。DB上のEncounterMessage（学生発言・AI患者応答）の先頭に、症例開始時点の
// 初期バイタルをSYSTEMメッセージとして合成して差し込む（DBには保存しない。バイタルは常に
// db.vitalから再構成できるため、EncounterMessageテーブル自体は変更しない）。
export async function loadEncounterLog(caseId: string): Promise<EncounterLogItem[]> {
  const [messages, initialVital] = await Promise.all([
    db.encounterMessage.findMany({ where: { caseId }, orderBy: { createdAt: "asc" } }),
    db.vital.findFirst({ where: { caseId }, orderBy: { recordedAt: "asc" } }),
  ]);

  const items: EncounterLogItem[] = messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));

  if (initialVital) items.unshift(formatInitialVitalMessage(initialVital));
  return items;
}
