import { db } from "@/lib/db";
import { formatJaDateTimeShort } from "@/lib/format";
import { karteEntryTypeBadgeClass, karteEntryTypeLabel, orderStatusBadgeClass, orderStatusLabel, orderTypeLabel } from "@/lib/labels";
import { getDiseaseLinkSeverities } from "@/lib/engine";
import { getSeverityTier, type SeverityTier } from "@/lib/physiology-engine";
import { ConfirmButton } from "@/components/ConfirmButton";
import { updateDiseaseLinkSeverity, deleteDiseaseLink } from "./actions";

function scoreBadgeClass(score: number): string {
  if (score >= 70) return "teal";
  if (score >= 40) return "amber";
  return "red";
}

const TIER_LABEL: Record<SeverityTier, string> = { mild: "軽症", moderate: "中等症", severe: "重症" };

export async function SummaryTab({ caseId, canManageDiseases }: { caseId: string; canManageDiseases: boolean }) {
  const [problems, latestNote, recentOrders, evaluations, diseaseLinks, severities] = await Promise.all([
    db.problem.findMany({ where: { caseId }, orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] }),
    db.karteEntry.findFirst({ where: { caseId }, orderBy: { createdAt: "desc" }, include: { author: true } }),
    db.order.findMany({
      where: { caseId },
      orderBy: { orderedAt: "desc" },
      take: 5,
      include: { orderedBy: { select: { name: true } } },
    }),
    db.treatmentEvaluation.findMany({ where: { caseId, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, take: 5 }),
    canManageDiseases
      ? db.caseDiseaseLink.findMany({ where: { caseId }, include: { template: true }, orderBy: { sortOrder: "asc" } })
      : Promise.resolve([]),
    canManageDiseases ? getDiseaseLinkSeverities(caseId) : Promise.resolve(new Map<string, number | null>()),
  ]);

  return (
    <>
    <div className="split">
      <div className="card">
        <div className="card-h">プロブレムリスト</div>
        <div className="card-b">
          {problems.length === 0 ? (
            <div className="empty-note">プロブレムは未登録です。</div>
          ) : (
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {problems.map((p) => (
                <li key={p.id} style={{ marginBottom: 6, fontSize: 12.5 }}>
                  {p.label}
                  {p.isPrimary && (
                    <span className="badge teal" style={{ marginLeft: 6 }}>
                      主病態
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card-h" style={{ borderTop: "1px solid var(--line-soft)" }}>
          直近のカルテ記載
        </div>
        <div className="card-b">
          {latestNote ? (
            <div style={{ fontSize: 12.5 }}>
              <div style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className={`badge ${karteEntryTypeBadgeClass[latestNote.entryType]}`}>
                  {karteEntryTypeLabel[latestNote.entryType]}
                </span>
                <span style={{ color: "var(--ink-soft)", fontSize: 11 }}>
                  {formatJaDateTimeShort(latestNote.createdAt)}　{latestNote.author.name}
                </span>
              </div>
              {latestNote.entryType === "SOAP" && (
                <>
                  {latestNote.subjective && <p style={{ marginBottom: 4 }}>S: {latestNote.subjective}</p>}
                  {latestNote.objective && <p style={{ marginBottom: 4 }}>O: {latestNote.objective}</p>}
                  {latestNote.assessment && <p style={{ marginBottom: 4 }}>A: {latestNote.assessment}</p>}
                  {latestNote.plan && <p>P: {latestNote.plan}</p>}
                </>
              )}
              {latestNote.entryType === "NARRATIVE" && <p style={{ whiteSpace: "pre-wrap" }}>{latestNote.narrative}</p>}
              {(latestNote.entryType === "REFERRAL" || latestNote.entryType === "AMBULANCE") && (
                <p>{latestNote.title}（詳細は「カルテ」タブでご確認ください）</p>
              )}
            </div>
          ) : (
            <div className="empty-note">カルテ記載はまだありません。「カルテ記載」タブから記入してください。</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h">直近のオーダー</div>
        <div className="card-b">
          {recentOrders.length === 0 ? (
            <div className="empty-note">オーダーはまだありません。</div>
          ) : (
            recentOrders.map((o) => (
              <div className="order-item" key={o.id}>
                <div>
                  <div className="name">{o.label}</div>
                  <div className="sub">
                    {orderTypeLabel[o.orderType]}　{o.orderedBy.name}
                  </div>
                </div>
                <span className={`badge ${orderStatusBadgeClass[o.status]}`}>{orderStatusLabel[o.status]}</span>
              </div>
            ))
          )}
        </div>

        {evaluations.length > 0 && (
          <>
            <div className="card-h" style={{ borderTop: "1px solid var(--line-soft)" }}>
              AI治療評価
            </div>
            <div className="card-b">
              {evaluations.map((e) => (
                <div key={e.id} style={{ marginBottom: 10, fontSize: 12.5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                    <span className={`badge ${scoreBadgeClass(e.appropriatenessScore ?? 0)}`}>
                      適切性スコア {e.appropriatenessScore}/100
                    </span>
                    {e.contraindicated && <span className="badge red">重大な問題を検知</span>}
                    <span style={{ color: "var(--ink-soft)", fontSize: 11 }}>
                      {e.completedAt ? formatJaDateTimeShort(e.completedAt) : ""}
                    </span>
                  </div>
                  {e.rationale && <p style={{ margin: 0, color: "var(--ink-soft)" }}>{e.rationale}</p>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>

    {canManageDiseases && (
      <div className="card">
        <div className="card-h">病態の管理（教員・管理者のみ）</div>
        <div className="card-b">
          {diseaseLinks.length === 0 ? (
            <div className="empty-note">病態が登録されていません。</div>
          ) : (
            diseaseLinks.map((link) => {
              const severity = severities.get(link.id) ?? null;
              const tier = severity !== null ? getSeverityTier(severity) : null;
              return (
                <div
                  key={link.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                    padding: "8px 0",
                    borderBottom: "1px solid var(--line-soft)",
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 140 }}>
                    {link.template.name}
                    {link.isPrimary && (
                      <span className="badge teal" style={{ marginLeft: 6, fontSize: 10 }}>
                        主病態
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--ink-soft)", minWidth: 90 }}>
                    {severity !== null && tier ? `重症度 ${Math.round(severity)}（${TIER_LABEL[tier]}）` : "重症度 —"}
                  </span>
                  <form
                    action={updateDiseaseLinkSeverity.bind(null, caseId, link.id)}
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <input
                      type="number"
                      name="severity"
                      min={0}
                      max={100}
                      defaultValue={severity !== null ? Math.round(severity) : 50}
                      style={{ width: 64 }}
                    />
                    <button type="submit" className="btn" style={{ fontSize: 11, padding: "4px 8px" }}>
                      重症度を変更
                    </button>
                  </form>
                  {diseaseLinks.length > 1 ? (
                    <form>
                      <ConfirmButton
                        formAction={deleteDiseaseLink.bind(null, caseId, link.id)}
                        confirmText={`「${link.template.name}」を削除しますか？`}
                        className="btn ghost"
                        actionLabel="削除する"
                        actionClassName="btn danger"
                      >
                        削除
                      </ConfirmButton>
                    </form>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>最後の病態のため削除できません</span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    )}
    </>
  );
}
