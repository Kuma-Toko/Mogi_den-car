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

// 標的治療フェーズ（培養で原因菌が確定した後）向けの採点用事実。原因菌未割当・培養未確定の症例では
// null（呼び出し側=engine.tsのloadTargetedTherapyContextが判定する）。
export type TargetedTherapyContext = {
  pathogenName: string;
  coverage: AntibioticCoverageResult;
};

type EvalCase = Pick<Case, "title" | "patientName" | "patientAge" | "patientGender" | "createdAt">;

const ORDER_TYPE_LABEL: Record<string, string> = {
  MEDICATION: "処方",
  INJECTION: "注射・点滴",
  PROCEDURE: "処置・手術",
  GENERAL: "一般指示",
};

function formatOrderLine(order: TreatmentEvaluationOrder, caseStartAt: Date): string {
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

# 標的治療フェーズ（培養検査で原因菌が確定済み。学生への結果開示状況とは別に、採点用の確定事実として提供）
- 確定した原因菌: ${pathogenName}
- 現在の抗菌薬オーダーと原因菌に対する感受性:
${detailLines}
- カバレッジ判定: ${ANTIBIOTIC_COVERAGE_LEVEL_LABEL[coverage.level]}
- この判定を踏まえること。原因菌に感受性のある抗菌薬でカバーできていない場合（不適切・部分的）は、
  他の治療が行われていても改善は見込みにくいため appropriatenessScore を相応に低く評価すること。
`;
}

function buildEvaluationPrompt(params: {
  caseRecord: EvalCase;
  templateName: string;
  templateDescription: string | null;
  guideline: string;
  problems: { label: string; isPrimary: boolean }[];
  orders: TreatmentEvaluationOrder[];
  latestVital: Vital | null;
  targetedTherapy: TargetedTherapyContext | null;
}): string {
  const { caseRecord, templateName, templateDescription, guideline, problems, orders, latestVital, targetedTherapy } = params;

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

  return `あなたは医学教育シミュレーションにおいて、学生が行った治療オーダーの臨床的な適切性を採点する評価者です。

# 症例情報
- 症例名: ${caseRecord.title}
- 患者: ${caseRecord.patientName}（${caseRecord.patientAge}歳 ${caseRecord.patientGender}）
- 病態テンプレート: ${templateName}${templateDescription ? `（${templateDescription}）` : ""}
- プロブレムリスト:
${problemLines}
- 直近のバイタルサイン: ${vitalLine}

# 採点ルーブリック（教員が登録した、この症例で期待される治療方針・評価基準）
${guideline}

# 学生がこれまでに行った治療系オーダー（時系列順）
${orderLines}
${formatTargetedTherapySection(targetedTherapy)}
# 採点ルール
1. appropriatenessScoreは「今の治療方針をこのまま続けた場合、患者の状態が単位時間あたりどれだけ改善/悪化するか」を
   表す連続的な指標として0〜100の整数で評価する（一時点の絶対評価ではなく、今後の推移の速さを表すことに注意）。
   - 100に近いほど、期待される治療方針に沿った内容で、急速な改善が見込める。
   - 50は、改善とも悪化とも言えない現状維持（一定の治療は行われているが不十分、など）。
   - 0に近いほど、必要な治療が行われておらず、病態が急速に進行悪化することが見込まれる。
2. contraindicatedは、禁忌薬剤の投与など「単発の行為として即座に患者に重大な害を及ぼす内容」が含まれる場合にのみ
   trueとする。true にした場合、その行為の影響で症状が直ちに（緩やかにではなく）重症化する処理が別途行われる。
   単に治療が不十分・不完全なだけ（有害ではない）の場合はfalseのままappropriatenessScoreだけで評価すること。
3. rationaleには、採点根拠を日本語で2〜3文の簡潔な説明として記述する（教員が後から確認する監査用テキスト）。
4. appropriatenessScoreは必ず0〜100の整数、rationaleは必ず日本語の文章で返すこと。`;
}

export type TreatmentEvaluationResult = {
  appropriatenessScore: number;
  contraindicated: boolean;
  rationale: string;
  rawResponse: string;
};

export async function evaluateTreatment(params: {
  caseRecord: EvalCase;
  templateName: string;
  templateDescription: string | null;
  guideline: string;
  problems: { label: string; isPrimary: boolean }[];
  orders: TreatmentEvaluationOrder[];
  latestVital: Vital | null;
  targetedTherapy: TargetedTherapyContext | null;
}): Promise<TreatmentEvaluationResult> {
  const prompt = buildEvaluationPrompt(params);

  const config = {
    temperature: 0.3,
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
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
      required: ["appropriatenessScore", "contraindicated", "rationale"],
    },
  };

  const response = await generateWithFallback({ contents: [{ role: "user", parts: [{ text: prompt }] }], config });
  const text = response.text?.trim();
  if (!text) throw new Error("AI評価: 空の応答が返されました");

  let parsed: { appropriatenessScore?: unknown; contraindicated?: unknown; rationale?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`AI評価: 応答のJSONパースに失敗しました: ${text.slice(0, 200)}`);
  }

  const score = Number(parsed.appropriatenessScore);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error(`AI評価: 不正なスコアが返されました: ${JSON.stringify(parsed.appropriatenessScore)}`);
  }
  const contraindicated = parsed.contraindicated === true;
  const rationale = typeof parsed.rationale === "string" && parsed.rationale.trim() ? parsed.rationale.trim() : "（根拠なし）";

  return { appropriatenessScore: Math.round(score), contraindicated, rationale, rawResponse: text };
}
