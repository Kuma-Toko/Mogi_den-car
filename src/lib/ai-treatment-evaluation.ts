import "server-only";
import { Type } from "@google/genai";
import type { Case, Vital } from "@prisma/client";
import { generateWithFallback } from "@/lib/gemini";
import {
  ANTIBIOTIC_COVERAGE_LEVEL_LABEL,
  COVERAGE_SUSCEPTIBILITY_LABEL,
  type AntibioticCoverageResult,
} from "@/lib/infection-engine";

export type TreatmentEvaluationOrder = {
  orderType: string;
  label: string;
  detail: string | null;
  orderedAt: Date;
};

// 症例に原因菌が割り当てられていれば常に提供する採点用事実（学生への培養結果開示状況とは無関係）。
// 原因菌未割当の症例ではnull（呼び出し側=engine.tsのloadTargetedTherapyContextが判定する）。
export type TargetedTherapyContext = {
  pathogenName: string;
  coverage: AntibioticCoverageResult;
};

// 1回のAI治療評価で採点対象にする病態1件分の情報。症例にアタッチされた
// aiEvaluationGuideline設定済みのCaseDiseaseLinkごとに1件作られ、配列としてevaluateTreatmentに渡される。
export type DiseaseEvaluationTarget = {
  diseaseLinkId: string;
  templateName: string;
  templateDescription: string | null;
  guideline: string;
  targetedTherapy: TargetedTherapyContext | null;
};

type EvalCase = Pick<Case, "title" | "patientName" | "patientAge" | "patientGender" | "createdAt">;

const ORDER_TYPE_LABEL: Record<string, string> = {
  MEDICATION: "処方",
  INJECTION: "注射・点滴",
  PROCEDURE: "処置・手術",
  GENERAL: "一般指示",
};

export function formatOrderLine(order: TreatmentEvaluationOrder, caseStartAt: Date): string {
  const elapsedHours = Math.round(((order.orderedAt.getTime() - caseStartAt.getTime()) / 3_600_000) * 10) / 10;
  let detailText = "";
  if (order.detail) {
    try {
      const detail = JSON.parse(order.detail) as Record<string, string | undefined>;
      detailText = Object.values(detail).filter(Boolean).join(" / ");
    } catch {
      // 不正なJSONは無視
    }
  }
  const typeLabel = ORDER_TYPE_LABEL[order.orderType] ?? order.orderType;
  return `- [${typeLabel}] ${order.label}${detailText ? `（${detailText}）` : ""}（症例開始から約${elapsedHours}時間後）`;
}

function formatTargetedTherapySection(ctx: TargetedTherapyContext | null): string {
  if (!ctx) return "";
  const { pathogenName, coverage } = ctx;
  const detailLines =
    coverage.details.length > 0
      ? coverage.details
          .map((d) => `- ${d.drugLabel}（${d.subCategory}）: ${COVERAGE_SUSCEPTIBILITY_LABEL[d.susceptibility]}`)
          .join("\n")
      : "（抗菌薬オーダーはまだありません）";
  return `
- 原因菌情報（採点用の確定事実。学生への培養結果開示状況とは無関係に常に提供）
  - 確定した原因菌: ${pathogenName}
  - 現在の抗菌薬オーダーと原因菌に対する感受性:
${detailLines}
  - カバレッジ判定: ${ANTIBIOTIC_COVERAGE_LEVEL_LABEL[coverage.level]}
  - この判定を踏まえること。原因菌に感受性のある抗菌薬でカバーできていない場合（不適切・部分的）は、
    他の治療が行われていても改善は見込みにくいためこの病態のappropriatenessScoreを相応に低く評価すること。
`;
}

function formatDiseaseBlock(disease: DiseaseEvaluationTarget, index: number): string {
  const { diseaseLinkId, templateName, templateDescription, guideline, targetedTherapy } = disease;
  return `
## 病態${index + 1}: ${templateName}${templateDescription ? `（${templateDescription}）` : ""}
- diseaseLinkId: ${diseaseLinkId}
- この病態の採点ルーブリック（教員が登録した、この病態で期待される治療方針・評価基準）:
${guideline}
${formatTargetedTherapySection(targetedTherapy)}`;
}

function buildEvaluationPrompt(params: {
  caseRecord: EvalCase;
  diseases: DiseaseEvaluationTarget[];
  problems: { label: string; isPrimary: boolean }[];
  orders: TreatmentEvaluationOrder[];
  latestVital: Vital | null;
}): string {
  const { caseRecord, diseases, problems, orders, latestVital } = params;

  const problemLines =
    problems.length > 0 ? problems.map((p) => `- ${p.label}${p.isPrimary ? "（主病態）" : ""}`).join("\n") : "（未登録）";

  const orderLines =
    orders.length > 0
      ? orders
          .slice()
          .sort((a, b) => a.orderedAt.getTime() - b.orderedAt.getTime())
          .map((o) => formatOrderLine(o, caseRecord.createdAt))
          .join("\n")
      : "（治療系オーダーはまだありません）";

  const vitalLine = latestVital
    ? `体温${latestVital.temperature ?? "—"}℃ / 血圧${latestVital.systolicBp ?? "—"}/${latestVital.diastolicBp ?? "—"} / 脈拍${latestVital.pulse ?? "—"} / SpO2${latestVital.spo2 ?? "—"}% / 呼吸数${latestVital.respRate ?? "—"}`
    : "（記録なし）";

  const diseaseBlocks = diseases.map((d, i) => formatDiseaseBlock(d, i)).join("\n");

  return `あなたは医学教育シミュレーションにおいて、学生が行った治療オーダーの臨床的な適切性を採点する評価者です。
この症例には複数の病態が並行して存在する場合があります。以下の「対象病態一覧」に列挙された病態それぞれについて、
共通の症例情報・オーダー・バイタルを踏まえつつ、各病態自身のルーブリックに照らして独立に採点してください
（ある病態の治療が不十分でも、他の病態の評価には影響させないこと）。

# 症例情報
- 症例名: ${caseRecord.title}
- 患者: ${caseRecord.patientName}（${caseRecord.patientAge}歳 ${caseRecord.patientGender}）
- プロブレムリスト:
${problemLines}
- 直近のバイタルサイン: ${vitalLine}

# 学生がこれまでに行った治療系オーダー（時系列順、全病態共通）
${orderLines}

# 対象病態一覧（このそれぞれについて、evaluations配列に1件ずつ結果を返すこと）
${diseaseBlocks}
# 採点ルール（対象病態一覧の各病態に対して、それぞれ独立に適用する）
1. appropriatenessScoreは「今の治療方針をこのまま続けた場合、患者の状態が単位時間あたりどれだけ改善/悪化するか」を
   表す連続的な指標として0〜100の整数で評価する（一時点の絶対評価ではなく、今後の推移の速さを表すことに注意）。
   - 100に近いほど、期待される治療方針に沿った内容で、急速な改善が見込める。
   - 50は、改善とも悪化とも言えない現状維持（一定の治療は行われているが不十分、など）。
   - 0に近いほど、必要な治療が行われておらず、病態が急速に進行悪化することが見込まれる。
   - 【重要】その病態のルーブリックが示す第一選択の治療（薬剤・用法用量・投与経路など）が過不足なく正しく
     開始されている場合は、それ単独で90点台後半〜100点を与えること。付随的な補助オーダー（検査・経過観察指示・
     対症療法など）がまだ出ていないことや、治療期間がまだ短いことを理由に減点しないこと——それらはルーブリックが
     具体的に要求している場合にのみ減点材料とする。
   - 採点は保守的になりすぎないこと。「完璧ではないかもしれない」という漠然とした慎重さだけで99点や100点を避けず、
     ルーブリックに照らして具体的に指摘できる不足・誤りがある場合にのみ、その重大度に応じて減点すること。
     0〜100の全レンジ、特に90点台後半や100点も遠慮なく使うこと。
2. contraindicatedは、禁忌薬剤の投与など「単発の行為として即座に患者に重大な害を及ぼす内容」が含まれる場合にのみ
   trueとする。true にした場合、その行為の影響で症状が直ちに（緩やかにではなく）重症化する処理が別途行われる。
   単に治療が不十分・不完全なだけ（有害ではない）の場合はfalseのままappropriatenessScoreだけで評価すること。
3. rationaleには、その病態についての採点根拠を日本語で2〜3文の簡潔な説明として記述する（教員が後から確認する監査用テキスト）。
4. appropriatenessScoreは必ず0〜100の整数、rationaleは必ず日本語の文章で返すこと。
5. evaluations配列には、上記「対象病態一覧」に列挙された病態の数だけ、それぞれのdiseaseLinkIdをそのまま使って
   1件ずつ結果を返すこと（過不足や重複があってはならない）。`;
}

export type TreatmentEvaluationResult = {
  diseaseLinkId: string;
  appropriatenessScore: number;
  contraindicated: boolean;
  rationale: string;
};

export async function evaluateTreatment(params: {
  caseRecord: EvalCase;
  diseases: DiseaseEvaluationTarget[];
  problems: { label: string; isPrimary: boolean }[];
  orders: TreatmentEvaluationOrder[];
  latestVital: Vital | null;
}): Promise<{ results: TreatmentEvaluationResult[]; rawResponse: string }> {
  const { diseases } = params;
  const prompt = buildEvaluationPrompt(params);

  const config = {
    temperature: 0.3,
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        evaluations: {
          type: Type.ARRAY,
          description: "対象病態一覧に列挙された病態それぞれ1件ずつの採点結果",
          items: {
            type: Type.OBJECT,
            properties: {
              diseaseLinkId: {
                type: Type.STRING,
                description: "対応する病態のdiseaseLinkId（プロンプトで示したものをそのまま返す）",
              },
              appropriatenessScore: {
                type: Type.INTEGER,
                description: "0〜100の整数。今の治療方針が続いた場合の単位時間あたりの改善/悪化の速さ（50=現状維持）",
              },
              contraindicated: {
                type: Type.BOOLEAN,
                description: "禁忌等、単発で重大な害を及ぼす行為が含まれる場合のみtrue",
              },
              rationale: { type: Type.STRING, description: "採点根拠。日本語で2〜3文" },
            },
            required: ["diseaseLinkId", "appropriatenessScore", "contraindicated", "rationale"],
          },
        },
      },
      required: ["evaluations"],
    },
  };

  const response = await generateWithFallback({ contents: [{ role: "user", parts: [{ text: prompt }] }], config });
  const text = response.text?.trim();
  if (!text) throw new Error("AI評価: 空の応答が返されました");

  let parsed: { evaluations?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`AI評価: 応答のJSONパースに失敗しました: ${text.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed.evaluations)) {
    throw new Error(`AI評価: evaluationsが配列ではありません: ${text.slice(0, 200)}`);
  }

  const results: TreatmentEvaluationResult[] = parsed.evaluations.map((item: unknown) => {
    const e = item as { diseaseLinkId?: unknown; appropriatenessScore?: unknown; contraindicated?: unknown; rationale?: unknown };
    const diseaseLinkId = typeof e.diseaseLinkId === "string" ? e.diseaseLinkId : "";
    const score = Number(e.appropriatenessScore);
    if (!diseaseLinkId || !Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error(`AI評価: 不正な評価結果が返されました: ${JSON.stringify(e)}`);
    }
    const contraindicated = e.contraindicated === true;
    const rationale = typeof e.rationale === "string" && e.rationale.trim() ? e.rationale.trim() : "（根拠なし）";
    return { diseaseLinkId, appropriatenessScore: Math.round(score), contraindicated, rationale };
  });

  const expectedIds = new Set(diseases.map((d) => d.diseaseLinkId));
  const returnedIds = new Set(results.map((r) => r.diseaseLinkId));
  if (results.length !== diseases.length || returnedIds.size !== results.length || [...expectedIds].some((id) => !returnedIds.has(id))) {
    throw new Error(`AI評価: 対象病態と返却された評価結果が一致しません（期待: ${diseases.length}件, 返却: ${results.length}件）`);
  }

  return { results, rawResponse: text };
}
