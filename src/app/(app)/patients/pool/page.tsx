import Link from "next/link";
import { redirect } from "next/navigation";
import type { CaseStatus, CaseType } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { caseTypeLabel } from "@/lib/labels";
import { formatJaDateTime } from "@/lib/format";
import { joinCase } from "./actions";

const PAGE_SIZE = 20;

export default async function CasePoolPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { q, page: pageParam } = await searchParams;
  const query = q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const baseWhere = {
    status: { in: ["ACTIVE", "SIMULATING"] as CaseStatus[] },
    caseType: { in: ["ROUTINE_COMMON", "SIMULATION"] as CaseType[] },
    assignments: { none: { studentId: user.id } },
  };
  const where = query
    ? {
        ...baseWhere,
        OR: [{ caseCode: { contains: query } }, { title: { contains: query } }, { patientName: { contains: query } }],
      }
    : baseWhere;

  const [totalCount, availableCases] = await Promise.all([
    db.case.count({ where }),
    db.case.findMany({
      where,
      include: { problems: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 1 } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <>
      <div className="topbar">
        <h1>症例プール</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <div className="card">
          <div className="card-h">
            参加可能な症例（全{totalCount.toLocaleString()}件中{availableCases.length.toLocaleString()}件を表示）
            <Link href="/patients" className="btn ghost" style={{ fontSize: 11 }}>
              ← 担当患者一覧へ戻る
            </Link>
          </div>
          <div className="card-b" style={{ paddingBottom: 0 }}>
            <form method="get" style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                name="q"
                defaultValue={query}
                placeholder="患者ID・症例名・氏名で検索"
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn">
                検索
              </button>
              {query && (
                <a href="/patients/pool" className="btn ghost">
                  条件をクリア
                </a>
              )}
            </form>
          </div>
          <div className="card-b" style={{ padding: 0 }}>
            {availableCases.length === 0 ? (
              <div className="empty-note">
                {query ? "条件に一致する症例がありません。" : "現在参加可能な症例はありません。"}
              </div>
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
          {totalPages > 1 && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", padding: "12px 0" }}>
              <a
                href={`/patients/pool?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(Math.max(1, page - 1)) })}`}
                className={`btn ghost${page <= 1 ? " disabled" : ""}`}
                aria-disabled={page <= 1}
              >
                ← 前へ
              </a>
              <span style={{ fontSize: 12, color: "var(--ink-soft)", alignSelf: "center" }}>
                {page} / {totalPages}
              </span>
              <a
                href={`/patients/pool?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(Math.min(totalPages, page + 1)) })}`}
                className={`btn ghost${page >= totalPages ? " disabled" : ""}`}
                aria-disabled={page >= totalPages}
              >
                次へ →
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
