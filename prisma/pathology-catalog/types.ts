// 病態モデルの正本（prisma/data/pathology-catalog/*.json）の型定義。
// apply-engine-config.ts / export-engine-config.ts / verify-engine-config.ts / validate-pathology-catalog.ts
// が共通で参照する。JSON側は「素のオブジェクト」で持ち、DB列（treatmentConfig/vitalsConfig等のJSON文字列化）
// への変換はapply側の責務とする（カタログの可読性・レビュー容易性を優先するため）。

export type VitalPointFull = {
  temperature: number;
  systolicBp: number;
  diastolicBp: number;
  pulse: number;
  spo2: number;
  respRate: number;
};

export type PhysiologyParamsCatalog = {
  initialTempSlider: number;
  improvementSpeedSlider: number;
  initialSpo2Slider: number;
  severitySlider: number;
};

// drugCategories/procedureKeywordsの各要素は"大分類"または"大分類/系統"（系統まで指定すると
// physiology-engine.tsのfindTreatmentStartOrderがmajorCategory+subCategory両方の一致を要求する）。
export type TreatmentCatalog = {
  drugCategories?: string[];
  procedureKeywords?: string[];
};

export type LabPatternValueCatalog = { label: string; value: number; unit: string; note?: string | null };

export type LabPatternCatalog =
  | { labItemCode: string; kind: "text"; tiers: { mild: string; moderate: string; severe: string } }
  | { labItemCode: string; kind: "values"; tiers: { mild: LabPatternValueCatalog[]; moderate: LabPatternValueCatalog[]; severe: LabPatternValueCatalog[] } };

export type CrisisTriggerCatalog =
  | { type: "severity"; op: ">=" | "<="; value: number }
  | { type: "lab"; code: string; label?: string; op: ">=" | "<="; value: number }
  | { type: "vital"; field: keyof VitalPointFull; op: ">=" | "<="; value: number };

export type CrisisTriggerScenarioCatalog = {
  targetKey: string; // isCrisisPathology=trueの別テンプレートのkey
  sustainMinutes: number;
  triggers: CrisisTriggerCatalog[]; // OR判定
};

export type CrisisRescueActionCatalog = {
  label: string;
  drugCategories?: string[];
  procedureKeywords?: string[];
};

export type CrisisRescueCatalog = {
  postRescueSeverity: number;
  actions: CrisisRescueActionCatalog[]; // OR判定
};

export type PathologyTemplateCatalog = {
  key: string;
  name: string;
  description: string | null;
  category: string; // 臓器系分類（一覧・症例作成フォームのグループ見出し）
  sortOrder: number;
  isInfectious?: boolean;
  isCrisisPathology?: boolean;
  defaultParams: PhysiologyParamsCatalog;
  treatment: TreatmentCatalog;
  vitalsPerSeverity: VitalPointFull;
  aiEvaluationGuideline: string | null;
  labPatterns: LabPatternCatalog[];
  crisisTriggers?: CrisisTriggerScenarioCatalog[];
  crisisRescue?: CrisisRescueCatalog | null;
};

import type { CatalogCategory } from "../../src/lib/pathology-categories";
export { CATEGORY_ORDER, type CatalogCategory } from "../../src/lib/pathology-categories";

// カテゴリファイル名の対応（prisma/data/pathology-catalog/配下）
export const CATEGORY_FILE_MAP: Record<CatalogCategory, string> = {
  循環器: "cardiovascular.json",
  呼吸器: "respiratory.json",
  消化器: "gastrointestinal.json",
  "腎・電解質": "renal.json",
  "内分泌・代謝": "endocrine.json",
  神経: "neuro.json",
  "感染症・全身": "infectious.json",
  "血液・腫瘍": "hematology.json",
  "救急・中毒・環境": "emergency.json",
  "外傷・外科": "trauma.json",
  "産婦人科・小児": "obgyn_peds.json",
  急変: "crisis.json",
};
