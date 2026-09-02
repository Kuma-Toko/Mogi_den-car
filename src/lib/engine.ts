import "server-only";
import { db } from "@/lib/db";
import type { Case, DiseaseTemplate, LabItemMaster, OrderType } from "@prisma/client";
import {
  computeCaseSeverityAtTime,
  computeVitalsForSeverity,
  evaluateCrisisTriggers,
  findActiveOxygenBoost,
  findCrisisRescueAt,
  getCaseClockNow,
  getTemplateConfig,
  parsePhysiologyParams,
  resolveDynamicLab,
} from "@/lib/physiology-engine";
import { formatLabValues, type LabValue } from "@/lib/lab-reference-ranges";

const DEFAULT_RESULT_TEXT = "結果は基準範囲内です。";
const DELAYED_RESULT_DELAY_MS = 2 * 3_600_000; // 遅延型オーダーの結果反映までの固定遅延（簡易実装。症例の時計＝実時間 or シミュレーション時間で解釈）
const SNAPSHOT_INTERVAL_HOURS = 4; // バイタルの自動記録間隔（実時間 or シミュレーション時間）
const MAX_SNAPSHOTS_PER_RECONCILE = 12; // 一度に生成するバイタル記録の上限（時間を大きく進めた場合の暴走防止）

type CaseForEngine = Pick<
  Case,
  | "id"
  | "createdAt"
  | "physiologyParams"
  | "timeProgressMode"
  | "simNowAt"
  | "severityBaselineAt"
  | "crisisMode"
  | "crisisState"
  | "crisisStartedAt"
> & {
  diseaseTemplate: DiseaseTemplate | null;
};

type TreatmentOrderWithDrug = {
  orderedAt: Date;
  orderType: OrderType;
  label: string;
  detail: string | null;
  drug: { categoryLinks: { category: { majorCategory: string } }[] } | null;
};

export function computeResultReadyAt(resultTiming: "IMMEDIATE" | "DELAYED", now = new Date()): Date {
  if (resultTiming === "IMMEDIATE") return now;
  return new Date(now.getTime() + DELAYED_RESULT_DELAY_MS);
}

export type LabResult = { text: string; values: LabValue[] | null };

// 病態テンプレートに紐づく検査項目なら、その時点の重症度に応じた所見を返す。
// テンプレート対象外の項目やテンプレート未設定の症例では、マスターの固定値/固定文にフォールバックする。
// crisisState が STABLE でない（危機シナリオ発生中・死亡後）症例は、通常の重症度カーブでなく
// 常にsevere階層の所見を返す（危機専用の所見までは作り込まず、既存のsevere値を流用する）。
export function resolveLabResult(
  caseRecord: Pick<Case, "physiologyParams" | "severityBaselineAt" | "crisisState">,
  treatmentOrders: TreatmentOrderWithDrug[],
  templateKey: string | null | undefined,
  labItem: Pick<LabItemMaster, "code" | "sampleResult" | "sampleValues"> | null,
  atTime: Date
): LabResult {
  if (labItem) {
    const severity =
      caseRecord.crisisState === "STABLE"
        ? computeCaseSeverityAtTime(caseRecord, treatmentOrders, templateKey, atTime)
        : 100;
    if (severity !== null) {
      const dynamic = resolveDynamicLab(templateKey, labItem.code, severity);
      if (dynamic) return dynamic;
    }
    if (labItem.sampleValues) {
      try {
        const values = JSON.parse(labItem.sampleValues) as LabValue[];
        return { text: formatLabValues(values), values };
      } catch {
        // 不正なJSONは無視してテキストにフォールバック
      }
    }
    if (labItem.sampleResult) return { text: labItem.sampleResult, values: null };
  }
  return { text: DEFAULT_RESULT_TEXT, values: null };
}

async function loadCaseForEngine(caseId: string): Promise<CaseForEngine | null> {
  return db.case.findUnique({ where: { id: caseId }, include: { diseaseTemplate: true } });
}

// MEDICATION/INJECTION（薬剤治療判定）・PROCEDURE（処置・手術治療判定）・GENERAL（酸素投与のSpO2上乗せ判定）
// をまとめて取得する。判定に使わないオーダー種別（LAB/IMAGING）は含めない。
async function loadTreatmentOrders(caseId: string): Promise<TreatmentOrderWithDrug[]> {
  return db.order.findMany({
    where: { caseId, orderType: { in: ["MEDICATION", "INJECTION", "PROCEDURE", "GENERAL"] } },
    select: {
      orderedAt: true,
      orderType: true,
      label: true,
      detail: true,
      drug: { select: { categoryLinks: { select: { category: { select: { majorCategory: true } } } } } },
    },
  });
}

// 遅延型オーダーのうち反映時刻を過ぎたものを「結果あり」に更新し、通知を発行する。
// 「反映時刻を過ぎたか」は症例の時計（REALTIME=実時間 / MANUAL=シミュレーション時間）で判定する。
export async function reconcileCaseResults(caseId: string): Promise<void> {
  const caseRecord = await loadCaseForEngine(caseId);
  if (!caseRecord || caseRecord.crisisState === "DECEASED") return;
  const clockNow = getCaseClockNow(caseRecord);

  const due = await db.order.findMany({
    where: { caseId, status: "RESULT_PENDING", resultReadyAt: { lte: clockNow } },
    include: { labItem: true },
  });
  if (due.length === 0) return;

  const treatmentOrders = await loadTreatmentOrders(caseId);
  const templateKey = caseRecord.diseaseTemplate?.key;

  for (const order of due) {
    const result = resolveLabResult(caseRecord, treatmentOrders, templateKey, order.labItem, order.resultReadyAt ?? new Date());
    await db.order.update({
      where: { id: order.id },
      data: { status: "RESULT_AVAILABLE", resultText: result.text, resultValues: result.values ? JSON.stringify(result.values) : null },
    });
    await db.notification.create({
      data: {
        userId: order.orderedByUserId,
        caseId,
        message: `${order.label} の結果が出ました。`,
      },
    });
  }
}

// 病態テンプレートを持つ症例について、前回記録から現在時刻（実時間 or シミュレーション時間）までの
// バイタルを一定間隔で自動生成する。テンプレート未設定の症例は対象外（従来どおり静的なデータのまま）。
export async function reconcileCaseVitals(caseId: string): Promise<void> {
  const caseRecord = await loadCaseForEngine(caseId);
  if (!caseRecord || caseRecord.crisisState === "DECEASED") return;
  const templateKey = caseRecord.diseaseTemplate?.key;
  const config = templateKey ? getTemplateConfig(templateKey) : null;
  if (!templateKey || !config) return;

  const clockNow = getCaseClockNow(caseRecord);
  const lastVital = await db.vital.findFirst({ where: { caseId }, orderBy: { recordedAt: "desc" } });
  const anchor = lastVital?.recordedAt ?? caseRecord.createdAt;

  const intervalMs = SNAPSHOT_INTERVAL_HOURS * 3_600_000;
  const totalMs = clockNow.getTime() - anchor.getTime();
  // 前回記録から丸1間隔分の時間が経っていなければ何もしない。
  // これがないと、タブ切り替えなどページを開くたびに reconcile が走り、
  // ほぼ同時刻の記録が何件も量産されてしまう（実際に起きていたバグ）。
  if (totalMs < intervalMs) return;

  // 通常は固定間隔で記録するが、間隔が長く空きすぎた場合は上限件数に収まるよう間隔を引き伸ばす
  const rawSteps = Math.floor(totalMs / intervalMs);
  const steps = Math.min(rawSteps, MAX_SNAPSHOTS_PER_RECONCILE);
  const stepMs = rawSteps > MAX_SNAPSHOTS_PER_RECONCILE ? totalMs / MAX_SNAPSHOTS_PER_RECONCILE : intervalMs;

  const points: Date[] = [];
  for (let i = 1; i <= steps; i++) {
    points.push(new Date(anchor.getTime() + stepMs * i));
  }

  const treatmentOrders = await loadTreatmentOrders(caseId);

  // 危機シナリオ発生中（CRITICAL）は通常の重症度カーブでなく、シナリオ固定の危機バイタルを記録する。
  for (const at of points) {
    const vitals =
      caseRecord.crisisState === "CRITICAL"
        ? config.crisis.crisisVitals
        : (() => {
            const severity = computeCaseSeverityAtTime(caseRecord, treatmentOrders, templateKey, at);
            if (severity === null) return null;
            const oxygenBoost = findActiveOxygenBoost(treatmentOrders, at);
            return computeVitalsForSeverity(templateKey, severity, oxygenBoost);
          })();
    if (!vitals) continue;
    await db.vital.create({ data: { caseId, recordedAt: at, ...vitals } });
  }
}

// 危機シナリオ（急変・死亡モデル）の状態遷移を判定する。
// STABLE: 発動条件（テンプレートごとのcrisis.triggers）を満たせばCRITICALへ遷移し、対象学生へ通知する。
// CRITICAL: crisisStartedAt以降に救命オーダー（crisis.rescueActions）があればSTABLEへ復帰
//   （重症度カーブの起点をこの時刻にリセットし、postRescueSeverityから再開する）。
//   なければwindowMinutes経過を確認し、crisisMode=LETHALならDECEASEDへ（症例凍結）、
//   REVERSIBLEなら猶予切れでも死亡させずCRITICALのまま留まる（いつでも救命オーダーで脱出可能）。
export async function reconcileCaseCrisis(caseId: string): Promise<void> {
  const caseRecord = await loadCaseForEngine(caseId);
  if (!caseRecord || caseRecord.crisisState === "DECEASED" || caseRecord.crisisMode === "OFF") return;

  const templateKey = caseRecord.diseaseTemplate?.key;
  const config = templateKey ? getTemplateConfig(templateKey) : null;
  if (!templateKey || !config) return;

  const clockNow = getCaseClockNow(caseRecord);
  const treatmentOrders = await loadTreatmentOrders(caseId);

  if (caseRecord.crisisState === "STABLE") {
    const severity = computeCaseSeverityAtTime(caseRecord, treatmentOrders, templateKey, clockNow);
    if (severity === null) return;
    const oxygenBoost = findActiveOxygenBoost(treatmentOrders, clockNow);
    if (!evaluateCrisisTriggers(templateKey, config.crisis, severity, oxygenBoost)) return;

    await db.case.update({ where: { id: caseId }, data: { crisisState: "CRITICAL", crisisStartedAt: clockNow } });
    await notifyAssignedStudents(caseId, `【急変】${config.crisis.name}を疑う状態です。直ちに対応してください。`);
    return;
  }

  // CRITICAL
  const crisisStartedAt = caseRecord.crisisStartedAt ?? clockNow;
  const rescuedAt = findCrisisRescueAt(treatmentOrders, config.crisis, crisisStartedAt);
  if (rescuedAt) {
    const params = parsePhysiologyParams(caseRecord.physiologyParams);
    await db.case.update({
      where: { id: caseId },
      data: {
        crisisState: "STABLE",
        crisisStartedAt: null,
        severityBaselineAt: clockNow,
        physiologyParams: JSON.stringify({ ...params, severitySlider: config.crisis.postRescueSeverity }),
      },
    });
    await notifyAssignedStudents(caseId, "救命処置が奏功し、状態は安定化しました。");
    return;
  }

  const elapsedMinutes = (clockNow.getTime() - crisisStartedAt.getTime()) / 60_000;
  if (elapsedMinutes >= config.crisis.windowMinutes && caseRecord.crisisMode === "LETHAL") {
    await db.case.update({ where: { id: caseId }, data: { crisisState: "DECEASED" } });
    await notifyAssignedStudents(caseId, "【死亡確認】救命処置が間に合わず、患者は死亡しました。");
  }
}

async function notifyAssignedStudents(caseId: string, message: string): Promise<void> {
  const assignments = await db.caseAssignment.findMany({ where: { caseId }, select: { studentId: true } });
  if (assignments.length === 0) return;
  await db.notification.createMany({ data: assignments.map((a) => ({ userId: a.studentId, caseId, message })) });
}

export async function reconcileCase(caseId: string): Promise<void> {
  await reconcileCaseResults(caseId);
  await reconcileCaseCrisis(caseId);
  await reconcileCaseVitals(caseId);
}

export async function reconcileCasesForStudent(studentId: string): Promise<void> {
  const assignments = await db.caseAssignment.findMany({
    where: { studentId },
    select: { caseId: true },
  });
  for (const { caseId } of assignments) {
    await reconcileCase(caseId);
  }
}
