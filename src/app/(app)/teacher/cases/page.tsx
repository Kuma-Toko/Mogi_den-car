import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { caseTypeLabel } from "@/lib/labels";
import { formatJaDateTime, formatJaDateTimeShort } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "下書き",
  ACTIVE: "公開中",
  SIMULATING: "演習中",
  CLOSED: "終了",
};
const STATUS_BADGE: Record<string, string> = {
  DRAFT: "amber",
  ACTIVE: "teal",
  SIMULATING: "blue",
  CLOSED: "red",
};

export default async function TeacherCasesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "STUDENT") redirect("/patients");

  const cases = await db.case.findMany({
    where: user.role === "ADMIN" ? {} : { createdByUserId: user.id },
    include: { assignments: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <div className="topbar">
        <h1>症例一覧</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <div className="card">
          <div className="card-h">
            作成した症例
            <Link href="/teacher/cases/new" className="btn primary" style={{ fontSize: 11 }}>
              ＋ 新規症例作成
            </Link>
          </div>
          <div className="card-b" style={{ padding: 0 }}>
            {cases.length === 0 ? (
              <div className="empty-note">作成した症例はまだありません。「新規症例作成」から作成してください。</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>患者ID</th>
                    <th>症例名</th>
                    <th>区分</th>
                    <th>状態</th>
                    <th>担当学生数</th>
                    <th>作成日</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr className="row" key={c.id}>
                      <td>
                        <Link href={`/patients/${c.id}`}>{c.caseCode}</Link>
                      </td>
                      <td>
                        <Link href={`/patients/${c.id}`}>{c.title}</Link>
                      </td>
                      <td>{caseTypeLabel[c.caseType]}</td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                      </td>
                      <td>{c.assignments.length}</td>
                      <td>{formatJaDateTimeShort(c.createdAt)}</td>
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
