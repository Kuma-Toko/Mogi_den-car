import { db } from "@/lib/db";
import { formatJaDateTimeShort } from "@/lib/format";
import { karteEntryTypeBadgeClass, karteEntryTypeLabel, orderStatusBadgeClass, orderStatusLabel, orderTypeLabel } from "@/lib/labels";
import { getDiseaseLinkSeverities, getDiseaseLinkImprovementDetails, type DiseaseLinkImprovementDetail } from "@/lib/engine";
import { getSeverityTier, UNTREATED_DRIFT_PER_HOUR, type SeverityTier } from "@/lib/physiology-engine";
import { ConfirmButton } from "@/components/ConfirmButton";
import { updateDiseaseLinkSeverity, updateDiseaseLinkRate, deleteDiseaseLink } from "./actions";

function scoreBadgeClass(score: number): string {
  if (score >= 70) return "teal";
  if (score >= 40) return "amber";
  return "red";
}

const TIER_LABEL: Record<SeverityTier, string> = { mild: "軽症", moderate: "中等症", severe: "重症" };

// aiSeverityRatePerHour（時間あたりの重症度変化量。正=悪化、負=改善）の表示用ラベル。
// null＝AI評価未発火・手動設定なし（改善速度スライダーに基づく従来の自然経過カーブを使用中）。
function rateLabel(rate: number | null): string {
  if (rate === null) return "自然経過（改善速度の既定設定に基づく）";
  if (rate === 0) return "変動なし（横ばいで固定）";
  const sign = rate > 0 ? "+" : "";
  const trend = rate > 0 ? "悪化" : "改善";
  return `${sign}${rate.toFixed(1)} /時間（${trend}）`;
}

// テンプレートの治療開始条件（薬剤大分類・処置キーワード）をそのまま表示する用。
function triggerSummary(trigger: { drugCategories?: string[]; procedureKeywords?: string[] }): string {
  const parts = [...(trigger.drugCategories ?? []), ...(trigger.procedureKeywords ?? [])];
  return parts.length > 0 ? parts.join("、") : "―（このテンプレートに治療開始条件が設定されていません）";
}

export async function SummaryTab({
  caseId,
  canManageDiseases,
  currentUserId,
}: {
  caseId: string;
  canManageDiseases: boolean;
  currentUserId: string;
}) {
  // AI治療評価（オーダーごとのスコア・根拠）は治療中の学生には見せない。教員・管理者は常時閲覧可、
  // 学生は自身が退院済み（症例終了）になって初めて、その症例の評価履歴を振り返りとして閲覧できる。
  const canViewTreatmentEvaluations = canManageDiseases
    ? true
    : Boolean(
        (
          await db.caseAssignment.findUnique({
            where: { caseId_studentId: { caseId, studentId: currentUserId } },
            select: { dischargedAt: true },
          })
        )?.dischargedAt
      );

  const [problems, latestNote, recentOrders, evaluations, diseaseLinks, severities, improvementDetails] = await Promise.all([
    db.problem.findMany({ where: { caseId }, orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] }),
    db.karteEntry.findFirst({ where: { caseId }, orderBy: { createdAt: "desc" }, include: { author: true } }),
    db.order.findMany({
      where: { caseId },
      orderBy: { orderedAt: "desc" },
      take: 5,
      include: { orderedBy: { select: { name: true } } },
    }),
    canViewTreatmentEvaluations
      ? db.treatmentEvaluation.findMany({ where: { caseId, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, take: 5 })
      : Promise.resolve([]),
    canManageDiseases
      ? db.caseDiseaseLink.findMany({ where: { caseId }, include: { template: true }, orderBy: { sortOrder: "asc" } })
      : Promise.resolve([]),
    canManageDiseases ? getDiseaseLinkSeverities(caseId) : Promise.resolve(new Map<string, number | null>()),
    canManageDiseases
      ? getDiseaseLinkImprovementDetails(caseId)
      : Promise.resolve(new Map<string, DiseaseLinkImprovementDetail>()),
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

        {canViewTreatmentEvaluations && evaluations.length > 0 && (
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
              const detail = improvementDetails.get(link.id) ?? null;
              return (
                <div
                  key={link.id}
                  style={{
                    padding: "8px 0",
                    borderBottom: "1px solid var(--line-soft)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
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
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "var(--ink-soft)", minWidth: 90 }}>
                      変動速度: {rateLabel(link.aiSeverityRatePerHour)}
                    </span>
                    {severity !== null && (
                      <form
                        action={updateDiseaseLinkRate.bind(null, caseId, link.id)}
                        style={{ display: "flex", alignItems: "center", gap: 6 }}
                      >
                        <input
                          type="number"
                          name="rate"
                          step="0.1"
                          min={-4}
                          max={4}
                          defaultValue={link.aiSeverityRatePerHour ?? 0}
                          style={{ width: 64 }}
                        />
                        <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>/時間（-4〜+4、負=改善・正=悪化）</span>
                        <button type="submit" className="btn" style={{ fontSize: 11, padding: "4px 8px" }}>
                          変動速度を変更
                        </button>
                      </form>
                    )}
                  </div>
                  {detail && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ fontSize: 11, color: "var(--ink-soft)", cursor: "pointer" }}>内部判定を表示</summary>
                      <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.6 }}>
                        {!detail.engineReady ? (
                          <p style={{ margin: 0 }}>このテンプレートはエンジン未設定のため、重症度は動的に変化しません。</p>
                        ) : detail.mode === "ai" ? (
                          <p style={{ margin: 0 }}>
                            <span className="badge blue" style={{ marginRight: 6 }}>
                              AI治療評価による変動
                            </span>
                            変動速度 {detail.aiSeverityRatePerHour.toFixed(1)}/時間を適用中（起点:{" "}
                            {formatJaDateTimeShort(detail.severityBaselineAt)}）
                          </p>
                        ) : detail.resolution.treated ? (
                          <>
                            <p style={{ margin: "0 0 4px" }}>
                              <span className="badge teal" style={{ marginRight: 6 }}>
                                自然経過（指数減衰）
                              </span>
                              半減期 約{detail.halfLifeHours!.toFixed(1)}時間
                            </p>
                            <p style={{ margin: 0 }}>
                              治療開始トリガー一致: {orderTypeLabel[detail.resolution.matchedOrder.orderType]}「
                              {detail.resolution.matchedOrder.label}」（{formatJaDateTimeShort(detail.resolution.matchedOrder.orderedAt)}）
                              {detail.resolution.viaBaselineCarryover && "　※前の起点から治療継続を引き継ぎ"}
                            </p>
                          </>
                        ) : (
                          <>
                            <p style={{ margin: "0 0 4px" }}>
                              <span className="badge amber" style={{ marginRight: 6 }}>
                                自然経過（未治療）
                              </span>
                              未治療のため悪化中（+{UNTREATED_DRIFT_PER_HOUR.toFixed(1)}/時間）
                            </p>
                            <p style={{ margin: 0 }}>治療開始トリガー条件: {triggerSummary(detail.trigger)}</p>
                          </>
                        )}
                      </div>
                    </details>
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
