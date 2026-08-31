"use server";

import { refresh, revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireCaseAccess } from "@/lib/case-access";
import { normalizeDrugName } from "@/lib/drugName";
import { logAudit } from "@/lib/audit";
import { computeResultReadyAt, reconcileCase, resolveLabResult } from "@/lib/engine";
import { getCaseClockNow } from "@/lib/physiology-engine";

export async function addSoapNote(caseId: string, formData: FormData) {
  const { user, case: caseRecord } = await requireCaseAccess(caseId);

  const subjective = String(formData.get("subjective") ?? "").trim();
  const objective = String(formData.get("objective") ?? "").trim();
  const assessment = String(formData.get("assessment") ?? "").trim();
  const plan = String(formData.get("plan") ?? "").trim();
  if (!subjective && !objective && !assessment && !plan) return;

  // シミュレーション症例では記載時刻もシミュレーション時計に合わせる（実時刻とズレて表示されないように）
  const createdAt = getCaseClockNow(caseRecord);
  const note = await db.soapNote.create({
    data: { caseId, authorUserId: user.id, subjective, objective, assessment, plan, createdAt },
  });
  await db.case.update({ where: { id: caseId }, data: { updatedAt: new Date() } });
  await logAudit({
    userId: user.id,
    action: "soap_save",
    targetType: "Case",
    targetId: caseId,
    detail: { noteId: note.id },
  });

  revalidatePath(`/patients/${caseId}`);
}

export type RpDrugLine = { drugId: string; label: string; note: string; count: string };

export type ImagingContext = {
  chiefComplaint: string;
  findings: string;
  purpose: string;
  needsInterpretation: boolean;
};

export type CartItem =
  | { kind: "LAB"; labItemId: string; label: string; imaging?: ImagingContext }
  | { kind: "MEDICATION_RP"; drugs: RpDrugLine[]; instruction: string; comment: string }
  | { kind: "INJECTION_RP"; drugs: RpDrugLine[]; rate: string; comment: string }
  | { kind: "GENERAL"; category: string; selection: string; comment: string };

export type DrugSearchResult = {
  id: string;
  name: string;
  category: string | null;
  defaultDose: string | null;
  route: string | null;
  matchedAlias: string | null; // 別名(alias)経由でヒットした場合、その別名の表示テキスト
};

const DRUG_SEARCH_LIMIT = 30;

// 薬剤名の部分一致検索。プルダウンの代わりにダイアログ内の自由記述欄から呼び出す。
// 薬剤数が今後大幅に増える想定のため、一覧を丸ごと渡さずEnter押下時にサーバー側で検索する。
// 正式名称の完全一致・部分一致だけでなく、略称・俗称・表記ゆれ(DrugAlias)経由でも
// ヒットするよう、name/aliasText双方を同じnormalizeDrugName()で正規化して比較する。
//
// alias一致を常に先頭に出す: 例えば「生食」は「テルモ生食」等、名前に文字列として
// 既に含まれる商品が50件以上あるため、名前一致と同じ並びに混ぜるとalias側で
// 拾いたかった「生理食塩液」がtake件数の外に押し出されてしまう。
export async function searchDrugs(caseId: string, isInjectable: boolean, query: string): Promise<DrugSearchResult[]> {
  await requireCaseAccess(caseId);
  const q = query.trim();
  if (!q) return [];
  const normalized = normalizeDrugName(q);

  const aliasMatches = normalized
    ? await db.drugMaster.findMany({
        where: { isInjectable, aliases: { some: { normalizedText: { contains: normalized } } } },
        orderBy: { name: "asc" },
        take: DRUG_SEARCH_LIMIT,
        select: {
          id: true,
          name: true,
          category: true,
          defaultDose: true,
          route: true,
          aliases: { where: { normalizedText: { contains: normalized } }, select: { aliasText: true }, take: 1 },
        },
      })
    : [];

  const remaining = DRUG_SEARCH_LIMIT - aliasMatches.length;
  const nameMatches =
    remaining > 0
      ? await db.drugMaster.findMany({
          where: {
            isInjectable,
            id: { notIn: aliasMatches.map((d) => d.id) },
            OR: [{ hotCode: { contains: q } }, ...(normalized ? [{ normalizedName: { contains: normalized } }] : [])],
          },
          orderBy: { name: "asc" },
          take: remaining,
          select: { id: true, name: true, category: true, defaultDose: true, route: true },
        })
      : [];

  return [
    ...aliasMatches.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      defaultDose: r.defaultDose,
      route: r.route,
      matchedAlias: r.aliases[0]?.aliasText ?? null,
    })),
    ...nameMatches.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      defaultDose: r.defaultDose,
      route: r.route,
      matchedAlias: null,
    })),
  ];
}

// 検査・処方・注射・一般指示をまとめて一括発行する。学生はダイアログでカートに項目を積んでから
// 一括で確定するため、サーバー側でもまとめて1回のトランザクションで処理する。
export async function submitOrderBatch(caseId: string, items: CartItem[]) {
  const { user } = await requireCaseAccess(caseId);
  if (!items || items.length === 0) return;

  const caseRecord = await db.case.findUnique({ where: { id: caseId }, include: { diseaseTemplate: true } });
  if (!caseRecord) return;

  // シミュレーション症例ではオーダー時刻もシミュレーション時計に合わせる。治療開始時刻の判定や
  // バイタルの時系列がこの時刻を基準に計算されるため、実時刻のままだとズレてしまう。
  const orderedAt = getCaseClockNow(caseRecord);
  const immediate = caseRecord.resultTiming === "IMMEDIATE";
  const resultReadyAt = computeResultReadyAt(caseRecord.resultTiming, orderedAt);

  const treatmentOrders = await db.order.findMany({
    where: { caseId, orderType: { in: ["MEDICATION", "INJECTION"] } },
    select: { orderedAt: true, orderType: true, drug: { select: { category: true } } },
  });

  const labItemIds = items.filter((i) => i.kind === "LAB").map((i) => i.labItemId);
  const drugIds = items.flatMap((i) =>
    i.kind === "MEDICATION_RP" || i.kind === "INJECTION_RP" ? i.drugs.map((d) => d.drugId) : []
  );
  const [labItems, drugs] = await Promise.all([
    labItemIds.length ? db.labItemMaster.findMany({ where: { id: { in: labItemIds } } }) : Promise.resolve([]),
    drugIds.length ? db.drugMaster.findMany({ where: { id: { in: drugIds } } }) : Promise.resolve([]),
  ]);
  const labItemMap = new Map(labItems.map((l) => [l.id, l]));
  const drugMap = new Map(drugs.map((d) => [d.id, d]));

  let immediateResultCount = 0;
  const rpCounters = { MEDICATION: 0, INJECTION: 0 };

  await db.$transaction(async (tx) => {
    for (const item of items) {
      if (item.kind === "LAB") {
        const labItem = labItemMap.get(item.labItemId);
        if (!labItem) continue;

        const result = immediate
          ? resolveLabResult(caseRecord, treatmentOrders, caseRecord.diseaseTemplate?.key, labItem, resultReadyAt)
          : null;
        const imaging = item.imaging;

        await tx.order.create({
          data: {
            caseId,
            orderedByUserId: user.id,
            orderType: "LAB",
            label: labItem.name,
            labItemId: labItem.id,
            detail: imaging
              ? JSON.stringify({
                  chiefComplaint: imaging.chiefComplaint || undefined,
                  findings: imaging.findings || undefined,
                  purpose: imaging.purpose || undefined,
                  needsInterpretation: imaging.needsInterpretation,
                })
              : null,
            status: immediate ? "RESULT_AVAILABLE" : "RESULT_PENDING",
            orderedAt,
            resultReadyAt,
            resultText: result?.text ?? null,
            resultValues: result?.values ? JSON.stringify(result.values) : null,
          },
        });
        if (immediate) {
          immediateResultCount++;
          await tx.notification.create({
            data: { userId: user.id, caseId, message: `${labItem.name} の結果が出ました。` },
          });
        }
      } else if (item.kind === "MEDICATION_RP") {
        if (item.drugs.length === 0) continue;
        const rpGroupId = crypto.randomUUID();
        const rpLabel = `Rp.${++rpCounters.MEDICATION}`;
        const instruction = item.instruction.trim();
        const comment = item.comment.trim();

        for (const line of item.drugs) {
          const drug = drugMap.get(line.drugId);
          if (!drug) continue;

          const count = line.count.trim();
          const note = line.note.trim();
          const label = [drug.name, count].filter(Boolean).join("　");

          await tx.order.create({
            data: {
              caseId,
              orderedByUserId: user.id,
              orderType: "MEDICATION",
              label,
              drugId: drug.id,
              rpGroupId,
              rpLabel,
              detail: JSON.stringify({
                route: drug.route,
                count: count || undefined,
                note: note || undefined,
                instruction: instruction || undefined,
                comment: comment || undefined,
              }),
              status: "ADMINISTERED",
              orderedAt,
            },
          });
        }
      } else if (item.kind === "INJECTION_RP") {
        if (item.drugs.length === 0) continue;
        const rpGroupId = crypto.randomUUID();
        const rpLabel = `Rp.${++rpCounters.INJECTION}`;
        const rate = item.rate.trim();
        const comment = item.comment.trim();

        for (const line of item.drugs) {
          const drug = drugMap.get(line.drugId);
          if (!drug) continue;

          const count = line.count.trim();
          const note = line.note.trim();
          const label = [drug.name, count].filter(Boolean).join("　");

          await tx.order.create({
            data: {
              caseId,
              orderedByUserId: user.id,
              orderType: "INJECTION",
              label,
              drugId: drug.id,
              rpGroupId,
              rpLabel,
              detail: JSON.stringify({
                route: drug.route,
                count: count || undefined,
                note: note || undefined,
                rate: rate || undefined,
                comment: comment || undefined,
              }),
              status: "ADMINISTERED",
              orderedAt,
            },
          });
        }
      } else if (item.kind === "GENERAL") {
        if (!item.category) continue;
        const selection = item.selection.trim();
        const comment = item.comment.trim();
        const primary = selection || comment;
        // プルダウン選択（安静度・食事）がある場合は選択値をラベルに、補足コメントは別枠（sub行）に出す。
        // 選択肢のないカテゴリ（清潔・清拭／活動・リハビリ）は従来どおりコメントがそのままラベルになる。
        const subComment = selection ? comment : "";

        await tx.order.create({
          data: {
            caseId,
            orderedByUserId: user.id,
            orderType: "GENERAL",
            label: primary ? `${item.category}：${primary}` : item.category,
            detail: subComment ? JSON.stringify({ comment: subComment }) : null,
            status: "ACTIVE",
            orderedAt,
          },
        });
      }
    }
  });

  await logAudit({
    userId: user.id,
    action: "order_create",
    targetType: "Case",
    targetId: caseId,
    detail: { count: items.length, immediateResultCount },
  });

  revalidatePath(`/patients/${caseId}`);
  refresh();
}

export async function advanceSimTime(caseId: string, hours: number) {
  const { user, case: caseRecord } = await requireCaseAccess(caseId);
  if (caseRecord.timeProgressMode !== "MANUAL") return;

  const current = getCaseClockNow(caseRecord);
  const next = new Date(current.getTime() + hours * 3_600_000);

  await db.case.update({ where: { id: caseId }, data: { simNowAt: next } });
  await reconcileCase(caseId);
  await logAudit({
    userId: user.id,
    action: "advance_sim_time",
    targetType: "Case",
    targetId: caseId,
    detail: { hours },
  });

  revalidatePath(`/patients/${caseId}`);
}
