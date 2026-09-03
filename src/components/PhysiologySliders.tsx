"use client";

import { useState } from "react";
import {
  sliderToSeverityLabel,
  sliderToSpeedLabel,
  sliderToSpo2,
  sliderToTemp,
  type PhysiologyParams,
} from "@/lib/physiology";

export function PhysiologySliders({
  initial,
  onChange,
  namePrefix = "",
}: {
  initial: PhysiologyParams;
  onChange?: (values: PhysiologyParams) => void;
  // 症例作成フォームのように1つの<form>内に疾患ごとのスライダーを複数並べる場合、
  // FormDataのフィールド名が衝突しないよう疾患ごとに異なるprefixを渡す（例: `tpl_${templateId}_`）。
  namePrefix?: string;
}) {
  const [values, setValues] = useState(initial);

  function update(patch: Partial<PhysiologyParams>) {
    const next = { ...values, ...patch };
    setValues(next);
    onChange?.(next);
  }

  return (
    <>
      <div className="param-row">
        <div className="lab">体温 初期値</div>
        <input
          type="range"
          min={0}
          max={100}
          name={`${namePrefix}initialTempSlider`}
          value={values.initialTempSlider}
          onChange={(e) => update({ initialTempSlider: Number(e.target.value) })}
        />
        <div className="val">{sliderToTemp(values.initialTempSlider)}℃</div>
      </div>
      <div className="param-row">
        <div className="lab">改善速度（治療反応性）</div>
        <input
          type="range"
          min={0}
          max={100}
          name={`${namePrefix}improvementSpeedSlider`}
          value={values.improvementSpeedSlider}
          onChange={(e) => update({ improvementSpeedSlider: Number(e.target.value) })}
        />
        <div className="val">{sliderToSpeedLabel(values.improvementSpeedSlider)}</div>
      </div>
      <div className="param-row">
        <div className="lab">SpO2 初期値</div>
        <input
          type="range"
          min={0}
          max={100}
          name={`${namePrefix}initialSpo2Slider`}
          value={values.initialSpo2Slider}
          onChange={(e) => update({ initialSpo2Slider: Number(e.target.value) })}
        />
        <div className="val">{sliderToSpo2(values.initialSpo2Slider)}%</div>
      </div>
      <div className="param-row">
        <div className="lab">重症度</div>
        <input
          type="range"
          min={0}
          max={100}
          name={`${namePrefix}severitySlider`}
          value={values.severitySlider}
          onChange={(e) => update({ severitySlider: Number(e.target.value) })}
        />
        <div className="val">{sliderToSeverityLabel(values.severitySlider)}</div>
      </div>
    </>
  );
}
