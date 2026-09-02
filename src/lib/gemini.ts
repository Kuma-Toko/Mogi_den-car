import "server-only";
import { ApiError, GoogleGenAI } from "@google/genai";
import type { Case, Problem, Vital } from "@prisma/client";

// Flash-Liteはコスト・レート制限最優先のトライアル運用を想定して採用。
// Flash系と異なりFlash-Liteにはfloating alias（gemini-flash-latest相当）が無いため、
// ここはバージョン固定。2.5系は2026年10月に提供終了予定なので3.x系を使う。
// 提供終了の告知が出たら随時ここを最新版（例: gemini-3.6-flash-lite等）に更新すること。
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

// 無料枠のレート制限（RPM/RPD）はモデルごとに別枠なので、最初のモデルの枠を使い切っても
// 次のモデルはまだ空いていることが多い。429（RESOURCE_EXHAUSTED）の時だけ次に回す。
const FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-flash-latest"];

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY が設定されていません（.envを確認してください）。");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export type EncounterHistoryItem = { role: "STUDENT" | "PATIENT"; content: string };

type EncounterCase = Pick<
  Case,
  "title" | "patientName" | "patientAge" | "patientGender" | "historyScript" | "examScript"
>;

function buildSystemInstruction(
  caseRecord: EncounterCase,
  problems: Pick<Problem, "label" | "isPrimary">[],
  latestVital: Vital | null
): string {
  const problemLines = problems.length > 0 ? problems.map((p) => `- ${p.label}${p.isPrimary ? "（主病態）" : ""}`).join("\n") : "（未登録）";

  const vitalLine = latestVital
    ? `体温${latestVital.temperature ?? "—"}℃ / 血圧${latestVital.systolicBp ?? "—"}/${latestVital.diastolicBp ?? "—"} / 脈拍${latestVital.pulse ?? "—"} / SpO2${latestVital.spo2 ?? "—"}% / 呼吸数${latestVital.respRate ?? "—"}`
    : "（記録なし）";

  return `あなたは医学教育シミュレーションにおける模擬患者、および診察時の客観的所見の語り手を演じます。

# 症例情報（学生には見せない内部設定）
- 症例名: ${caseRecord.title}
- 患者: ${caseRecord.patientName}（${caseRecord.patientAge}歳 ${caseRecord.patientGender}）
- プロブレムリスト:
${problemLines}
- 直近のバイタルサイン: ${vitalLine}

# 問診シナリオ台本（現病歴・既往歴・アレルギー・生活歴など。学生の質問に対する回答の根拠）
${caseRecord.historyScript?.trim() || "（台本未設定。症例のプロブレムやバイタルと矛盾しない範囲で常識的に応答してください）"}

# 身体診察所見台本（視診・触診・打診・聴診など系統別の所見。診察指示に対する回答の根拠）
${caseRecord.examScript?.trim() || "（台本未設定。症例のプロブレムやバイタルと矛盾しない範囲で常識的な所見を返してください）"}

# 応答のルール
1. 学生の発言が「質問」（問診）の場合は、患者本人として一人称で、症状や困りごとを話す一般の患者らしい言葉で答える。医学用語は使わない。
2. 学生の発言が「診察の実施」（身体診察・触診・聴診など）の場合は、検者への客観的な所見として三人称的・簡潔に答える（例:「腹部は平坦・軟。心窩部に軽度の圧痛を認める。反跳痛なし。」）。
3. 台本に明記されていない内容を聞かれた場合は、症例の設定と矛盾しない範囲で自然に即興で補ってよいが、診断名・検査結果の医学的解釈・治療方針など「まだ学生が明らかにしていないはずの情報」を先回りして教えない。
4. 患者を演じる際も、AIであることや「シナリオ」「台本」という言葉には一切言及しない。
5. 回答は簡潔に（日本語で2〜4文程度を目安に）。`;
}

export async function generatePatientReply(params: {
  caseRecord: EncounterCase;
  problems: Pick<Problem, "label" | "isPrimary">[];
  latestVital: Vital | null;
  history: EncounterHistoryItem[];
}): Promise<string> {
  const { caseRecord, problems, latestVital, history } = params;

  const ai = getClient();
  const contents = history.map((m) => ({
    role: m.role === "STUDENT" ? ("user" as const) : ("model" as const),
    parts: [{ text: m.content }],
  }));
  const config = {
    systemInstruction: buildSystemInstruction(caseRecord, problems, latestVital),
    temperature: 0.7,
  };

  const models = [process.env.GEMINI_MODEL || DEFAULT_MODEL, ...FALLBACK_MODELS];
  let lastError: unknown;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({ model, contents, config });
      const text = response.text?.trim();
      return text || "（応答を生成できませんでした。もう一度お試しください）";
    } catch (err) {
      lastError = err;
      if (!(err instanceof ApiError && err.status === 429)) throw err;
      console.warn(`[gemini] ${model} がレート制限に達したため次のモデルに切り替えます`);
    }
  }

  throw lastError;
}
