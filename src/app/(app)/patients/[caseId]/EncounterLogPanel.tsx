import { db } from "@/lib/db";
import { formatJaDateTimeShort } from "@/lib/format";

// カルテ記載中に参照できる、問診・身体診察AIチャットの読み取り専用ログ（スクロール表示）。
export async function EncounterLogPanel({ caseId }: { caseId: string }) {
  const messages = await db.encounterMessage.findMany({
    where: { caseId },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="card">
      <div className="card-h">問診・診察ログ（参照用）</div>
      <div className="card-b">
        {messages.length === 0 ? (
          <div className="empty-note">まだ記録がありません。「問診・診察」タブから開始してください。</div>
        ) : (
          <div className="chat-log chat-log-compact">
            {messages.map((m) => (
              <div key={m.id} className={`chat-msg ${m.role === "STUDENT" ? "student" : "patient"}`}>
                <div className="chat-bubble">
                  <div className="chat-meta">
                    {m.role === "STUDENT" ? "学生" : "患者"}　{formatJaDateTimeShort(m.createdAt)}
                  </div>
                  {m.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
