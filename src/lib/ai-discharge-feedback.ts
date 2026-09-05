import "server-only";
import { Type } from "@google/genai";
import type { Case, CrisisState, Vital } from "@prisma/client";
import { generateWithFallback } from "@/lib/gemini";
import { formatOrderLine, type TargetedTherapyContext, type TreatmentEvaluationOrder } from "@/lib/ai-treatment-evaluation";
import { ANTIBIOTIC_COVERAGE_LEVEL_LABEL, COVERAGE_SUSCEPTIBILITY_LABEL } from "@/lib/infection-engine";

export type PastEvaluationSummary = {
  appropriatenessScore: number | null;
  contraindicated: boolean;
  rationale: string | null;
  completedAt: Date | null;
};

type FeedbackCase = Pick<Case, "title" | "patientName" | "patientAge" | "patientGender" | "createdAt">;

const CRISIS_STATE_LABEL: Record<CrisisState, string> = {
  STABLE: "安定（急変なく経過）",
  CRITICAL: "急変中（未解決のまま症例終了）",
  DECEASED: "死亡（救命に至らず）",
};

function formatTargetedTherapySection(ctx: TargetedTherapyContext | null): string {
  if (!ctx) return "";
  const { pathogenName, coverage } = ctx;
  const detailLines =
    coverage.details.length > 0
      ? coverage.details
          .map((d) => `- ${d.drugLabel}（${d.subCategory}）: ${COVERAGE_SUSCEPTIBILITY_LABEL[d.susceptibility]}`)
          .join("\n")
      : "（抗菌薬オーダーはありませんでした）";
  return `

# 原因菌情報（採点用の確定事実。学生への培養結果開示状況とは無関係に常に提供）
- 確定した原因菌: ${pathogenName}
- 症例終了時点の抗菌薬オーダーと原因菌に対する感受性:
${detailLines}
- 最終的なカバレッジ判定: ${ANTIBIOTIC_COVERAGE_LEVEL_LABEL[coverage.level]}
`;
}

function formatPastEvaluationsSection(evaluations: PastEvaluationSummary[], caseStartAt: Date): string {
  if (evaluations.length === 0) return "（治療方針変更時点でのAI評価履歴はありません）";
  return evaluations
    .map((e) => {
      const elapsedHours = e.completedAt
        ? Math.round(((e.completedAt.getTime() - caseStartAt.getTime()) / 3_600_000) * 10) / 10
        : null;
      const scoreText = e.appropriatenessScore !== null ? `適切性スコア${e.appropriatenessScore}/100` : "スコアなし";
      const flagText = e.contraindicated ? "（重大な問題を検知）" : "";
      return `- 症例開始から約${elapsedHours ?? "—"}時間後: ${scoreText}${flagText}${e.rationale ? ` — ${e.rationale}` : ""}`;
    })
    .join("\n");
}

function buildDischargeFeedbackPrompt(params: {
  caseRecord: FeedbackCase;
  templateName: string;
  templateDescription: string | null;
  guideline: string | null;
  crisisState: CrisisState;
  problems: { label: string; isPrimary: boolean }[];
  orders: TreatmentEvaluationOrder[];
  pastEvaluations: PastEvaluationSummary[];
  latestVital: Vital | null;
  targetedTherapy: TargetedTherapyContext | null;
}): string {
  const { caseRecord, templateName, templateDescription, guideline, crisisState, problems, orders, pastEvaluations, latestVital, targetedTherapy } =
    params;

  const problemLines =
    problems.length > 0 ? problems.map((p) => `- ${p.label}${p.isPrimary ? "（主病態）" : ""}`).join("\n") : "（未登録）";

  const orderLines =
    orders.length > 0
      ? orders
          .slice()
          .sort((a, b) => a.orderedAt.getTime() - b.orderedAt.getTime())
          .map((o) => formatOrderLine(o, caseRecord.createdAt))
          .join("\n")
      : "（治療系オーダーはありませんでした）";

  const vitalLine = latestVital
    ? `体温${latestVital.temperature ?? "—"}℃ / 血圧${latestVital.systolicBp ?? "—"}/${latestVital.diastolicBp ?? "—"} / 脈拍${latestVital.pulse ?? "—"} / SpO2${latestVital.spo2 ?? "—"}% / 呼吸数${latestVital.respRate ?? "—"}`
    : "（記録なし）";

  const guidelineSection = guideline
    ? `# 採点ルーブリック（教員が登録した、この症例で期待される治療方針・評価基準）\n${guideline}`
    : "# 採点ルーブリック\n（この症例には教員によるルーブリックが登録されていません。一般的な臨床的観点から評価してください）";

  return `あなたは医学教育シミュレーションにおいて、症例終了（退院または死亡）にあたり、学生がこれまでに行った診療全体を振り返る総括フィードバックを作成する評価者です。

# 症例情報
- 症例名: ${caseRecord.title}
- 患者: ${caseRecord.patientName}（${caseRecord.patientAge}歳 ${caseRecord.patientGender}）
- 病態テンプレート: ${templateName}${templateDescription ? `（${templateDescription}）` : ""}
- プロブレムリスト:
${problemLines}
- 症例転帰: ${CRISIS_STATE_LABEL[crisisState]}
- 症例終了時点の直近バイタルサイン: ${vitalLine}

${guidelineSection}

# 学生がこの症例で行った治療系オーダー（時系列、全件）
${orderLines}

# 治療方針に対するAI評価の推移（オーダー提出のたびに記録された適切性スコア・根拠の履歴）
${formatPastEvaluationsSection(pastEvaluations, caseRecord.createdAt)}
${formatTargetedTherapySection(targetedTherapy)}
# フィードバック作成ルール
1. summaryには、症例全体を通じた治療方針・診療プロセスに対する総評を日本語で3〜5文程度で記述する。症例転帰（死亡・急変未解決の場合は特に）を踏まえた記述にすること。
2. strengthsには、学生の診療の中で評価できる点を、具体的な行為やタイミングに触れながら日本語の箇条書き（各1文程度）で列挙する。該当する点が乏しい場合は無理に数を揃えず、最小限（1件）でもよい。
3. improvementsには、今後の学習のために改善すべき点を、具体的かつ建設的に日本語の箇条書き（各1文程度）で列挙する。ルーブリックがある場合はそれに照らした不足点を優先する。症例転帰が死亡・急変未解決の場合は、その転帰につながった治療上の課題を必ず含めること。改善点が特に無い場合も、今後さらに伸ばせる観点を1件は挙げること。
4. 採点や説教のような口調ではなく、学習者の今後の成長を支援する建設的なフィードバックの文体で書くこと。
5. すべて日本語で、指定されたJSON形式のみで返すこと。`;
}

export type DischargeFeedbackResult = {
  summary: string;
  strengths: string[];
  improvements: string[];
  rawResponse: string;
};

export async function generateDischargeFeedback(params: {
  caseRecord: FeedbackCase;
  templateName: string;
  templateDescription: string | null;
  guideline: string | null;
  crisisState: CrisisState;
  problems: { label: string; isPrimary: boolean }[];
  orders: TreatmentEvaluationOrder[];
  pastEvaluations: PastEvaluationSummary[];
  latestVital: Vital | null;
  targetedTherapy: TargetedTherapyContext | null;
}): Promise<DischargeFeedbackResult> {
  const prompt = buildDischargeFeedbackPrompt(params);

  const config = {
    temperature: 0.3,
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING, description: "症例全体を通じた総評。日本語で3〜5文" },
        strengths: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "良かった点。日本語の箇条書き（各1文程度）",
        },
        improvements: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "改善点。日本語の箇条書き（各1文程度）",
        },
      },
      required: ["summary", "strengths", "improvements"],
    },
  };

  const response = await generateWithFallback({ contents: [{ role: "user", parts: [{ text: prompt }] }], config });
  const text = response.text?.trim();
  if (!text) throw new Error("退院時フィードバック: 空の応答が返されました");

  let parsed: { summary?: unknown; strengths?: unknown; improvements?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`退院時フィードバック: 応答のJSONパースに失敗しました: ${text.slice(0, 200)}`);
  }

  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  if (!summary) throw new Error("退院時フィードバック: summaryが空です");

  const toStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : [];

  const strengths = toStringArray(parsed.strengths);
  const improvements = toStringArray(parsed.improvements);

  return { summary, strengths, improvements, rawResponse: text };
}
