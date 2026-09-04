"use client";

import { useState } from "react";
import type { EncounterRole, OrderStatus } from "@prisma/client";
import { formatJaDateTimeShort } from "@/lib/format";
import { orderStatusBadgeClass, orderStatusLabel } from "@/lib/labels";
import { getLabFlag, type LabValue } from "@/lib/lab-reference-ranges";

const ROLE_LABEL = { STUDENT: "学生", PATIENT: "患者", SYSTEM: "システム" } as const;
const ROLE_CLASS = { STUDENT: "student", PATIENT: "patient", SYSTEM: "system" } as const;

export type ReferenceMessage = {
  id: string;
  role: EncounterRole | "SYSTEM";
  content: string;
  createdAt: string;
};

export type ReferenceVitalRow = {
  id: string;
  time: string;
  temperature: number | null;
  systolicBp: number | null;
  diastolicBp: number | null;
  pulse: number | null;
  spo2: number | null;
  respRate: number | null;
};

export type ReferenceLabRow = {
  id: string;
  time: string;
  label: string;
  status: OrderStatus;
  values: LabValue[] | null;
  resultText: string | null;
};

type View = "encounter" | "results" | "vitals";

const VIEWS: { key: View; label: string }[] = [
  { key: "encounter", label: "問診・診察" },
  { key: "results", label: "検査結果" },
  { key: "vitals", label: "バイタル" },
];

export function KarteReferenceTabs({
  messages,
  vitals,
  labs,
}: {
  messages: ReferenceMessage[];
  vitals: ReferenceVitalRow[];
  labs: ReferenceLabRow[];
}) {
  const [view, setView] = useState<View>("encounter");

  return (
    <div className="card">
      <div className="card-h">
        <span>参照ログ</span>
        <div className="toggle2">
          {VIEWS.map((v) => (
            <div key={v.key} className={view === v.key ? "on" : ""} onClick={() => setView(v.key)}>
              {v.label}
            </div>
          ))}
        </div>
      </div>
      <div className="card-b">
        {view === "encounter" &&
          (messages.length === 0 ? (
            <div className="empty-note">まだ記録がありません。「問診・診察」タブから開始してください。</div>
          ) : (
            <div className="chat-log chat-log-compact">
              {messages.map((m) => (
                <div key={m.id} className={`chat-msg ${ROLE_CLASS[m.role]}`}>
                  <div className="chat-bubble">
                    <div className="chat-meta">
                      {ROLE_LABEL[m.role]}　{formatJaDateTimeShort(new Date(m.createdAt))}
                    </div>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
          ))}

        {view === "results" &&
          (labs.length === 0 ? (
            <div className="empty-note">検査オーダーはまだありません。「検査結果」タブでご確認ください。</div>
          ) : (
            <div className="ref-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>時刻</th>
                    <th>項目</th>
                    <th>状態</th>
                    <th>結果</th>
                  </tr>
                </thead>
                <tbody>
                  {labs.map((o) => (
                    <tr key={o.id}>
                      <td>{o.time}</td>
                      <td>{o.label}</td>
                      <td>
                        <span className={`badge ${orderStatusBadgeClass[o.status]}`}>{orderStatusLabel[o.status]}</span>
                      </td>
                      <td>
                        {o.values && o.values.length > 0 ? (
                          <div className="lab-values">
                            {o.values.map((v, i) => {
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {view === "vitals" &&
          (vitals.length === 0 ? (
            <div className="empty-note">バイタルの記録はまだありません。</div>
          ) : (
            <div className="ref-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>時刻</th>
                    <th>体温</th>
                    <th>血圧</th>
                    <th>脈拍</th>
                    <th>SpO2</th>
                    <th>呼吸数</th>
                  </tr>
                </thead>
                <tbody>
                  {vitals.map((v) => (
                    <tr key={v.id}>
                      <td>{v.time}</td>
                      <td>{v.temperature !== null ? `${v.temperature}℃` : "—"}</td>
                      <td>{v.systolicBp !== null && v.diastolicBp !== null ? `${v.systolicBp}/${v.diastolicBp}` : "—"}</td>
                      <td>{v.pulse !== null ? `${v.pulse}/分` : "—"}</td>
                      <td>{v.spo2 !== null ? `${v.spo2}%` : "—"}</td>
                      <td>{v.respRate !== null ? `${v.respRate}/分` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>
    </div>
  );
}
