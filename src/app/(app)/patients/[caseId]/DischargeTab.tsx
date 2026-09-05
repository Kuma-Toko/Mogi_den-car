import { db } from "@/lib/db";
import { formatJaDateTimeShort } from "@/lib/format";
import { ConfirmButton } from "@/components/ConfirmButton";
import type { Role } from "@prisma/client";
import { dischargeCase, readmitCase } from "../actions";
import { dischargeAssignment, readmitAssignment, regenerateDischargeFeedback } from "./actions";

type DischargeFeedback = { summary: string; strengths: string[]; improvements: string[] };

function parseDischargeFeedback(raw: string | null): DischargeFeedback | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DischargeFeedback>;
    if (typeof parsed.summary !== "string") return null;
    return {
      summary: parsed.summary,
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.filter((s): s is string => typeof s === "string") : [],
      improvements: Array.isArray(parsed.improvements) ? parsed.improvements.filter((s): s is string => typeof s === "string") : [],
    };
  } catch {
    return null;
  }
}

export async function DischargeTab({
  caseId,
  currentUserId,
  currentUserRole,
}: {
  caseId: string;
  currentUserId: string;
  currentUserRole: Role;
}) {
  const isManager = currentUserRole !== "STUDENT";

  const [assignments, caseRecord] = await Promise.all([
    db.caseAssignment.findMany({
      where: { caseId },
      include: { student: true },
      orderBy: { assignedAt: "asc" },
    }),
    db.case.findUnique({ where: { id: caseId }, select: { crisisState: true } }),
  ]);
  const isDeceased = caseRecord?.crisisState === "DECEASED";

  const rows = isManager ? assignments : assignments.filter((a) => a.studentId === currentUserId);
  const dischargedRows = rows.filter((a) => a.dischargedAt);

  return (
    <>
    <div className="card">
      <div className="card-h">退院・再入院</div>
      <div className="card-b" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div className="empty-note">
            {isManager ? "この症例に担当学生は割り当てられていません。" : "この症例の担当割り当てが見つかりません。"}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                {isManager && <th>担当学生</th>}
                <th>状態</th>
                <th>退院日時</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr className="row" key={a.id}>
                  {isManager && <td>{a.student.name}</td>}
                  <td>
                    {a.dischargedAt ? (
                      <span className={isDeceased ? "badge red" : "badge"}>{isDeceased ? "死亡（症例終了）" : "退院済み"}</span>
                    ) : (
                      <span className="badge teal">担当中</span>
                    )}
                  </td>
                  <td>{a.dischargedAt ? formatJaDateTimeShort(a.dischargedAt) : "—"}</td>
                  <td>
                    {a.dischargedAt ? (
                      isDeceased ? null : (
                        <form
                          action={
                            isManager
                              ? readmitAssignment.bind(null, caseId, a.studentId)
                              : readmitCase.bind(null, caseId)
                          }
                        >
                          <button type="submit" className="btn ghost" style={{ fontSize: 11 }}>
                            再入院とする
                          </button>
                        </form>
                      )
                    ) : (
                      <form>
                        <ConfirmButton
                          formAction={
                            isManager
                              ? dischargeAssignment.bind(null, caseId, a.studentId)
                              : dischargeCase.bind(null, caseId)
                          }
                          confirmText={`${a.student.name}を退院させますか？`}
                          className="btn ghost"
                          actionLabel="退院させる"
                          actionClassName="btn primary"
                        >
                          退院
                        </ConfirmButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>

    {dischargedRows.map((a) => {
      const feedback = parseDischargeFeedback(a.dischargeFeedback);
      return (
        <div className="card" key={`feedback-${a.id}`}>
          <div className="card-h">
            AIによる包括的フィードバック{isManager ? `（${a.student.name}）` : ""}
          </div>
          <div className="card-b">
            {feedback ? (
              <div style={{ fontSize: 12.5 }}>
                <p style={{ marginBottom: 10, whiteSpace: "pre-wrap" }}>{feedback.summary}</p>
                {feedback.strengths.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>良かった点</div>
                    <ul style={{ paddingLeft: 18, margin: 0 }}>
                      {feedback.strengths.map((s, i) => (
                        <li key={i} style={{ marginBottom: 4 }}>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {feedback.improvements.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>改善点</div>
                    <ul style={{ paddingLeft: 18, margin: 0 }}>
                      {feedback.improvements.map((s, i) => (
                        <li key={i} style={{ marginBottom: 4 }}>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {a.dischargeFeedbackAt && (
                  <div style={{ marginTop: 10, fontSize: 11, color: "var(--ink-soft)" }}>
                    生成日時: {formatJaDateTimeShort(a.dischargeFeedbackAt)}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="empty-note">
                  {a.dischargeFeedbackError
                    ? `フィードバックの生成に失敗しました：${a.dischargeFeedbackError}`
                    : "フィードバックはまだ生成されていません。"}
                </div>
                <form style={{ marginTop: 8 }}>
                  <button
                    type="submit"
                    formAction={regenerateDischargeFeedback.bind(null, caseId, a.studentId)}
                    className="btn ghost"
                  >
                    {a.dischargeFeedbackError ? "再生成する" : "生成する"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      );
    })}
    </>
  );
}
