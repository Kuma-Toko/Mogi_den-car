import "server-only";
import { ApiError, GoogleGenAI, type Content, type GenerateContentConfig, type GenerateContentResponse } from "@google/genai";
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

// 呼び出し元（問診AI・AI治療評価）で共通のモデルフォールバック付き呼び出し。429（レート制限）のときだけ
// 次のモデルに切り替え、それ以外のエラーは即座に投げる。
export async function generateWithFallback(params: {
  contents: Content[];
  config: GenerateContentConfig;
}): Promise<GenerateContentResponse> {
  const ai = getClient();
  const models = [process.env.GEMINI_MODEL || DEFAULT_MODEL, ...FALLBACK_MODELS];
  let lastError: unknown;

  for (const model of models) {
    try {
      return await ai.models.generateContent({ model, contents: params.contents, config: params.config });
    } catch (err) {
      lastError = err;
      if (!(err instanceof ApiError && err.status === 429)) throw err;
      console.warn(`[gemini] ${model} がレート制限に達したため次のモデルに切り替えます`);
    }
  }

  throw lastError;
}

export type EncounterHistoryItem = { role: "STUDENT" | "PATIENT"; content: string };

type EncounterCase = Pick<
  Case,
  "title" | "patientName" | "patientAge" | "patientGender" | "historyScript" | "examScript"
>;

function buildSystemInstruction(
  caseRecord: EncounterCase,
  problems: Pick<Problem, "label" | "isPrimary">[],
  latestVital: Vital | null,
  pathogenName: string | null
): string {
  const problemLines = problems.length > 0 ? problems.map((p) => `- ${p.label}${p.isPrimary ? "（主病態）" : ""}`).join("\n") : "（未登録）";

  const vitalLine = latestVital
    ? `体温${latestVital.temperature ?? "—"}℃ / 血圧${latestVital.systolicBp ?? "—"}/${latestVital.diastolicBp ?? "—"} / 脈拍${latestVital.pulse ?? "—"} / SpO2${latestVital.spo2 ?? "—"}% / 呼吸数${latestVital.respRate ?? "—"}`
    : "（記録なし）";

  const pathogenLine = pathogenName
    ? `- 真の原因病原体: ${pathogenName}（この病原体らしい症状・経過になるよう応答の一貫性を保つための参考情報。次の「学生に明かさない情報」を厳守すること）`
    : "";

  return `あなたは医学教育シミュレーションにおける模擬患者、および診察時の客観的所見の語り手を演じます。

# 症例情報（学生には見せない内部設定）
- 症例名: ${caseRecord.title}
- 患者: ${caseRecord.patientName}（${caseRecord.patientAge}歳 ${caseRecord.patientGender}）
- プロブレムリスト:
${problemLines}
- 直近のバイタルサイン: ${vitalLine}
${pathogenLine}

# 問診シナリオ台本（現病歴・既往歴・アレルギー・生活歴など。学生の質問に対する回答の根拠）
${caseRecord.historyScript?.trim() || "（台本未設定。症例のプロブレムやバイタルと矛盾しない範囲で常識的に応答してください）"}

# 身体診察所見台本（視診・触診・打診・聴診など系統別の所見。診察指示に対する回答の根拠）
${caseRecord.examScript?.trim() || "（台本未設定。症例のプロブレムやバイタルと矛盾しない範囲で常識的な所見を返してください）"}

# 応答のルール
1. 学生の発言が「質問」（問診）の場合は、患者本人として一人称で、症状や困りごとを話す一般の患者らしい言葉で答える。医学用語は使わない。
   - クローズドクエスチョン（はい/いいえや、特定の事実を一つ尋ねる質問）には端的に答える。補足を加える場合も1文程度にとどめる。
   - オープンクエスチョン（症状や経過を自由に尋ねる質問）には長さを特に制限しない。患者として自然に話してよい。
2. 学生の発言が「診察の実施」（身体診察・触診・聴診など）の場合は、検者への客観的な所見として三人称的・簡潔に答える（例:「腹部は平坦・軟。心窩部に軽度の圧痛を認める。反跳痛なし。」）。
3. あなたが演じられるのは問診・身体診察の範囲に限られる。検査（血液検査・画像検査・培養検査等）の結果や数値、バイタルサインの具体的な数値・測定値を学生から尋ねられても、それらは回答しない。患者はそのような数値を把握していないという体で「詳しい数値は分かりません」等と答えるか、検者（学生）自身が測定・オーダーして確認するよう促す。バイタルサインは触診・視診で分かる範囲の主観的表現（例:「熱っぽい」「脈が速い気がする」）にとどめ、具体的な数値は絶対に述べない。
4. 診断名・病名・原因病原体の名称・検査結果の医学的解釈・治療方針など「まだ学生が明らかにしていないはずの情報」は、台本に明記されていない内容を尋ねられた場合も含め、一切先回りして教えない。上記「真の原因病原体」は応答の一貫性を保つための内部参考情報に過ぎず、その名称や関連する専門用語を学生に直接的にも間接的にも明かしてはならない。
5. 患者を演じる際も、AIであることや「シナリオ」「台本」という言葉には一切言及しない。`;
}

export async function generatePatientReply(params: {
  caseRecord: EncounterCase;
  problems: Pick<Problem, "label" | "isPrimary">[];
  latestVital: Vital | null;
  pathogenName: string | null;
  history: EncounterHistoryItem[];
}): Promise<string> {
  const { caseRecord, problems, latestVital, pathogenName, history } = params;

  const contents = history.map((m) => ({
    role: m.role === "STUDENT" ? ("user" as const) : ("model" as const),
    parts: [{ text: m.content }],
  }));
  const config = {
    systemInstruction: buildSystemInstruction(caseRecord, problems, latestVital, pathogenName),
    temperature: 0.7,
  };

  const response = await generateWithFallback({ contents, config });
  const text = response.text?.trim();
  return text || "（応答を生成できませんでした。もう一度お試しください）";
}
