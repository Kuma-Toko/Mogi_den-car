import { db } from "@/lib/db";
import { formatJaDateTimeShort } from "@/lib/format";
import { ConfirmButton } from "@/components/ConfirmButton";
import type { Role } from "@prisma/client";
import { dischargeCase, readmitCase } from "../actions";
import { dischargeAssignment, readmitAssignment } from "./actions";

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

  const assignments = await db.caseAssignment.findMany({
    where: { caseId },
    include: { student: true },
    orderBy: { assignedAt: "asc" },
  });

  const rows = isManager ? assignments : assignments.filter((a) => a.studentId === currentUserId);

  return (
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
                      <span className="badge">退院済み</span>
                    ) : (
                      <span className="badge teal">担当中</span>
                    )}
                  </td>
                  <td>{a.dischargedAt ? formatJaDateTimeShort(a.dischargedAt) : "—"}</td>
                  <td>
                    {a.dischargedAt ? (
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
  );
}
