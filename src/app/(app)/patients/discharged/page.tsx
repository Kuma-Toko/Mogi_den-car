import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime, formatJaDateTimeShort } from "@/lib/format";
import { readmitCase } from "../actions";

export default async function DischargedPatientsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const assignments = await db.caseAssignment.findMany({
    where: { studentId: user.id, dischargedAt: { not: null } },
    include: {
      case: { include: { problems: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 1 } } },
    },
    orderBy: { dischargedAt: "desc" },
  });

  return (
    <>
      <div className="topbar">
        <h1>退院済み患者</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <div className="card">
          <div className="card-h">
            退院済み患者
            <Link href="/patients" className="btn ghost" style={{ fontSize: 11 }}>
              ← 担当患者一覧へ戻る
            </Link>
          </div>
          <div className="card-b" style={{ padding: 0 }}>
            {assignments.length === 0 ? (
              <div className="empty-note">退院済みの患者はいません。</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>患者ID</th>
                    <th>氏名（模擬）</th>
                    <th>年齢/性別</th>
                    <th>主なプロブレム</th>
                    <th>退院日時</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => (
                    <tr className="row" key={a.id}>
                      <td>
                        <Link href={`/patients/${a.case.id}`}>{a.case.caseCode}</Link>
                      </td>
                      <td>
                        <Link href={`/patients/${a.case.id}`}>{a.case.patientName}</Link>
                      </td>
                      <td>
                        {a.case.patientAge}歳/{a.case.patientGender}
                      </td>
                      <td>{a.case.problems[0]?.label ?? "—"}</td>
                      <td>{a.dischargedAt ? formatJaDateTimeShort(a.dischargedAt) : "—"}</td>
                      <td>
                        <form action={readmitCase.bind(null, a.case.id)}>
                          <button type="submit" className="btn ghost" style={{ fontSize: 11 }}>
                            再入院とする
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
