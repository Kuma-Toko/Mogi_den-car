"use client";

import { useState } from "react";
import type { OrderStatus } from "@prisma/client";
import { orderStatusBadgeClass, orderStatusLabel } from "@/lib/labels";
import { getLabFlag, REFERENCE_RANGES, type LabValue } from "@/lib/lab-reference-ranges";

export type ImagingDetail = {
  chiefComplaint?: string;
  findings?: string;
  purpose?: string;
  needsInterpretation?: boolean;
  mriSequences?: string[];
};

export type ResultRow = {
  id: string;
  label: string;
  status: OrderStatus;
  values: LabValue[] | null;
  resultText: string | null;
  imaging: ImagingDetail | null;
};

export type ResultBatch = {
  key: string;
  heading: string;
  rows: ResultRow[];
};

export type TrendPoint = { time: string; value: number };
export type TrendSeries = { label: string; unit: string; points: TrendPoint[] };

const CHART_WIDTH = 640;
const PLOT_HEIGHT = 120;
const LABEL_STRIP = 18;
const CHART_HEIGHT = PLOT_HEIGHT + LABEL_STRIP;
const PAD_LEFT = 46;
const PAD_RIGHT = 10;
const INNER_PAD = 10;
const MAX_X_LABELS = 8;

function scaleY(value: number, min: number, max: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  const ratio = max === min ? 0.5 : (clamped - min) / (max - min);
  return PLOT_HEIGHT - INNER_PAD - ratio * (PLOT_HEIGHT - INNER_PAD * 2);
}

function xAt(i: number, n: number): number {
  if (n <= 1) return PAD_LEFT + (CHART_WIDTH - PAD_LEFT - PAD_RIGHT) / 2;
  return PAD_LEFT + (i / (n - 1)) * (CHART_WIDTH - PAD_LEFT - PAD_RIGHT);
}

function labeledIndices(n: number): number[] {
  if (n === 0) return [];
  const maxLabels = Math.max(2, Math.min(MAX_X_LABELS, Math.floor((CHART_WIDTH - PAD_LEFT - PAD_RIGHT) / 54)));
  const step = Math.max(1, Math.ceil(n / maxLabels));
  const set = new Set<number>();
  for (let i = 0; i < n; i += step) set.add(i);
  set.add(n - 1);
  return [...set].sort((a, b) => a - b);
}

function formatTick(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const abs = Math.abs(value);
  const digits = abs < 1 ? 3 : abs < 10 ? 2 : 1;
  return value.toFixed(digits);
}

function LabTrendChart({ series, showReference }: { series: TrendSeries; showReference: boolean }) {
  const n = series.points.length;
  const values = series.points.map((p) => p.value);
  const range = REFERENCE_RANGES[series.label];
  const useRange = showReference && !!range;

  let dataMin = Math.min(...values);
  let dataMax = Math.max(...values);
  if (useRange && range) {
    dataMin = Math.min(dataMin, range.low);
    dataMax = Math.max(dataMax, range.high);
  }
  if (dataMin === dataMax) {
    const pad = dataMin === 0 ? 1 : Math.abs(dataMin) * 0.1;
    dataMin -= pad;
    dataMax += pad;
  }
  const span = dataMax - dataMin;
  const domainMin = dataMin - span * 0.1;
  const domainMax = dataMax + span * 0.1;

  const points = series.points.map((p, i) => `${xAt(i, n).toFixed(1)},${scaleY(p.value, domainMin, domainMax).toFixed(1)}`).join(" ");
  const xLabels = labeledIndices(n);
  const ticks = [domainMin, (domainMin + domainMax) / 2, domainMax];

  return (
    <div className="chart-mock" style={{ height: CHART_HEIGHT }}>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none">
        {useRange && range && (
          <rect
            x={PAD_LEFT}
            y={scaleY(range.high, domainMin, domainMax)}
            width={CHART_WIDTH - PAD_LEFT - PAD_RIGHT}
            height={Math.max(0, scaleY(range.low, domainMin, domainMax) - scaleY(range.high, domainMin, domainMax))}
            fill="var(--teal-tint)"
          />
        )}
        <line x1={PAD_LEFT} y1={PLOT_HEIGHT} x2={CHART_WIDTH - PAD_RIGHT} y2={PLOT_HEIGHT} stroke="var(--line)" strokeWidth="1" />
        <line x1={PAD_LEFT} y1={0} x2={PAD_LEFT} y2={PLOT_HEIGHT} stroke="var(--line)" strokeWidth="1" />
        {ticks.map((t, idx) => (
          <text
            key={idx}
            x={PAD_LEFT - 5}
            y={scaleY(t, domainMin, domainMax)}
            fontSize="9"
            fill="var(--ink-soft)"
            textAnchor="end"
            dominantBaseline="middle"
          >
            {formatTick(t)}
          </text>
        ))}
        {points && <polyline points={points} fill="none" stroke="var(--teal)" strokeWidth="2" />}
        {series.points.map((p, i) => {
          const flag = getLabFlag(series.label, p.value);
          const color = flag === "H" ? "var(--red)" : flag === "L" ? "var(--blue)" : "var(--teal)";
          return <circle key={i} cx={xAt(i, n)} cy={scaleY(p.value, domainMin, domainMax)} r="2.6" fill={color} />;
        })}
        {xLabels.map((i) => {
          const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
          return (
            <text key={i} x={xAt(i, n)} y={PLOT_HEIGHT + 13} fontSize="9" fill="var(--ink-soft)" textAnchor={anchor}>
              {series.points[i].time}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export function ResultsView({ batches, trendSeries }: { batches: ResultBatch[]; trendSeries: TrendSeries[] }) {
  const [showReference, setShowReference] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);

  const toggleSelected = (label: string) => {
    setSelected((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));
  };

  const selectedSeries = trendSeries.filter((s) => selected.includes(s.label));

  return (
    <>
      <div className="card">
        <div className="card-h">
          <span>検査結果</span>
          <div className="toggle2">
            <div className={showReference ? "on" : ""} onClick={() => setShowReference(true)}>
              基準範囲を表示
            </div>
            <div className={showReference ? "" : "on"} onClick={() => setShowReference(false)}>
              非表示
            </div>
          </div>
        </div>
        <div className="card-b">
          {batches.length === 0 ? (
            <div className="empty-note">検査オーダーはまだありません。</div>
          ) : (
            batches.map((batch) => (
              <div className="result-batch" key={batch.key}>
                <div className="result-batch-h">{batch.heading}</div>
                <table>
                  <thead>
                    <tr>
                      <th>項目</th>
                      <th>状態</th>
                      <th>結果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batch.rows.flatMap((o) => {
                      const rows = [
                        <tr key={o.id}>
                          <td>{o.label}</td>
                          <td>
                            <span className={`badge ${orderStatusBadgeClass[o.status]}`}>{orderStatusLabel[o.status]}</span>
                          </td>
                          <td>
                            {o.values && o.values.length > 0 ? (
                              <div className="lab-values">
                                {o.values.map((v, i) => {
                                  const flag = getLabFlag(v.label, v.value);
                                  const range = REFERENCE_RANGES[v.label];
                                  return (
                                    <span className="lab-value" key={i}>
                                      {v.label} {v.value.toLocaleString("ja-JP")}
                                      {v.unit}
                                      {flag && <span className={`lab-flag lab-flag-${flag.toLowerCase()}`}>{flag}</span>}
                                      {showReference && range && (
                                        <span className="lab-ref-range">
                                          （基準値 {range.low.toLocaleString("ja-JP")}〜{range.high.toLocaleString("ja-JP")}）
                                        </span>
                                      )}
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
                      if (o.imaging) {
                        const imaging = o.imaging;
                        rows.push(
                          <tr key={`${o.id}-imaging`}>
                            <td colSpan={3} className="imaging-detail-cell">
                              <div className="imaging-detail">
                                {imaging.chiefComplaint && <span>主訴：{imaging.chiefComplaint}</span>}
                                {imaging.purpose && <span>目的：{imaging.purpose}</span>}
                                <span>読影依頼：{imaging.needsInterpretation ? "あり" : "なし"}</span>
                                {imaging.mriSequences && imaging.mriSequences.length > 0 && (
                                  <span>撮像シーケンス：{imaging.mriSequences.join("、")}</span>
                                )}
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

      {trendSeries.length > 0 && (
        <div className="card">
          <div className="card-h">検査値の推移</div>
          <div className="card-b">
            <div className="chip-grid">
              {trendSeries.map((s) => (
                <div
                  key={s.label}
                  className={`chip-toggle ${selected.includes(s.label) ? "on" : ""}`}
                  onClick={() => toggleSelected(s.label)}
                >
                  {s.label}
                  <span className="trend-chip-count">（{s.points.length}件）</span>
                </div>
              ))}
            </div>
            {selectedSeries.length === 0 ? (
              <div className="empty-note">項目を選択すると、時系列での変化をグラフで確認できます。</div>
            ) : (
              <div className="trend-charts">
                {selectedSeries.map((s) => (
                  <div className="trend-item" key={s.label}>
                    <div className="trend-item-h">
                      <span className="trend-item-name">{s.label}</span>
                      <span className="trend-item-unit">{s.unit}</span>
                    </div>
                    <LabTrendChart series={s} showReference={showReference} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
