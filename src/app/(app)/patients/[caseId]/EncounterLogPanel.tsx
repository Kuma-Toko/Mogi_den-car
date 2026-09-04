import { formatJaDateTimeShort } from "@/lib/format";
import { loadEncounterLog } from "@/lib/encounter-log";

const ROLE_LABEL = { STUDENT: "学生", PATIENT: "患者", SYSTEM: "システム" } as const;
const ROLE_CLASS = { STUDENT: "student", PATIENT: "patient", SYSTEM: "system" } as const;

// カルテ記載中に参照できる、問診・身体診察AIチャットの読み取り専用ログ（スクロール表示）。
export async function EncounterLogPanel({ caseId }: { caseId: string }) {
  const messages = await loadEncounterLog(caseId);

  return (
    <div className="card">
      <div className="card-h">問診・診察ログ（参照用）</div>
      <div className="card-b">
        {messages.length === 0 ? (
          <div className="empty-note">まだ記録がありません。「問診・診察」タブから開始してください。</div>
        ) : (
          <div className="chat-log chat-log-compact">
            {messages.map((m) => (
              <div key={m.id} className={`chat-msg ${ROLE_CLASS[m.role]}`}>
                <div className="chat-bubble">
                  <div className="chat-meta">
                    {ROLE_LABEL[m.role]}　{formatJaDateTimeShort(new Date(m.createdAt))}
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
