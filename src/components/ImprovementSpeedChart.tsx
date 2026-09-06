"use client";

import { useMemo } from "react";
import { severityDecayAt, severityHalfLifeHours } from "@/lib/physiology-engine";

const CHART_WIDTH = 460;
const CHART_HEIGHT = 160;
const PAD_LEFT = 30;
const PAD_RIGHT = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 20;
const HOURS_MAX = 48;
const START_SEVERITY = 100; // 改善速度そのものを比較しやすいよう、常に最重症(100)からの推移を描く

function x(hour: number): number {
  return PAD_LEFT + (hour / HOURS_MAX) * (CHART_WIDTH - PAD_LEFT - PAD_RIGHT);
}
function y(severity: number): number {
  return PAD_TOP + (1 - severity / 100) * (CHART_HEIGHT - PAD_TOP - PAD_BOTTOM);
}
function buildCurve(slider: number): string {
  const points: string[] = [];
  for (let h = 0; h <= HOURS_MAX; h += 1) {
    points.push(`${x(h).toFixed(1)},${y(severityDecayAt(START_SEVERITY, slider, h)).toFixed(1)}`);
  }
  return points.join(" ");
}

export function ImprovementSpeedChart({ slider, savedSlider }: { slider: number; savedSlider: number }) {
  const dirty = slider !== savedSlider;
  const previewCurve = useMemo(() => buildCurve(slider), [slider]);
  const savedCurve = useMemo(() => buildCurve(savedSlider), [savedSlider]);
  const halfLife = severityHalfLifeHours(slider);

  return (
    <div style={{ marginBottom: 10 }}>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} style={{ width: "100%", maxWidth: CHART_WIDTH, display: "block" }}>
        {[0, 25, 50, 75, 100].map((s) => (
          <g key={s}>
            <line x1={PAD_LEFT} y1={y(s)} x2={CHART_WIDTH - PAD_RIGHT} y2={y(s)} stroke="var(--line-soft)" strokeWidth="1" />
            <text x={PAD_LEFT - 4} y={y(s) + 3} textAnchor="end" fontSize="9" fill="var(--ink-soft)">
              {s}
            </text>
          </g>
        ))}
        {[0, 12, 24, 36, 48].map((h) => (
          <text key={h} x={x(h)} y={CHART_HEIGHT - 4} textAnchor="middle" fontSize="9" fill="var(--ink-soft)">
            {h}h
          </text>
        ))}
        <line x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={CHART_HEIGHT - PAD_BOTTOM} stroke="var(--line)" strokeWidth="1" />
        {dirty && <polyline points={savedCurve} fill="none" stroke="var(--ink-soft)" strokeWidth="1.5" strokeDasharray="4 3" />}
        <polyline points={previewCurve} fill="none" stroke="var(--teal)" strokeWidth="2.5" />
      </svg>
      <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 4 }}>
        横軸: 治療開始からの経過時間 / 縦軸: 重症度（100から治療開始した場合の推移）
        {dirty && <span> ・ 破線＝現在保存されている設定</span>}
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>
        半減期 約{halfLife.toFixed(1)}時間（治療開始後、重症度が半分になるまでの目安）
      </div>
    </div>
  );
}
