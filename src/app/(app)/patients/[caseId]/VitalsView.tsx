"use client";

import { useState } from "react";

export type VitalRow = {
  id: string;
  time: string;
  timestamp: number;
  temperature: number | null;
  systolicBp: number | null;
  diastolicBp: number | null;
  pulse: number | null;
  spo2: number | null;
  respRate: number | null;
};

type VitalKey = "temperature" | "systolicBp" | "diastolicBp" | "pulse" | "spo2" | "respRate";
type AxisSide = "left" | "right";

const AXIS_W = 38;
const LEFT_AXES = 2;
const RIGHT_AXES = 3;
const PAD_LEFT = LEFT_AXES * AXIS_W;
const PAD_RIGHT = RIGHT_AXES * AXIS_W;
const CHART_WIDTH = 680;
const PLOT_HEIGHT = 250;
const LEGEND_HEIGHT = 24;
const LABEL_STRIP = 18;
const CHART_HEIGHT = LEGEND_HEIGHT + PLOT_HEIGHT + LABEL_STRIP;
const INNER_PAD = 14;
const TICK_LEN = 4;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

type SeriesDef = {
  key: VitalKey;
  label: string;
  color: string;
  dashed?: boolean;
};

type AxisDef = {
  id: string;
  side: AxisSide;
  order: number;
  domain: [number, number];
  color: string;
  series: SeriesDef[];
  reference?: { value: number; label: string };
};

const AXES: AxisDef[] = [
  {
    id: "temp",
    side: "left",
    order: 0,
    domain: [35, 40],
    color: "var(--red)",
    series: [{ key: "temperature", label: "体温", color: "var(--red)" }],
    reference: { value: 37.0, label: "37.0℃" },
  },
  {
    id: "bp",
    side: "left",
    order: 1,
    domain: [40, 200],
    color: "var(--blue)",
    series: [
      { key: "systolicBp", label: "収縮期", color: "var(--blue)" },
      { key: "diastolicBp", label: "拡張期", color: "var(--blue)", dashed: true },
    ],
  },
  {
    id: "spo2",
    side: "right",
    order: 0,
    domain: [85, 100],
    color: "var(--teal)",
    series: [{ key: "spo2", label: "SpO2", color: "var(--teal)" }],
  },
  {
    id: "pulse",
    side: "right",
    order: 1,
    domain: [30, 180],
    color: "var(--amber)",
    series: [{ key: "pulse", label: "脈拍", color: "var(--amber)" }],
  },
  {
    id: "resp",
    side: "right",
    order: 2,
    domain: [0, 40],
    color: "var(--purple)",
    series: [{ key: "respRate", label: "呼吸数", color: "var(--purple)" }],
  },
];

function axisLineX(axis: AxisDef): number {
  return axis.side === "left" ? PAD_LEFT - axis.order * AXIS_W : CHART_WIDTH - PAD_RIGHT + axis.order * AXIS_W;
}

function scaleY(value: number, domainMin: number, domainMax: number): number {
  const clamped = Math.min(domainMax, Math.max(domainMin, value));
  const ratio = (clamped - domainMin) / (domainMax - domainMin);
  return LEGEND_HEIGHT + PLOT_HEIGHT - INNER_PAD - ratio * (PLOT_HEIGHT - INNER_PAD * 2);
}

function buildLine(
  timestamps: number[],
  values: (number | null)[],
  domainMin: number,
  domainMax: number,
  xAtTime: (ts: number) => number
): string {
  return values
    .map((v, i) => (v === null ? null : `${xAtTime(timestamps[i]).toFixed(1)},${scaleY(v, domainMin, domainMax).toFixed(1)}`))
    .filter((p): p is string => p !== null)
    .join(" ");
}

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatDayLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// Default view: the most recent week (7 calendar days) that contains data.
function computeInitialWindowStart(vitals: VitalRow[]): number {
  const latestTs = vitals[vitals.length - 1].timestamp;
  return startOfDay(latestTs) + DAY_MS - WEEK_MS;
}

function CombinedVitalsChart({ vitals, windowStart }: { vitals: VitalRow[]; windowStart: number }) {
  const windowEnd = windowStart + WEEK_MS;
  const visible = vitals.filter((v) => v.timestamp >= windowStart && v.timestamp <= windowEnd);
  const timestamps = visible.map((v) => v.timestamp);
  const values: Record<VitalKey, (number | null)[]> = {
    temperature: visible.map((v) => v.temperature),
    systolicBp: visible.map((v) => v.systolicBp),
    diastolicBp: visible.map((v) => v.diastolicBp),
    pulse: visible.map((v) => v.pulse),
    spo2: visible.map((v) => v.spo2),
    respRate: visible.map((v) => v.respRate),
  };

  // Fixed calendar scale: exactly one week always spans the plot width,
  // regardless of how many (or how few) points fall inside it.
  const plotWidth = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
  const xAtTime = (ts: number) => PAD_LEFT + ((ts - windowStart) / WEEK_MS) * plotWidth;
  const dayTicks = Array.from({ length: 8 }, (_, i) => windowStart + i * DAY_MS);

  const legendItems = AXES.flatMap((a) => a.series);
  const legendItemW = CHART_WIDTH / legendItems.length;
  const plotTop = LEGEND_HEIGHT;
  const plotBottom = LEGEND_HEIGHT + PLOT_HEIGHT;

  return (
    <div className="chart-mock" style={{ height: CHART_HEIGHT }}>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none">
        {/* legend */}
        {legendItems.map((s, i) => {
          const x = 6 + i * legendItemW;
          return (
            <g key={s.key}>
              <line x1={x} y1={12} x2={x + 14} y2={12} stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 2" : undefined} />
              <text x={x + 18} y={12} fontSize="10" fill="var(--ink-soft)" dominantBaseline="middle">
                {s.label}
              </text>
            </g>
          );
        })}

        {/* day gridlines */}
        {dayTicks.map((ts, i) => (
          <line key={`vg-${i}`} x1={xAtTime(ts)} y1={plotTop} x2={xAtTime(ts)} y2={plotBottom} stroke="var(--line-soft)" strokeWidth="1" />
        ))}

        {/* plot baseline */}
        <line x1={PAD_LEFT} y1={plotBottom} x2={CHART_WIDTH - PAD_RIGHT} y2={plotBottom} stroke="var(--line)" strokeWidth="1" />

        {/* axes: line, ticks, tick labels */}
        {AXES.map((axis) => {
          const lineX = axisLineX(axis);
          const [domainMin, domainMax] = axis.domain;
          const ticks = [domainMin, (domainMin + domainMax) / 2, domainMax];
          const outward = axis.side === "left" ? -1 : 1;
          return (
            <g key={axis.id}>
              <line x1={lineX} y1={plotTop} x2={lineX} y2={plotBottom} stroke={axis.color} strokeWidth="1.2" opacity="0.85" />
              {ticks.map((t, idx) => {
                const y = scaleY(t, domainMin, domainMax);
                return (
                  <g key={idx}>
                    <line x1={lineX} y1={y} x2={lineX + outward * TICK_LEN} y2={y} stroke={axis.color} strokeWidth="1.2" />
                    <text
                      x={lineX + outward * (TICK_LEN + 3)}
                      y={y}
                      fontSize="9"
                      fill={axis.color}
                      textAnchor={axis.side === "left" ? "end" : "start"}
                      dominantBaseline="middle"
                    >
                      {formatTick(t)}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* reference line(s) */}
        {AXES.filter((a) => a.reference).map((axis) => {
          const ref = axis.reference!;
          const y = scaleY(ref.value, axis.domain[0], axis.domain[1]);
          return (
            <g key={`ref-${axis.id}`}>
              <line
                x1={PAD_LEFT}
                y1={y}
                x2={CHART_WIDTH - PAD_RIGHT}
                y2={y}
                stroke={axis.color}
                strokeWidth="1"
                strokeDasharray="4 3"
                opacity="0.55"
              />
              <text x={CHART_WIDTH - PAD_RIGHT - 4} y={y - 3} fontSize="9" fill={axis.color} textAnchor="end" opacity="0.8">
                {ref.label}
              </text>
            </g>
          );
        })}

        {/* data lines + points */}
        {AXES.map((axis) =>
          axis.series.map((s) => {
            const vals = values[s.key];
            const points = buildLine(timestamps, vals, axis.domain[0], axis.domain[1], xAtTime);
            return (
              <g key={s.key}>
                {points && (
                  <polyline points={points} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "5 3" : undefined} />
                )}
                {vals.map((v, i) =>
                  v === null ? null : (
                    <circle key={i} cx={xAtTime(timestamps[i])} cy={scaleY(v, axis.domain[0], axis.domain[1])} r="2.2" fill={s.color} />
                  )
                )}
              </g>
            );
          })
        )}

        {/* day boundary labels */}
        {dayTicks.map((ts, i) => {
          const anchor = i === 0 ? "start" : i === dayTicks.length - 1 ? "end" : "middle";
          return (
            <text key={`xl-${i}`} x={xAtTime(ts)} y={plotBottom + 13} fontSize="9" fill="var(--ink-soft)" textAnchor={anchor}>
              {formatDayLabel(ts)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export function VitalsView({ vitals }: { vitals: VitalRow[] }) {
  const hasVitals = vitals.length > 0;
  const [windowStart, setWindowStart] = useState<number>(() => (hasVitals ? computeInitialWindowStart(vitals) : 0));

  const earliestDayStart = hasVitals ? startOfDay(vitals[0].timestamp) : 0;
  const latestDayEnd = hasVitals ? startOfDay(vitals[vitals.length - 1].timestamp) + DAY_MS : 0;
  const canGoPrev = hasVitals && windowStart > earliestDayStart;
  const canGoNext = hasVitals && windowStart + WEEK_MS < latestDayEnd;
  const rangeLabel = `${formatDayLabel(windowStart)} 〜 ${formatDayLabel(windowStart + WEEK_MS - DAY_MS)}`;

  return (
    <div className="card">
      <div className="card-h">
        バイタルサイン推移
        {hasVitals && (
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400 }}>
            <button
              type="button"
              className="btn ghost"
              style={{ fontSize: 11, opacity: canGoPrev ? 1 : 0.35, cursor: canGoPrev ? "pointer" : "default" }}
              disabled={!canGoPrev}
              onClick={() => setWindowStart((w) => w - WEEK_MS)}
            >
              ← 前週
            </button>
            <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{rangeLabel}</span>
            <button
              type="button"
              className="btn ghost"
              style={{ fontSize: 11, opacity: canGoNext ? 1 : 0.35, cursor: canGoNext ? "pointer" : "default" }}
              disabled={!canGoNext}
              onClick={() => setWindowStart((w) => w + WEEK_MS)}
            >
              次週 →
            </button>
          </span>
        )}
      </div>
      <div className="card-b">
        {!hasVitals ? (
          <div className="empty-note">バイタルの記録はまだありません。</div>
        ) : (
          <>
            <CombinedVitalsChart vitals={vitals} windowStart={windowStart} />
            <table style={{ marginTop: 14 }}>
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
                {[...vitals].reverse().map((v) => (
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
          </>
        )}
      </div>
    </div>
  );
}
