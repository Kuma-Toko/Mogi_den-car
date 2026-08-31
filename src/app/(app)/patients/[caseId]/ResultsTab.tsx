import { db } from "@/lib/db";
import { formatJaDateTimeShort } from "@/lib/format";
import { orderStatusBadgeClass, orderStatusLabel } from "@/lib/labels";
import { getLabFlag, type LabValue } from "@/lib/lab-reference-ranges";

type LabOrder = Awaited<ReturnType<typeof loadLabOrders>>[number];

function loadLabOrders(caseId: string) {
  return db.order.findMany({
    where: { caseId, orderType: "LAB" },
    orderBy: { orderedAt: "desc" },
    include: { labItem: true },
  });
}

function parseValues(json: string | null): LabValue[] | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as LabValue[];
  } catch {
    return null;
  }
}

type ImagingDetail = { chiefComplaint?: string; findings?: string; purpose?: string; needsInterpretation?: boolean };

function parseImaging(detail: string | null): ImagingDetail | null {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail) as ImagingDetail;
    if (!parsed.chiefComplaint && !parsed.findings && !parsed.purpose && parsed.needsInterpretation === undefined) return null;
    return parsed;
  } catch {
    return null;
  }
}

// 表示上の日付・時刻（分単位）が同じオーダーをまとめる。同じタイミングで別々に発行した
// オーダーも、画面に表示される日時が一致していれば同じグループとして見えるようにする。
function groupByDisplayedTime(orders: LabOrder[]): LabOrder[][] {
  const groups = new Map<string, LabOrder[]>();
  const keys: string[] = [];
  for (const o of orders) {
    const key = formatJaDateTimeShort(o.orderedAt);
    if (!groups.has(key)) {
      groups.set(key, []);
      keys.push(key);
    }
    groups.get(key)!.push(o);
  }
  return keys.map((k) => groups.get(k)!);
}

export async function ResultsTab({ caseId }: { caseId: string }) {
  const labOrders = await loadLabOrders(caseId);
  const batches = groupByDisplayedTime(labOrders);

  return (
    <div className="card">
      <div className="card-h">検査結果</div>
      <div className="card-b">
        {labOrders.length === 0 ? (
          <div className="empty-note">検査オーダーはまだありません。</div>
        ) : (
          batches.map((batch) => (
            <div className="result-batch" key={batch[0].id}>
              <div className="result-batch-h">
                {formatJaDateTimeShort(batch[0].orderedAt)}　オーダー（{batch.length}件）
              </div>
              <table>
                <thead>
                  <tr>
                    <th>項目</th>
                    <th>カテゴリ</th>
                    <th>状態</th>
                    <th>結果</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.flatMap((o) => {
                    const values = parseValues(o.resultValues);
                    const imaging = parseImaging(o.detail);
                    const rows = [
                      <tr key={o.id}>
                        <td>{o.label}</td>
                        <td>{[o.labItem?.category, o.labItem?.subcategory].filter(Boolean).join(" / ") || "—"}</td>
                        <td>
                          <span className={`badge ${orderStatusBadgeClass[o.status]}`}>{orderStatusLabel[o.status]}</span>
                        </td>
                        <td>
                          {values && values.length > 0 ? (
                            <div className="lab-values">
                              {values.map((v, i) => {
                                const flag = getLabFlag(v.label, v.value);
                                return (
                                  <span className="lab-value" key={i}>
                                    {v.label} {v.value.toLocaleString("ja-JP")}
                                    {v.unit}
                                    {flag && <span className={`lab-flag lab-flag-${flag.toLowerCase()}`}>{flag}</span>}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            (o.resultText ?? "—")
                          )}
                        </td>
                      </tr>,
                    ];
                    if (imaging) {
                      rows.push(
                        <tr key={`${o.id}-imaging`}>
                          <td colSpan={4} className="imaging-detail-cell">
                            <div className="imaging-detail">
                              {imaging.chiefComplaint && <span>主訴：{imaging.chiefComplaint}</span>}
                              {imaging.purpose && <span>目的：{imaging.purpose}</span>}
                              <span>読影依頼：{imaging.needsInterpretation ? "あり" : "なし"}</span>
                              {imaging.findings && <div>臨床所見：{imaging.findings}</div>}
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return rows;
                  })}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
