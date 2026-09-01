export type VitalRow = {
  id: string;
  time: string;
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
const MAX_X_LABELS = 10;
const TICK_LEN = 4;

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

function xAt(i: number, n: number): number {
  if (n <= 1) return PAD_LEFT + (CHART_WIDTH - PAD_LEFT - PAD_RIGHT) / 2;
  return PAD_LEFT + (i / (n - 1)) * (CHART_WIDTH - PAD_LEFT - PAD_RIGHT);
}

function buildLine(values: (number | null)[], domainMin: number, domainMax: number): string {
  const n = values.length;
  return values
    .map((v, i) => (v === null ? null : `${xAt(i, n).toFixed(1)},${scaleY(v, domainMin, domainMax).toFixed(1)}`))
    .filter((p): p is string => p !== null)
    .join(" ");
}

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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

function CombinedVitalsChart({ times, values }: { times: string[]; values: Record<VitalKey, (number | null)[]> }) {
  const n = times.length;
  const xLabels = labeledIndices(n);
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

        {/* vertical time gridlines */}
        {xLabels.map((i) => (
          <line key={`vg-${i}`} x1={xAt(i, n)} y1={plotTop} x2={xAt(i, n)} y2={plotBottom} stroke="var(--line-soft)" strokeWidth="1" />
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
            const points = buildLine(vals, axis.domain[0], axis.domain[1]);
            return (
              <g key={s.key}>
                {points && (
                  <polyline points={points} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "5 3" : undefined} />
                )}
                {vals.map((v, i) =>
                  v === null ? null : (
                    <circle key={i} cx={xAt(i, n)} cy={scaleY(v, axis.domain[0], axis.domain[1])} r="2.2" fill={s.color} />
                  )
                )}
              </g>
            );
          })
        )}

        {/* x-axis time labels */}
        {xLabels.map((i) => {
          const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
          return (
            <text key={`xl-${i}`} x={xAt(i, n)} y={plotBottom + 13} fontSize="9" fill="var(--ink-soft)" textAnchor={anchor}>
              {times[i]}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export function VitalsView({ vitals }: { vitals: VitalRow[] }) {
  const times = vitals.map((v) => v.time);
  const values: Record<VitalKey, (number | null)[]> = {
    temperature: vitals.map((v) => v.temperature),
    systolicBp: vitals.map((v) => v.systolicBp),
    diastolicBp: vitals.map((v) => v.diastolicBp),
    pulse: vitals.map((v) => v.pulse),
    spo2: vitals.map((v) => v.spo2),
    respRate: vitals.map((v) => v.respRate),
  };

  return (
    <div className="card">
      <div className="card-h">バイタルサイン推移</div>
      <div className="card-b">
        {vitals.length === 0 ? (
          <div className="empty-note">バイタルの記録はまだありません。</div>
        ) : (
          <>
            <CombinedVitalsChart times={times} values={values} />
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
