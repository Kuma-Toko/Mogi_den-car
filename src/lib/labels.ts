import type { CaseType, OrderStatus, OrderType, Role } from "@prisma/client";

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

export const orderTypeLabel: Record<OrderType, string> = {
  LAB: "検査",
  MEDICATION: "処方",
  INJECTION: "注射・点滴",
  GENERAL: "一般指示",
};

export const orderTypeOrderLabel: Record<OrderType, string> = {
  LAB: "検査オーダー",
  MEDICATION: "処方オーダー",
  INJECTION: "注射オーダー",
  GENERAL: "一般指示オーダー",
};

export const orderStatusLabel: Record<OrderStatus, string> = {
  ORDERED: "オーダー済",
  RESULT_PENDING: "結果待ち",
  RESULT_AVAILABLE: "結果あり",
  ADMINISTERED: "実施済",
  ACTIVE: "有効",
  DISCONTINUED: "中止",
};

export const orderStatusBadgeClass: Record<OrderStatus, string> = {
  ORDERED: "blue",
  RESULT_PENDING: "amber",
  RESULT_AVAILABLE: "red",
  ADMINISTERED: "teal",
  ACTIVE: "teal",
  DISCONTINUED: "amber",
};

export const auditActionLabel: Record<string, string> = {
  login: "ログイン",
  soap_save: "SOAP記載を保存",
  order_create: "オーダーを発行",
  advance_sim_time: "シミュレーション時間を進行",
  case_join: "症例プールに参加",
  case_publish: "症例を公開",
  case_draft_save: "症例を下書き保存",
  master_drug_create: "薬剤マスターを登録",
  master_drug_update: "薬剤マスターを更新",
  master_drug_delete: "薬剤マスターを削除",
  master_lab_item_create: "検査項目マスターを登録",
  master_lab_item_update: "検査項目マスターを更新",
  master_lab_item_delete: "検査項目マスターを削除",
  master_template_create: "病態テンプレートを登録",
  master_template_update: "病態テンプレートを更新",
  master_template_delete: "病態テンプレートを削除",
};

export const auditTargetTypeLabel: Record<string, string> = {
  Case: "症例",
  DrugMaster: "薬剤マスター",
  LabItemMaster: "検査項目マスター",
  DiseaseTemplate: "病態テンプレート",
};
