export const VITAL_FIELDS = [
  { key: "temperature", label: "体温", unit: "°C", step: "0.1" },
  { key: "systolicBp", label: "収縮期血圧", unit: "mmHg", step: "1" },
  { key: "diastolicBp", label: "拡張期血圧", unit: "mmHg", step: "1" },
  { key: "pulse", label: "脈拍", unit: "/分", step: "1" },
  { key: "spo2", label: "SpO2", unit: "%", step: "1" },
  { key: "respRate", label: "呼吸数", unit: "/分", step: "1" },
] as const;
