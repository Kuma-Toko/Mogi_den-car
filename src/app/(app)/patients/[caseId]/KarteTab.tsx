import { db } from "@/lib/db";
import { formatJaDateTimeShort } from "@/lib/format";
import { karteEntryTypeBadgeClass, karteEntryTypeLabel } from "@/lib/labels";
import type { AmbulanceDetail, ReferralDetail } from "./actions";

const REFERRAL_FIELD_LABELS: Record<keyof ReferralDetail, string> = {
  destination: "紹介先",
  referringDoctor: "紹介元医師・医療機関",
  diagnosis: "傷病名",
  purpose: "紹介目的",
  presentIllness: "現病歴",
  pastHistory: "既往歴",
  medications: "現在の処方・内服薬",
  physicalFindings: "身体所見",
  testFindings: "検査所見",
  notes: "備考",
};

const AMBULANCE_FIELD_LABELS: Record<keyof AmbulanceDetail, string> = {
  agencyName: "搬送機関",
  callReceivedAt: "覚知時刻",
  sceneArrivalAt: "現場到着時刻",
  hospitalArrivalAt: "病院到着時刻",
  chiefComplaint: "主訴",
  onsetSituation: "発症状況",
  consciousness: "意識レベル",
  vitalsOnScene: "現場観察時バイタル",
  pastHistory: "既往歴・内服薬",
  treatmentEnRoute: "搬送中の処置",
  receivingDepartment: "受入診療科",
  notes: "特記事項",
};

function parseDetail(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, string>;
  } catch {
    return {};
  }
}

function DetailFields({ json, labels }: { json: string | null; labels: Record<string, string> }) {
  const detail = parseDetail(json);
  const entries = Object.entries(labels).filter(([key]) => detail[key]);
  if (entries.length === 0) return null;

  return (
    <dl className="karte-detail">
      {entries.map(([key, label]) => (
        <div key={key} className="karte-detail-row">
          <dt>{label}</dt>
          <dd>{detail[key]}</dd>
        </div>
      ))}
    </dl>
  );
}

export async function KarteTab({ caseId }: { caseId: string }) {
  const entries = await db.karteEntry.findMany({
    where: { caseId },
    orderBy: { createdAt: "desc" },
    include: { author: true },
  });

  return (
    <div className="card">
      <div className="card-h">カルテ（閲覧）</div>
      <div className="card-b">
        {entries.length === 0 ? (
          <div className="empty-note">カルテ記載はまだありません。「カルテ記載」タブから記入してください。</div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="karte-entry">
              <div className="karte-entry-h">
                <span className={`badge ${karteEntryTypeBadgeClass[e.entryType]}`}>{karteEntryTypeLabel[e.entryType]}</span>
                <span style={{ color: "var(--ink-soft)", fontSize: 11 }}>
                  {formatJaDateTimeShort(e.createdAt)}　{e.author.name}
                </span>
              </div>

              {e.title && <div style={{ fontWeight: 700, fontSize: 12.5, marginTop: 6 }}>{e.title}</div>}

              {e.entryType === "SOAP" && (
                <div style={{ fontSize: 12.5, marginTop: 6 }}>
                  {e.subjective && <p style={{ marginBottom: 4 }}>S: {e.subjective}</p>}
                  {e.objective && <p style={{ marginBottom: 4 }}>O: {e.objective}</p>}
                  {e.assessment && <p style={{ marginBottom: 4 }}>A: {e.assessment}</p>}
                  {e.plan && <p>P: {e.plan}</p>}
                </div>
              )}

              {e.entryType === "NARRATIVE" && (
                <p style={{ fontSize: 12.5, marginTop: 6, whiteSpace: "pre-wrap" }}>{e.narrative}</p>
              )}

              {e.entryType === "REFERRAL" && <DetailFields json={e.detail} labels={REFERRAL_FIELD_LABELS} />}

              {e.entryType === "AMBULANCE" && <DetailFields json={e.detail} labels={AMBULANCE_FIELD_LABELS} />}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
