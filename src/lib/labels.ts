import type { CaseType, KarteEntryType, OrderStatus, OrderType, Role } from "@prisma/client";

export const roleLabel: Record<Role, string> = {
  STUDENT: "学生",
  TEACHER: "教員",
  ADMIN: "管理者",
};

export const caseTypeLabel: Record<CaseType, string> = {
  SIMULATION: "シミュレーション用",
  ROUTINE_COMMON: "実習常時利用（共通プール）",
  ROUTINE_PATIENT: "実習常時利用（実患者ベース）",
};

export const karteEntryTypeLabel: Record<KarteEntryType, string> = {
  SOAP: "SOAP",
  NARRATIVE: "フリー記載",
  REFERRAL: "紹介状（診療情報提供書）",
  AMBULANCE: "救急搬送記録",
};

export const karteEntryTypeBadgeClass: Record<KarteEntryType, string> = {
  SOAP: "teal",
  NARRATIVE: "blue",
  REFERRAL: "amber",
  AMBULANCE: "red",
};

export const orderTypeLabel: Record<OrderType, string> = {
  LAB: "検査",
  IMAGING: "画像検査",
  MEDICATION: "処方",
  INJECTION: "注射・点滴",
  GENERAL: "一般指示",
  PROCEDURE: "処置・手術",
};

export const orderTypeOrderLabel: Record<OrderType, string> = {
  LAB: "検査オーダー",
  IMAGING: "画像検査オーダー",
  MEDICATION: "処方オーダー",
  INJECTION: "注射オーダー",
  GENERAL: "一般指示オーダー",
  PROCEDURE: "処置・手術オーダー",
};

export const orderStatusLabel: Record<OrderStatus, string> = {
  ORDERED: "オーダー済",
  RESULT_PENDING: "結果待ち",
  RESULT_PRELIMINARY: "速報結果あり",
  RESULT_AVAILABLE: "結果あり",
  ADMINISTERED: "実施済",
  ACTIVE: "有効",
  DISCONTINUED: "中止",
};

export const orderStatusBadgeClass: Record<OrderStatus, string> = {
  ORDERED: "blue",
  RESULT_PENDING: "amber",
  RESULT_PRELIMINARY: "blue",
  RESULT_AVAILABLE: "red",
  ADMINISTERED: "teal",
  ACTIVE: "teal",
  DISCONTINUED: "amber",
};

export const auditActionLabel: Record<string, string> = {
  login: "ログイン",
  soap_save: "SOAP記載を保存",
  karte_entry_save: "カルテ記載を保存",
  order_create: "オーダーを発行",
  advance_sim_time: "シミュレーション時間を進行",
  case_join: "症例プールに参加",
  case_publish: "症例を公開",
  case_draft_save: "症例を下書き保存",
  case_edit: "症例を編集",
  case_delete: "症例を削除",
  master_drug_create: "薬剤マスターを登録",
  master_drug_update: "薬剤マスターを更新",
  master_drug_delete: "薬剤マスターを削除",
  master_lab_item_create: "検査項目マスターを登録",
  master_lab_item_update: "検査項目マスターを更新",
  master_lab_item_delete: "検査項目マスターを削除",
  master_template_create: "病態テンプレートを登録",
  master_template_update: "病態テンプレートを更新",
  master_template_delete: "病態テンプレートを削除",
  auto_discontinue_prescription: "処方を自動中止（日数超過）",
  order_edit_rp: "処方・注射オーダーを編集",
  discontinue_order: "オーダーを中止",
  crisis_onset: "【急変】発生",
  crisis_rescue: "【急変】救命処置により安定化",
  case_deceased: "【死亡確認】",
  order_result_preliminary: "検査の速報結果を開示",
  order_result_available: "検査の確定結果を開示",
  case_discharge: "患者を退院させる",
  case_readmit: "患者を再入院させる",
  case_disease_delete: "症例の病態を削除",
  case_disease_severity_override: "症例の病態重症度を手動設定",
  encounter_message: "問診・診察メッセージを送信",
  drug_alias_create: "薬剤の別名（エイリアス）を登録",
  drug_alias_delete: "薬剤の別名（エイリアス）を削除",
  master_drug_effect_rule_create: "薬効ルールを登録",
  master_drug_effect_rule_update: "薬効ルールを更新",
  master_drug_effect_rule_delete: "薬効ルールを削除",
  master_lab_pattern_create: "検査所見パターンを登録",
  master_lab_pattern_update: "検査所見パターンを更新",
  master_lab_pattern_delete: "検査所見パターンを削除",
  master_lab_pattern_value_create: "検査所見パターン値を登録",
  master_lab_pattern_value_update: "検査所見パターン値を更新",
  master_lab_pattern_value_delete: "検査所見パターン値を削除",
  master_pathogen_create: "病原体マスターを登録",
  master_pathogen_update: "病原体マスターを更新",
  master_pathogen_delete: "病原体マスターを削除",
  master_pathogen_susceptibility_create: "病原体の薬剤感受性を登録",
  master_pathogen_susceptibility_update: "病原体の薬剤感受性を更新",
  master_pathogen_susceptibility_delete: "病原体の薬剤感受性を削除",
  master_crisis_trigger_create: "急変トリガーを登録",
  master_crisis_trigger_update: "急変トリガーを更新",
  master_crisis_trigger_delete: "急変トリガーを削除",
  master_crisis_trigger_scenario_create: "急変シナリオを登録",
  master_crisis_trigger_scenario_update: "急変シナリオを更新",
  master_crisis_trigger_scenario_delete: "急変シナリオを削除",
  master_crisis_rescue_config_create: "急変救命設定を登録",
  master_crisis_rescue_config_update: "急変救命設定を更新",
  master_crisis_rescue_config_delete: "急変救命設定を削除",
  master_crisis_rescue_action_create: "急変救命アクションを登録",
  master_crisis_rescue_action_update: "急変救命アクションを更新",
  master_crisis_rescue_action_delete: "急変救命アクションを削除",
  master_physiology_baseline_band_create: "生理値基準帯を登録",
  master_physiology_baseline_band_update: "生理値基準帯を更新",
  master_physiology_baseline_band_delete: "生理値基準帯を削除",
  master_base_physiology_update: "基礎生理モデルを更新",
  master_template_engine_config_update: "病態テンプレートのエンジン設定を更新",
  master_ai_evaluation_guideline_update: "AI評価ガイドラインを更新",
};

export const auditTargetTypeLabel: Record<string, string> = {
  Case: "症例",
  Order: "オーダー",
  DrugMaster: "薬剤マスター",
  LabItemMaster: "検査項目マスター",
  DiseaseTemplate: "病態テンプレート",
  CaseDiseaseLink: "症例の病態",
  DrugAlias: "薬剤の別名（エイリアス）",
  DrugEffectRule: "薬効ルール",
  TemplateLabPattern: "検査所見パターン",
  TemplateLabPatternValue: "検査所見パターン値",
  PathogenMaster: "病原体マスター",
  PathogenSusceptibility: "病原体の薬剤感受性",
  CrisisTriggerRow: "急変トリガー",
  TemplateCrisisScenario: "急変シナリオ",
  CrisisRescueConfig: "急変救命設定",
  CrisisRescueActionRow: "急変救命アクション",
  PhysiologyBaselineBand: "生理値基準帯",
  BasePhysiologyModel: "基礎生理モデル",
};
