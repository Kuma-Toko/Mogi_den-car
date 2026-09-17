import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { caseTypeLabel } from "@/lib/labels";
import { formatJaDateTime, formatJaDateTimeShort } from "@/lib/format";
import { findPrimaryDiseaseLink } from "@/lib/engine";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Modal } from "@/components/Modal";
import { SortableTh } from "@/components/SortableTh";
import { deleteCaseTemplate, generateCasesFromTemplate, publishGeneratedCases } from "./actions";
import { GenerateForm } from "./GenerateForm";

const PAGE_SIZE = 20;

const SORTABLE_FIELDS = ["title", "createdAt", "updatedAt"] as const;
type SortableField = (typeof SORTABLE_FIELDS)[number];

const ERROR_MESSAGES: Record<string, string> = {
  no_filter: "学年・所属のいずれかを指定するか、「全学生を対象にする」にチェックしてください。",
  no_students: "指定した条件に該当する学生がいません。",
};

export default async function CaseTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; dir?: string; error?: string; generated?: string; skipped?: string; published?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "STUDENT") redirect("/patients");

  const { q, page: pageParam, sort: sortParam, dir: dirParam, error, generated, skipped, published } = await searchParams;
  const query = q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const sort: SortableField = SORTABLE_FIELDS.includes(sortParam as SortableField) ? (sortParam as SortableField) : "updatedAt";
  const dir: "asc" | "desc" = dirParam === "asc" ? "asc" : dirParam === "desc" ? "desc" : "desc";
  const orderBy: Prisma.CaseOrderByWithRelationInput = { [sort]: dir };

  const baseWhere = { isTemplate: true as const, ...(user.role === "ADMIN" ? {} : { createdByUserId: user.id }) };
  const where = query
    ? {
        ...baseWhere,
        OR: [{ caseCode: { contains: query } }, { title: { contains: query } }, { patientName: { contains: query } }],
      }
    : baseWhere;

  const [totalCount, templatesUnsorted, gradeAffiliationBreakdownRaw] = await Promise.all([
    db.case.count({ where }),
    db.case.findMany({
      where,
      include: {
        diseaseLinks: { include: { template: true }, orderBy: { sortOrder: "asc" } },
        _count: { select: { generatedCases: true } },
      },
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.user.groupBy({ by: ["grade", "affiliation"], where: { role: "STUDENT" }, _count: { _all: true } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const templateIds = templatesUnsorted.map((t) => t.id);
  const generatedStatusCounts = await db.case.groupBy({
    by: ["templateSourceId", "status"],
    where: { templateSourceId: { in: templateIds } },
    _count: { _all: true },
  });
  const draftCountByTemplateId = new Map<string, number>();
  for (const row of generatedStatusCounts) {
    if (row.status === "DRAFT" && row.templateSourceId) {
      draftCountByTemplateId.set(row.templateSourceId, row._count._all);
    }
  }

  const breakdown = gradeAffiliationBreakdownRaw.map((row) => ({
    grade: row.grade,
    affiliation: row.affiliation,
    count: row._count._all,
  }));

  return (
    <>
      <div className="topbar">
        <h1>症例テンプレート</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <div style={{ marginBottom: 14, fontSize: 11.5, color: "var(--ink-soft)" }}>
          教員が症例を一度作り込んでおき、学年・所属を指定してボタン1つで学生ごとの症例を一括生成できます。
          テンプレート自体は学生には配られず（症例一覧・患者リスト・プールから常に除外されます）、生成された症例だけが学生ごとに独立して進行します。
        </div>

        {error && ERROR_MESSAGES[error] && <div className="banner-error" style={{ marginBottom: 14 }}>{ERROR_MESSAGES[error]}</div>}
        {generated != null && (
          <div style={{ background: "var(--teal-tint)", color: "var(--teal-dark)", fontSize: 12.5, padding: "10px 14px", borderRadius: 6, marginBottom: 14 }}>
            生成: {generated}件{Number(skipped) > 0 ? ` ／ スキップ: ${skipped}件（生成済みの学生）` : ""}
          </div>
        )}
        {published != null && (
          <div style={{ background: "var(--teal-tint)", color: "var(--teal-dark)", fontSize: 12.5, padding: "10px 14px", borderRadius: 6, marginBottom: 14 }}>
            下書き{published}件を公開しました。
          </div>
        )}

        <div className="card">
          <div className="card-h">
            テンプレート一覧（全{totalCount.toLocaleString()}件中{templatesUnsorted.length.toLocaleString()}件を表示）
            <Link href="/teacher/case-templates/new" className="btn primary" style={{ fontSize: 11 }}>
              ＋ 新規テンプレート作成
            </Link>
          </div>
          <div className="card-b" style={{ paddingBottom: 0 }}>
            <form method="get" style={{ display: "flex", gap: 8 }}>
              <input type="text" name="q" defaultValue={query} placeholder="症例名・患者名・症例コードで検索" style={{ flex: 1 }} />
              <button type="submit" className="btn">
                検索
              </button>
              {query && (
                <a href="/teacher/case-templates" className="btn ghost">
                  条件をクリア
                </a>
              )}
            </form>
          </div>
          <div className="card-b" style={{ padding: 0 }}>
            {templatesUnsorted.length === 0 ? (
              <div className="empty-note">
                {query ? "条件に一致するテンプレートがありません。" : "症例テンプレートはまだありません。「新規テンプレート作成」から作成してください。"}
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <SortableTh label="症例名" sortKey="title" sort={sort} dir={dir} basePath="/teacher/case-templates" params={{ q: query || undefined }} />
                    <th>区分</th>
                    <th>主病態</th>
                    <th>疾患数</th>
                    <th>生成済み症例数</th>
                    <SortableTh label="更新日" sortKey="updatedAt" sort={sort} dir={dir} basePath="/teacher/case-templates" params={{ q: query || undefined }} />
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {templatesUnsorted.map((t) => {
                    const primaryLink = findPrimaryDiseaseLink(t.diseaseLinks);
                    const draftCount = draftCountByTemplateId.get(t.id) ?? 0;
                    return (
                      <tr className="row" key={t.id}>
                        <td>{t.title}</td>
                        <td>{caseTypeLabel[t.caseType]}</td>
                        <td>{primaryLink?.template.name ?? "—"}</td>
                        <td>{t.diseaseLinks.length}</td>
                        <td>
                          {t._count.generatedCases}件
                          {draftCount > 0 ? `（下書き${draftCount}件）` : ""}
                        </td>
                        <td>{formatJaDateTimeShort(t.updatedAt)}</td>
                        <td>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <Link href={`/teacher/case-templates/${t.id}/edit`} className="btn ghost" style={{ fontSize: 11 }}>
                              編集
                            </Link>
                            <Modal trigger="この症例を生成" triggerClassName="btn primary" title={`「${t.title}」から症例を生成`}>
                              <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 0 }}>
                                学年・所属を指定して、該当する学生1人につき1件、独立した症例を生成します。生成後の重症度カーブは公開した瞬間から進行します。
                              </p>
                              <GenerateForm action={generateCasesFromTemplate.bind(null, t.id)} breakdown={breakdown} />
                            </Modal>
                            {draftCount > 0 && (
                              <form action={publishGeneratedCases.bind(null, t.id)}>
                                <button type="submit" className="btn ghost" style={{ fontSize: 11 }}>
                                  下書き{draftCount}件を公開
                                </button>
                              </form>
                            )}
                            <form>
                              <ConfirmButton
                                formAction={deleteCaseTemplate.bind(null, t.id)}
                                confirmText={`「${t.title}」テンプレートを削除しますか？（既に生成済みの症例は残ります）`}
                                className="btn ghost"
                              >
                                削除
                              </ConfirmButton>
                            </form>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {totalPages > 1 && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", padding: "12px 0" }}>
              <a
                href={`/teacher/case-templates?${new URLSearchParams({ ...(query ? { q: query } : {}), sort, dir, page: String(Math.max(1, page - 1)) })}`}
                className={`btn ghost${page <= 1 ? " disabled" : ""}`}
                aria-disabled={page <= 1}
              >
                ← 前へ
              </a>
              <span style={{ fontSize: 12, color: "var(--ink-soft)", alignSelf: "center" }}>
                {page} / {totalPages}
              </span>
              <a
                href={`/teacher/case-templates?${new URLSearchParams({ ...(query ? { q: query } : {}), sort, dir, page: String(Math.min(totalPages, page + 1)) })}`}
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
