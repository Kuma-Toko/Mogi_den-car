// 信頼境界をまたぐ値のためのzodスキーマ集。対象は2種類:
//   1. DBに保存されたJSON文字列（管理画面の手入力やTurso手動同期を経由するため、構造が保証されない）
//   2. クライアントからServer Actionへ渡される構造化引数（FormDataではなく直接オブジェクトとして届くため
//      TypeScriptの型はコンパイル時の建前に過ぎず、実行時には任意の値が届きうる）
// 失敗時にthrowするのではなく、呼び出し側の既存パターン（安全な既定値へフォールバック／
// ?error=で差し戻す）に合流させることを意図している。
import { z } from "zod";

// ── DiseaseTemplate.treatmentConfig / vitalsConfig（physiology-engine.tsの型と対応） ──────────

const vitalPointSchema = z.object({
  temperature: z.number(),
  systolicBp: z.number(),
  diastolicBp: z.number(),
  pulse: z.number(),
  spo2: z.number(),
  respRate: z.number(),
});

export const vitalCoefficientsSchema = z.object({
  perSeverity: vitalPointSchema,
});

export const treatmentTriggerSchema = z.object({
  drugCategories: z.array(z.string()).optional(),
  procedureKeywords: z.array(z.string()).optional(),
});

// ── submitOrderBatch(caseId, items: CartItem[]) ─────────────────────────────────────────────
// actions.tsのCartItem型と1対1で対応させる。自由入力欄には長さ上限を、配列には件数上限を設ける。

const TEXT = z.string().max(2000);
const SHORT_TEXT = z.string().max(200);

const rpDrugLineSchema = z.object({
  drugId: z.string().min(1),
  label: SHORT_TEXT,
  note: TEXT,
  count: SHORT_TEXT,
});

const imagingContextSchema = z.object({
  chiefComplaint: TEXT,
  findings: TEXT,
  purpose: TEXT,
  needsInterpretation: z.boolean(),
  mriSequences: z.array(SHORT_TEXT).max(20).optional(),
});

const cartItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("LAB"),
    labItemId: z.string().min(1),
    label: SHORT_TEXT,
    imaging: imagingContextSchema.optional(),
  }),
  z.object({
    kind: z.literal("MEDICATION_RP"),
    drugs: z.array(rpDrugLineSchema).min(1).max(20),
    instruction: TEXT,
    dosingType: z.enum(["定期", "頓用"]),
    duration: SHORT_TEXT,
    comment: TEXT,
  }),
  z.object({
    kind: z.literal("INJECTION_RP"),
    drugs: z.array(rpDrugLineSchema).min(1).max(20),
    administrationType: z.enum(["単回静注", "持続点滴"]),
    rate: SHORT_TEXT,
    startTime: SHORT_TEXT,
    comment: TEXT,
  }),
  z.object({ kind: z.literal("GENERAL"), category: SHORT_TEXT, selection: SHORT_TEXT, comment: TEXT }),
  z.object({ kind: z.literal("PROCEDURE"), category: SHORT_TEXT, selection: SHORT_TEXT, comment: TEXT }),
]);

export const cartItemsSchema = z.array(cartItemSchema).min(1).max(50);

// ── updateDrugOrderRp(caseId, rpGroupId, payload: UpdateDrugOrderRpPayload) ─────────────────

const updateRpLinePayloadSchema = z.object({
  orderId: z.string().min(1),
  countQty: SHORT_TEXT,
  countUnit: SHORT_TEXT,
  note: TEXT,
});

export const updateDrugOrderRpPayloadSchema = z.discriminatedUnion("orderType", [
  z.object({
    orderType: z.literal("MEDICATION"),
    instruction: TEXT,
    dosingType: z.enum(["定期", "頓用"]),
    duration: SHORT_TEXT,
    comment: TEXT,
    lines: z.array(updateRpLinePayloadSchema).min(1).max(20),
  }),
  z.object({
    orderType: z.literal("INJECTION"),
    administrationType: z.enum(["単回静注", "持続点滴"]),
    rate: SHORT_TEXT,
    startTime: SHORT_TEXT,
    comment: TEXT,
    lines: z.array(updateRpLinePayloadSchema).min(1).max(20),
  }),
]);

// ── advanceSimTime(caseId, hours) ───────────────────────────────────────────────────────────
// Server Actionはクライアントの<SimTimeControl>のプリセット値をバイパスして直接呼び出せるため、
// 符号・NaN・上限をサーバー側で必ず検証する。1週間分を超える一度の時間送りは想定外として拒否する。
export const advanceSimHoursSchema = z.number().finite().positive().max(168);

// ── teacher/cases/actions.ts の症例フォーム ─────────────────────────────────────────────────
export const caseTypeSchema = z.enum(["SIMULATION", "ROUTINE_COMMON", "ROUTINE_PATIENT"]);
export const patientGenderSchema = z.enum(["男性", "女性"]);

// 年齢: 0〜120歳の整数にクランプする。NaN・負数・小数はフォーム側の入力ミスとして0点に丸めず弾く。
export function clampPatientAge(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.min(120, Math.max(0, Math.round(raw)));
}

// スライダー系(0〜100): NaNをそのまま持ち回ると重症度カーブ全体がNaN化するため、ここで必ず数値に丸める。
export function clampSlider0to100(raw: number, fallback = 50): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

// admin/templates/actions.ts のバイタル係数入力(VitalPoint各フィールド)向け。NaNのままDBのFloat/Int
// 列へ渡すとPrisma/libSQLが不定な形でエラーになる、または不正な値が永続化されるため0へフォールバックする。
export function finiteOrZero(raw: number): number {
  return Number.isFinite(raw) ? raw : 0;
}
