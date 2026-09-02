"use server";

import { refresh, revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireCaseAccess } from "@/lib/case-access";
import { normalizeDrugName } from "@/lib/drugName";
import { logAudit } from "@/lib/audit";
import { computeResultReadyAt, reconcileCase, resolveLabResult } from "@/lib/engine";
import { getCaseClockNow } from "@/lib/physiology-engine";

// 紹介状（診療情報提供書）の構造化項目。KarteEntry.detailにJSON文字列として保存する。
export type ReferralDetail = {
  destination: string; // 紹介先医療機関・診療科
  referringDoctor: string; // 紹介元の医師名・医療機関名
  diagnosis: string; // 傷病名
  purpose: string; // 紹介目的
  presentIllness: string; // 現病歴
  pastHistory: string; // 既往歴
  medications: string; // 現在の処方・内服薬
  physicalFindings: string; // 身体所見
  testFindings: string; // 検査所見
  notes: string; // 備考
};

// 救急搬送記録の構造化項目。KarteEntry.detailにJSON文字列として保存する。
export type AmbulanceDetail = {
  agencyName: string; // 搬送機関（消防局・救急隊名）
  callReceivedAt: string; // 覚知時刻
  sceneArrivalAt: string; // 現場到着時刻
  hospitalArrivalAt: string; // 病院到着時刻
  chiefComplaint: string; // 主訴
  onsetSituation: string; // 発症状況
  consciousness: string; // 意識レベル
  vitalsOnScene: string; // 現場観察時バイタル
  pastHistory: string; // 既往歴・内服薬
  treatmentEnRoute: string; // 搬送中の処置
  receivingDepartment: string; // 受入診療科
  notes: string; // 特記事項
};

const REFERRAL_FIELDS: (keyof ReferralDetail)[] = [
  "destination",
  "referringDoctor",
  "diagnosis",
  "purpose",
  "presentIllness",
  "pastHistory",
  "medications",
  "physicalFindings",
  "testFindings",
  "notes",
];

const AMBULANCE_FIELDS: (keyof AmbulanceDetail)[] = [
  "agencyName",
  "callReceivedAt",
  "sceneArrivalAt",
  "hospitalArrivalAt",
  "chiefComplaint",
  "onsetSituation",
  "consciousness",
  "vitalsOnScene",
  "pastHistory",
  "treatmentEnRoute",
  "receivingDepartment",
  "notes",
];

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function addKarteEntry(caseId: string, formData: FormData) {
  const { user, case: caseRecord } = await requireCaseAccess(caseId);

  const entryTypeRaw = String(formData.get("entryType") ?? "SOAP");
  const entryType = (["SOAP", "NARRATIVE", "REFERRAL", "AMBULANCE"] as const).includes(entryTypeRaw as never)
    ? (entryTypeRaw as "SOAP" | "NARRATIVE" | "REFERRAL" | "AMBULANCE")
    : "SOAP";

  // シミュレーション症例では記載時刻もシミュレーション時計に合わせる（実時刻とズレて表示されないように）
  const createdAt = getCaseClockNow(caseRecord);
  const base = { caseId, authorUserId: user.id, entryType, createdAt };

  let entryId: string;

  if (entryType === "SOAP") {
    const subjective = formString(formData, "subjective");
    const objective = formString(formData, "objective");
    const assessment = formString(formData, "assessment");
    const plan = formString(formData, "plan");
    if (!subjective && !objective && !assessment && !plan) return;

    const note = await db.karteEntry.create({ data: { ...base, subjective, objective, assessment, plan } });
    entryId = note.id;
  } else if (entryType === "NARRATIVE") {
    const title = formString(formData, "title");
    const narrative = formString(formData, "narrative");
    if (!narrative) return;

    const note = await db.karteEntry.create({ data: { ...base, title: title || null, narrative } });
    entryId = note.id;
  } else if (entryType === "REFERRAL") {
    const fields = Object.fromEntries(REFERRAL_FIELDS.map((key) => [key, formString(formData, key)])) as ReferralDetail;
    if (Object.values(fields).every((v) => !v)) return;

    const title = fields.destination ? `${fields.destination}　宛` : "紹介状（診療情報提供書）";
    const note = await db.karteEntry.create({ data: { ...base, title, detail: JSON.stringify(fields) } });
    entryId = note.id;
  } else {
    const fields = Object.fromEntries(AMBULANCE_FIELDS.map((key) => [key, formString(formData, key)])) as AmbulanceDetail;
    if (Object.values(fields).every((v) => !v)) return;

    const title = fields.agencyName || "救急搬送記録";
    const note = await db.karteEntry.create({ data: { ...base, title, detail: JSON.stringify(fields) } });
    entryId = note.id;
  }

  await db.case.update({ where: { id: caseId }, data: { updatedAt: new Date() } });
  await logAudit({
    userId: user.id,
    action: "karte_entry_save",
    targetType: "Case",
    targetId: caseId,
    detail: { entryId, entryType },
  });

  revalidatePath(`/patients/${caseId}`);
}

export type RpDrugLine = { drugId: string; label: string; note: string; count: string };

export type ImagingContext = {
  chiefComplaint: string;
  findings: string;
  purpose: string;
  needsInterpretation: boolean;
  mriSequences?: string[];
};

export type CartItem =
  | { kind: "LAB"; labItemId: string; label: string; imaging?: ImagingContext }
  | { kind: "MEDICATION_RP"; drugs: RpDrugLine[]; instruction: string; comment: string }
  | { kind: "INJECTION_RP"; drugs: RpDrugLine[]; rate: string; comment: string }
  | { kind: "GENERAL"; category: string; selection: string; comment: string }
  | { kind: "PROCEDURE"; category: string; selection: string; comment: string };

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
    where: { caseId, orderType: { in: ["MEDICATION", "INJECTION", "PROCEDURE"] } },
    select: {
      orderedAt: true,
      orderType: true,
      label: true,
      detail: true,
      drug: { select: { categoryLinks: { select: { category: { select: { majorCategory: true } } } } } },
    },
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
            orderType: imaging ? "IMAGING" : "LAB",
            label: labItem.name,
            labItemId: labItem.id,
            detail: imaging
              ? JSON.stringify({
                  chiefComplaint: imaging.chiefComplaint || undefined,
                  findings: imaging.findings || undefined,
                  purpose: imaging.purpose || undefined,
                  needsInterpretation: imaging.needsInterpretation,
                  mriSequences: imaging.mriSequences && imaging.mriSequences.length > 0 ? imaging.mriSequences : undefined,
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
        // プルダウン選択（安静度・食事など）がある場合は選択値をラベルに、補足コメントは別枠（sub行）に出す。
        // 選択肢のないカテゴリ（清潔・清拭／活動・リハビリ）は従来どおりコメントがそのままラベルになる。
        const subComment = selection ? comment : "";
        // category/selectionは表示用のcomment（あれば）に加えて常にdetailへ残す。
        // 病態モデル側（酸素投与のSpO2上乗せ判定）がカテゴリ・選択値をラベル文字列に頼らず参照できるようにするため。
        const detail: { category: string; selection?: string; comment?: string } = { category: item.category };
        if (selection) detail.selection = selection;
        if (subComment) detail.comment = subComment;

        await tx.order.create({
          data: {
            caseId,
            orderedByUserId: user.id,
            orderType: "GENERAL",
            label: primary ? `${item.category}：${primary}` : item.category,
            detail: JSON.stringify(detail),
            status: "ACTIVE",
            orderedAt,
          },
        });
      } else if (item.kind === "PROCEDURE") {
        if (!item.category) continue;
        const selection = item.selection.trim();
        const comment = item.comment.trim();
        const primary = selection || comment;
        // 一般指示と同様、プルダウン選択（処置）がある場合は選択値をラベルに、補足コメントは別枠に出す。
        // 手術は選択肢を持たず、術式名をそのまま自由記述で入力する。
        const subComment = selection ? comment : "";

        await tx.order.create({
          data: {
            caseId,
            orderedByUserId: user.id,
            orderType: "PROCEDURE",
            label: primary ? `${item.category}：${primary}` : item.category,
            detail: subComment ? JSON.stringify({ comment: subComment }) : null,
            // 一般指示（継続する指示）とは異なり、処置・手術は実施した行為の記録なので
            // 注射・点滴と同じくADMINISTERED（実施済）で登録する。
            status: "ADMINISTERED",
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
