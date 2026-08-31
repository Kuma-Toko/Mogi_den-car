import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { caseTypeLabel } from "@/lib/labels";
import { formatJaDateTime } from "@/lib/format";
import { joinCase } from "./actions";

export default async function CasePoolPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const availableCases = await db.case.findMany({
    where: {
      status: { in: ["ACTIVE", "SIMULATING"] },
      caseType: { in: ["ROUTINE_COMMON", "SIMULATION"] },
      assignments: { none: { studentId: user.id } },
    },
    include: { problems: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 1 } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <div className="topbar">
        <h1>症例プール</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <div className="card">
          <div className="card-h">
            参加可能な症例
            <Link href="/patients" className="btn ghost" style={{ fontSize: 11 }}>
              ← 担当患者一覧へ戻る
            </Link>
          </div>
          <div className="card-b" style={{ padding: 0 }}>
            {availableCases.length === 0 ? (
              <div className="empty-note">現在参加可能な症例はありません。</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>患者ID</th>
                    <th>症例名</th>
                    <th>区分</th>
                    <th>年齢/性別</th>
                    <th>主なプロブレム</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {availableCases.map((c) => (
                    <tr className="row" key={c.id}>
                      <td>{c.caseCode}</td>
                      <td>{c.title}</td>
                      <td>{caseTypeLabel[c.caseType]}</td>
                      <td>
                        {c.patientAge}歳/{c.patientGender}
                      </td>
                      <td>{c.problems[0]?.label ?? "—"}</td>
                      <td>
                        <form action={joinCase.bind(null, c.id)}>
                          <button type="submit" className="btn primary">
                            担当に追加
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
