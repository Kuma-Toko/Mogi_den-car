import "server-only";
import { db } from "@/lib/db";
import type { Case, DiseaseTemplate, LabItemMaster, OrderType } from "@prisma/client";
import {
  computeCaseSeverityAtTime,
  computeVitalsForSeverity,
  getCaseClockNow,
  getTemplateConfig,
  resolveDynamicLab,
} from "@/lib/physiology-engine";
import { formatLabValues, type LabValue } from "@/lib/lab-reference-ranges";

const DEFAULT_RESULT_TEXT = "結果は基準範囲内です。";
const DELAYED_RESULT_DELAY_MS = 2 * 3_600_000; // 遅延型オーダーの結果反映までの固定遅延（簡易実装。症例の時計＝実時間 or シミュレーション時間で解釈）
const SNAPSHOT_INTERVAL_HOURS = 4; // バイタルの自動記録間隔（実時間 or シミュレーション時間）
const MAX_SNAPSHOTS_PER_RECONCILE = 12; // 一度に生成するバイタル記録の上限（時間を大きく進めた場合の暴走防止）

type CaseForEngine = Pick<Case, "id" | "createdAt" | "physiologyParams" | "timeProgressMode" | "simNowAt"> & {
  diseaseTemplate: DiseaseTemplate | null;
};

type TreatmentOrderWithDrug = {
  orderedAt: Date;
  orderType: OrderType;
  drug: { category: string | null } | null;
};

export function computeResultReadyAt(resultTiming: "IMMEDIATE" | "DELAYED", now = new Date()): Date {
  if (resultTiming === "IMMEDIATE") return now;
  return new Date(now.getTime() + DELAYED_RESULT_DELAY_MS);
}

export type LabResult = { text: string; values: LabValue[] | null };

// 病態テンプレートに紐づく検査項目なら、その時点の重症度に応じた所見を返す。
// テンプレート対象外の項目やテンプレート未設定の症例では、マスターの固定値/固定文にフォールバックする。
export function resolveLabResult(
  caseRecord: Pick<Case, "createdAt" | "physiologyParams">,
  treatmentOrders: TreatmentOrderWithDrug[],
  templateKey: string | null | undefined,
  labItem: Pick<LabItemMaster, "code" | "sampleResult" | "sampleValues"> | null,
  atTime: Date
): LabResult {
  if (labItem) {
    const severity = computeCaseSeverityAtTime(caseRecord, treatmentOrders, templateKey, atTime);
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

async function loadTreatmentOrders(caseId: string): Promise<TreatmentOrderWithDrug[]> {
  return db.order.findMany({
    where: { caseId, orderType: { in: ["MEDICATION", "INJECTION"] } },
    select: { orderedAt: true, orderType: true, drug: { select: { category: true } } },
  });
}

// 遅延型オーダーのうち反映時刻を過ぎたものを「結果あり」に更新し、通知を発行する。
// 「反映時刻を過ぎたか」は症例の時計（REALTIME=実時間 / MANUAL=シミュレーション時間）で判定する。
export async function reconcileCaseResults(caseId: string): Promise<void> {
  const caseRecord = await loadCaseForEngine(caseId);
  if (!caseRecord) return;
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
  if (!caseRecord) return;
  const templateKey = caseRecord.diseaseTemplate?.key;
  if (!templateKey || !getTemplateConfig(templateKey)) return;

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

  for (const at of points) {
    const severity = computeCaseSeverityAtTime(caseRecord, treatmentOrders, templateKey, at);
    if (severity === null) continue;
    const vitals = computeVitalsForSeverity(templateKey, severity);
    if (!vitals) continue;
    await db.vital.create({ data: { caseId, recordedAt: at, ...vitals } });
  }
}

export async function reconcileCase(caseId: string): Promise<void> {
  await reconcileCaseResults(caseId);
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
