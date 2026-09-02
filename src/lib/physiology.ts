export type PhysiologyParams = {
  initialTempSlider: number; // 0-100
  improvementSpeedSlider: number; // 0-100
  initialSpo2Slider: number; // 0-100
  severitySlider: number; // 0-100
};

export const DEFAULT_PHYSIOLOGY_PARAMS: PhysiologyParams = {
  initialTempSlider: 50,
  improvementSpeedSlider: 50,
  initialSpo2Slider: 50,
  severitySlider: 50,
};

export function sliderToTemp(slider: number): number {
  return Math.round((36.0 + (slider / 100) * 4.5) * 10) / 10;
}

export function sliderToSpo2(slider: number): number {
  return Math.round(100 - (slider / 100) * 20);
}

export function sliderToSpeedLabel(slider: number): string {
  if (slider < 34) return "低速";
  if (slider < 67) return "中速";
  return "高速";
}

export function sliderToSeverityLabel(slider: number): string {
  if (slider < 34) return "軽症";
  if (slider < 67) return "中等症";
  return "重症";
}

