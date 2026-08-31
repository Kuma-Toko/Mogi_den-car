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

const CHART_WIDTH = 600;
const CHART_HEIGHT = 160;
const PAD_X = 20;

function scale(value: number, domainMin: number, domainMax: number): number {
  const clamped = Math.min(domainMax, Math.max(domainMin, value));
  const ratio = (clamped - domainMin) / (domainMax - domainMin);
  return CHART_HEIGHT - 16 - ratio * (CHART_HEIGHT - 32);
}

function buildPoints(values: (number | null)[], domainMin: number, domainMax: number): string {
  const n = values.length;
  return values
    .map((v, i) => {
      if (v === null) return null;
      const x = n <= 1 ? CHART_WIDTH / 2 : PAD_X + (i / (n - 1)) * (CHART_WIDTH - PAD_X * 2);
      const y = scale(v, domainMin, domainMax);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter((p): p is string => p !== null)
    .join(" ");
}

export function VitalsView({ vitals }: { vitals: VitalRow[] }) {
  const tempPoints = buildPoints(
    vitals.map((v) => v.temperature),
    35,
    40
  );
  const spo2Points = buildPoints(
    vitals.map((v) => v.spo2),
    85,
    100
  );

  return (
    <div className="card">
      <div className="card-h">バイタルサイン推移</div>
      <div className="card-b">
        {vitals.length === 0 ? (
          <div className="empty-note">バイタルの記録はまだありません。</div>
        ) : (
          <>
            <div className="chart-mock" style={{ height: CHART_HEIGHT }}>
              <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none">
                <line x1="0" y1={CHART_HEIGHT * 0.25} x2={CHART_WIDTH} y2={CHART_HEIGHT * 0.25} stroke="#e8edee" />
                <line x1="0" y1={CHART_HEIGHT * 0.5} x2={CHART_WIDTH} y2={CHART_HEIGHT * 0.5} stroke="#e8edee" />
                <line x1="0" y1={CHART_HEIGHT * 0.75} x2={CHART_WIDTH} y2={CHART_HEIGHT * 0.75} stroke="#e8edee" />
                {tempPoints && <polyline points={tempPoints} fill="none" stroke="#a23b34" strokeWidth="2.5" />}
                {spo2Points && <polyline points={spo2Points} fill="none" stroke="#1f6f66" strokeWidth="2.5" />}
                <text x={CHART_WIDTH - 72} y={CHART_HEIGHT * 0.5 - 8} fontSize="10" fill="#a23b34">
                  体温
                </text>
                <text x={CHART_WIDTH - 72} y={CHART_HEIGHT * 0.25 - 8} fontSize="10" fill="#1f6f66">
                  SpO2
                </text>
              </svg>
            </div>
            <table style={{ marginTop: 10 }}>
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
