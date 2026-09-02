import type { Case, Order } from "@prisma/client";
import { DEFAULT_PHYSIOLOGY_PARAMS, type PhysiologyParams } from "@/lib/physiology";
import { formatLabValues, type LabValue } from "@/lib/lab-reference-ranges";

export type SeverityTier = "mild" | "moderate" | "severe";

export type VitalPoint = {
  temperature: number;
  systolicBp: number;
  diastolicBp: number;
  pulse: number;
  spo2: number;
  respRate: number;
};

type VitalCoefficients = {
  base: VitalPoint;
  perSeverity: VitalPoint; // 重症度100あたりの増減量（base + perSeverity * severity/100）
};

type TextPatternSet = { kind: "text"; patterns: Record<SeverityTier, string> };
type ValuePatternSet = { kind: "values"; patterns: Record<SeverityTier, LabValue[]> };
type PatternSet = TextPatternSet | ValuePatternSet;

// このテンプレートにおける「治療開始」とみなす条件。drugCategoriesは処方・注射オーダーの薬剤大分類、
// procedureKeywordsは処置・手術オーダーのlabelに含まれる文字列（部分一致）。どちらか一方でも指定でき、
// 両方指定した場合はいずれか早く条件を満たしたオーダーの時刻を治療開始時刻として採用する。
type TreatmentTrigger = {
  drugCategories?: string[];
  procedureKeywords?: string[];
};

// 危機シナリオ（急変・死亡モデル）の発動条件。severityは重症度そのもの、labはその時点の重症度から
// 導かれる動的検査所見（resolveDynamicLabの数値項目）、vitalはその時点の重症度から導かれるバイタルを参照する。
// いずれもテンプレートの通常の重症度カーブ上の値を見るだけで、学生が実際にその検査をオーダーしたかは問わない
// （＝オーダーの有無に関わらず、患者の「真の」病態として急変しうる）。
// labトリガーのlabelは、1つの検査項目コードが複数の値を返す（例: 動脈血液ガス分析がpH/pCO2/pO2等を
// まとめて返す）場合に、そのうちどの値を見るかを指定する。省略時は配列の先頭（values[0]）を見る。
export type CrisisTrigger =
  | { type: "severity"; op: ">=" | "<="; value: number }
  | { type: "lab"; code: string; label?: string; op: ">=" | "<="; value: number }
  | { type: "vital"; field: keyof VitalPoint; op: ">=" | "<="; value: number };

// 危機シナリオから脱するための救命オーダー。TreatmentTrigger同様、薬剤大分類 or 処置・手術labelの部分一致。
export type CrisisRescueAction = {
  label: string;
  drugCategories?: string[];
  procedureKeywords?: string[];
};

export type CrisisScenario = {
  name: string; // 表示名（例: "心室細動・心停止"）
  triggers: CrisisTrigger[]; // いずれか1つで発動（OR）
  windowMinutes: number; // 発動後この時間内に救命オーダーがなければ死亡（crisisMode=LETHALの場合）
  rescueActions: CrisisRescueAction[]; // いずれか1つのオーダーで危機を脱する
  crisisVitals: VitalPoint; // 危機発生中（CRITICAL/DECEASED）は通常の重症度カーブでなくこの固定値を表示
  postRescueSeverity: number; // 救命成功後にリセットする重症度
};

type TemplateConfig = {
  treatment: TreatmentTrigger;
  vitals: VitalCoefficients;
  // 検査項目コード（LabItemMaster.code）ごとの重症度別所見パターン。
  // 数値化できる項目はvalues（H/L判定・色分け表示の対象）、画像所見・培養結果などの定性的な項目はtextを使う。
  labPatterns: Record<string, PatternSet>;
  crisis: CrisisScenario;
};

// 全テンプレート共通の危機シナリオの猶予時間。現実の急変対応時間より大幅に長いが、
// 症例の進行ペース（実時間 or シミュレーション時間の単位が時間〜日オーダー）に合わせて
// あえてこの値を採用している（ユーザー指示）。
export const CRISIS_WINDOW_MINUTES = 480;

const TEMPLATE_CONFIG: Record<string, TemplateConfig> = {
  infection: {
    treatment: { drugCategories: ["抗菌薬"] },
    vitals: {
      base: { temperature: 36.5, systolicBp: 122, diastolicBp: 76, pulse: 72, spo2: 99, respRate: 15 },
      perSeverity: { temperature: 3.4, systolicBp: -22, diastolicBp: -14, pulse: 48, spo2: -14, respRate: 13 },
    },
    labPatterns: {
      "2A010": {
        // 白血球数（WBC）
        kind: "values",
        patterns: {
          mild: [{ label: "WBC", value: 9800, unit: "/μL" }],
          moderate: [{ label: "WBC", value: 14200, unit: "/μL", note: "好中球優位" }],
          severe: [{ label: "WBC", value: 19800, unit: "/μL", note: "好中球優位・核左方移動" }],
        },
      },
      "5C070": {
        // C反応性蛋白（CRP）
        kind: "values",
        patterns: {
          mild: [{ label: "CRP", value: 1.2, unit: "mg/dL" }],
          moderate: [{ label: "CRP", value: 8.9, unit: "mg/dL" }],
          severe: [{ label: "CRP", value: 22.4, unit: "mg/dL" }],
        },
      },
      "MB-001": {
        // 血液培養（2セット）
        kind: "text",
        patterns: {
          mild: "陰性（48時間培養、有意菌の発育なし）",
          moderate: "グラム陽性球菌を少数検出（同定検査中）",
          severe: "グラム陰性桿菌を検出、同定検査中（菌血症の可能性）",
        },
      },
      "IMG-001": {
        // 胸部X線
        kind: "text",
        patterns: {
          mild: "軽度の透亮性低下を認めるが、明らかな浸潤影は指摘できない。",
          moderate: "右下肺野に浸潤影を認める。",
          severe: "両側肺野に広範な浸潤影を認め、一部に無気肺を疑う所見あり。",
        },
      },
      "IMG-CT-007": {
        // 胸部CT（単純）
        kind: "text",
        patterns: {
          mild: "スリガラス影を軽度に認めるが、明らかな浸潤影は指摘できない。",
          moderate: "右下葉主体に浸潤影とair bronchogramを認める。",
          severe: "両側多葉にわたる広範な浸潤影を認め、一部に膿瘍形成・胸水貯留を疑う。",
        },
      },
    },
    crisis: {
      name: "敗血症性ショック・心停止",
      triggers: [
        { type: "vital", field: "systolicBp", op: "<=", value: 100 },
        { type: "lab", code: "5C070", op: ">=", value: 22.4 },
      ],
      windowMinutes: CRISIS_WINDOW_MINUTES,
      rescueActions: [
        { label: "急速輸液", drugCategories: ["輸液"] },
        { label: "気管挿管・人工呼吸管理", procedureKeywords: ["気管挿管"] },
      ],
      crisisVitals: { temperature: 35.0, systolicBp: 68, diastolicBp: 40, pulse: 138, spo2: 79, respRate: 32 },
      postRescueSeverity: 55,
    },
  },
  heart_failure: {
    treatment: { drugCategories: ["利尿薬"] },
    vitals: {
      base: { temperature: 36.6, systolicBp: 145, diastolicBp: 88, pulse: 78, spo2: 97, respRate: 16 },
      perSeverity: { temperature: 0.8, systolicBp: 10, diastolicBp: 6, pulse: 32, spo2: -17, respRate: 14 },
    },
    labPatterns: {
      H8039: {
        // ヒト脳性Na利尿ペプチド（BNP）
        kind: "values",
        patterns: {
          mild: [{ label: "BNP", value: 180, unit: "pg/mL" }],
          moderate: [{ label: "BNP", value: 620, unit: "pg/mL" }],
          severe: [{ label: "BNP", value: 1450, unit: "pg/mL" }],
        },
      },
      "IMG-001": {
        // 胸部X線
        kind: "text",
        patterns: {
          mild: "軽度の肺うっ血を疑う所見。心胸郭比はやや拡大。",
          moderate: "肺うっ血像と胸水貯留を認める。心胸郭比拡大。",
          severe: "著明な肺うっ血、両側胸水、心拡大を認める。",
        },
      },
      "IMG-US-001": {
        // 心エコー（経胸壁）
        kind: "text",
        patterns: {
          mild: "左室駆出率は軽度低下（LVEF 45%）。びまん性壁運動低下を軽度に認める。",
          moderate: "左室駆出率は中等度低下（LVEF 35%）。びまん性壁運動低下を認め、軽度の機能性僧帽弁逆流を伴う。",
          severe: "左室駆出率は高度低下（LVEF 25%）。著明なびまん性壁運動低下と中等度以上の機能性僧帽弁逆流を認める。下大静脈は拡張し呼吸性変動を欠く。",
        },
      },
    },
    crisis: {
      name: "心原性ショック・肺水腫増悪",
      triggers: [{ type: "lab", code: "H8039", op: ">=", value: 1450 }],
      windowMinutes: CRISIS_WINDOW_MINUTES,
      rescueActions: [
        { label: "強心薬投与", drugCategories: ["強心配糖体"] },
        { label: "気管挿管・人工呼吸管理", procedureKeywords: ["気管挿管"] },
      ],
      crisisVitals: { temperature: 36.0, systolicBp: 72, diastolicBp: 48, pulse: 130, spo2: 68, respRate: 34 },
      postRescueSeverity: 50,
    },
  },
  dehydration: {
    treatment: { drugCategories: ["輸液"] },
    vitals: {
      base: { temperature: 36.8, systolicBp: 122, diastolicBp: 78, pulse: 76, spo2: 98, respRate: 16 },
      perSeverity: { temperature: 1.0, systolicBp: -32, diastolicBp: -18, pulse: 44, spo2: -4, respRate: 6 },
    },
    labPatterns: {
      "3C015": {
        // クレアチニン（Cr）
        kind: "values",
        patterns: {
          mild: [{ label: "Cr", value: 1.1, unit: "mg/dL" }],
          moderate: [{ label: "Cr", value: 1.6, unit: "mg/dL" }],
          severe: [{ label: "Cr", value: 2.4, unit: "mg/dL" }],
        },
      },
      "3C025": {
        // 尿素窒素（BUN）
        kind: "values",
        patterns: {
          mild: [{ label: "BUN", value: 22, unit: "mg/dL" }],
          moderate: [{ label: "BUN", value: 38, unit: "mg/dL" }],
          severe: [{ label: "BUN", value: 55, unit: "mg/dL" }],
        },
      },
      "3H010": {
        // ナトリウム（Na）
        kind: "values",
        patterns: {
          mild: [{ label: "Na", value: 142, unit: "mEq/L" }],
          moderate: [{ label: "Na", value: 148, unit: "mEq/L" }],
          severe: [{ label: "Na", value: 152, unit: "mEq/L" }],
        },
      },
    },
    crisis: {
      name: "循環血液量減少性ショック",
      triggers: [
        { type: "lab", code: "3C015", op: ">=", value: 2.4 },
        { type: "lab", code: "3H010", op: ">=", value: 152 },
      ],
      windowMinutes: CRISIS_WINDOW_MINUTES,
      rescueActions: [{ label: "急速輸液", drugCategories: ["輸液"] }],
      crisisVitals: { temperature: 35.5, systolicBp: 62, diastolicBp: 38, pulse: 142, spo2: 90, respRate: 28 },
      postRescueSeverity: 45,
    },
  },
  dka: {
    treatment: { drugCategories: ["糖尿病治療薬"] },
    vitals: {
      base: { temperature: 36.8, systolicBp: 118, diastolicBp: 74, pulse: 88, spo2: 98, respRate: 18 },
      perSeverity: { temperature: -0.4, systolicBp: -20, diastolicBp: -12, pulse: 30, spo2: -4, respRate: 16 },
    },
    labPatterns: {
      "3D010": {
        // グルコース
        kind: "values",
        patterns: {
          mild: [{ label: "Glu", value: 220, unit: "mg/dL" }],
          moderate: [{ label: "Glu", value: 380, unit: "mg/dL" }],
          severe: [{ label: "Glu", value: 560, unit: "mg/dL" }],
        },
      },
      "3H080": {
        // 動脈血液ガス分析（代謝性アシドーシス・呼吸性代償）
        kind: "values",
        patterns: {
          mild: [
            { label: "動脈血pH", value: 7.32, unit: "" },
            { label: "pCO2", value: 30, unit: "mmHg", note: "呼吸性代償" },
            { label: "pO2", value: 92, unit: "mmHg" },
            { label: "血漿HCO3", value: 16, unit: "mEq/L" },
            { label: "BE", value: -8, unit: "mEq/L" },
          ],
          moderate: [
            { label: "動脈血pH", value: 7.2, unit: "" },
            { label: "pCO2", value: 25, unit: "mmHg", note: "呼吸性代償" },
            { label: "pO2", value: 90, unit: "mmHg" },
            { label: "血漿HCO3", value: 10, unit: "mEq/L" },
            { label: "BE", value: -15, unit: "mEq/L" },
          ],
          severe: [
            { label: "動脈血pH", value: 7.05, unit: "" },
            { label: "pCO2", value: 18, unit: "mmHg", note: "Kussmaul呼吸" },
            { label: "pO2", value: 88, unit: "mmHg" },
            { label: "血漿HCO3", value: 5, unit: "mEq/L" },
            { label: "BE", value: -22, unit: "mEq/L" },
          ],
        },
      },
      "3H015": {
        // カリウム（K）
        kind: "values",
        patterns: {
          mild: [{ label: "K", value: 5.2, unit: "mEq/L" }],
          moderate: [{ label: "K", value: 5.8, unit: "mEq/L" }],
          severe: [{ label: "K", value: 6.5, unit: "mEq/L" }],
        },
      },
    },
    crisis: {
      name: "糖尿病性ケトアシドーシス昏睡",
      triggers: [
        { type: "lab", code: "3H080", op: "<=", value: 7.05 },
        { type: "lab", code: "3H015", op: ">=", value: 6.5 },
      ],
      windowMinutes: CRISIS_WINDOW_MINUTES,
      rescueActions: [
        { label: "インスリン持続投与", drugCategories: ["糖尿病治療薬"] },
        { label: "急速輸液・カリウム補正", drugCategories: ["輸液"] },
      ],
      crisisVitals: { temperature: 35.8, systolicBp: 78, diastolicBp: 46, pulse: 128, spo2: 92, respRate: 34 },
      postRescueSeverity: 45,
    },
  },
  acs: {
    treatment: { drugCategories: ["抗血小板薬"] },
    vitals: {
      base: { temperature: 36.6, systolicBp: 112, diastolicBp: 70, pulse: 92, spo2: 96, respRate: 18 },
      perSeverity: { temperature: 0.2, systolicBp: -30, diastolicBp: -16, pulse: 20, spo2: -10, respRate: 8 },
    },
    labPatterns: {
      "5C093": {
        // トロポニンT
        kind: "values",
        patterns: {
          mild: [{ label: "トロポニンT", value: 0.05, unit: "ng/mL" }],
          moderate: [{ label: "トロポニンT", value: 0.3, unit: "ng/mL" }],
          severe: [{ label: "トロポニンT", value: 1.2, unit: "ng/mL" }],
        },
      },
      "5C094": {
        // トロポニンI
        kind: "values",
        patterns: {
          mild: [{ label: "トロポニンI", value: 60, unit: "pg/mL" }],
          moderate: [{ label: "トロポニンI", value: 300, unit: "pg/mL" }],
          severe: [{ label: "トロポニンI", value: 1200, unit: "pg/mL" }],
        },
      },
      "3B015": {
        // CK-MB
        kind: "values",
        patterns: {
          mild: [{ label: "CK-MB", value: 30, unit: "U/L" }],
          moderate: [{ label: "CK-MB", value: 70, unit: "U/L" }],
          severe: [{ label: "CK-MB", value: 150, unit: "U/L" }],
        },
      },
      "IMG-CT-010": {
        // 冠動脈CT（造影）
        kind: "text",
        patterns: {
          mild: "1枝に軽度〜中等度の狭窄疑いを認める。",
          moderate: "1〜2枝に有意狭窄（50〜70%）を認める。",
          severe: "多枝に高度狭窄（90%以上）を認め、急性冠症候群の所見と矛盾しない。",
        },
      },
    },
    crisis: {
      name: "心室細動・心停止",
      triggers: [{ type: "vital", field: "systolicBp", op: "<=", value: 82 }],
      windowMinutes: CRISIS_WINDOW_MINUTES,
      rescueActions: [
        { label: "除細動", procedureKeywords: ["除細動"] },
        { label: "抗血小板薬強化投与", drugCategories: ["抗血小板薬"] },
      ],
      crisisVitals: { temperature: 36.2, systolicBp: 0, diastolicBp: 0, pulse: 0, spo2: 75, respRate: 6 },
      postRescueSeverity: 55,
    },
  },
  pe: {
    treatment: { drugCategories: ["抗凝固薬"] },
    vitals: {
      base: { temperature: 36.7, systolicBp: 116, diastolicBp: 74, pulse: 92, spo2: 94, respRate: 20 },
      perSeverity: { temperature: 0.1, systolicBp: -28, diastolicBp: -14, pulse: 28, spo2: -22, respRate: 14 },
    },
    labPatterns: {
      "2B140": {
        // D-Dダイマー（FDP Dダイマー）
        kind: "values",
        patterns: {
          mild: [{ label: "Dダイマー", value: 1.5, unit: "μg/mL" }],
          moderate: [{ label: "Dダイマー", value: 4.0, unit: "μg/mL" }],
          severe: [{ label: "Dダイマー", value: 9.0, unit: "μg/mL" }],
        },
      },
      "IMG-CT-009": {
        // 肺動脈CT（造影・肺塞栓プロトコル）
        kind: "text",
        patterns: {
          mild: "区域枝レベルに小範囲の造影欠損を認める。",
          moderate: "葉枝レベルに造影欠損を認め、肺塞栓と矛盾しない。",
          severe: "肺動脈本幹〜主要分枝に広範な造影欠損を認め、右心負荷所見を伴う。",
        },
      },
      "IMG-US-004": {
        // 下肢エコー
        kind: "text",
        patterns: {
          mild: "下腿静脈に軽度の血流うっ滞を認めるが明らかな血栓像はない。",
          moderate: "膝窩静脈に圧迫不能な血栓像を認める。",
          severe: "大腿静脈〜膝窩静脈にかけて広範な閉塞性血栓を認める。",
        },
      },
    },
    crisis: {
      name: "肺塞栓・心停止",
      triggers: [
        { type: "lab", code: "2B140", op: ">=", value: 9.0 },
        { type: "vital", field: "spo2", op: "<=", value: 72 },
      ],
      windowMinutes: CRISIS_WINDOW_MINUTES,
      rescueActions: [
        { label: "血栓溶解・抗凝固強化", drugCategories: ["抗凝固薬"] },
        { label: "気管挿管・人工呼吸管理", procedureKeywords: ["気管挿管"] },
      ],
      crisisVitals: { temperature: 36.0, systolicBp: 58, diastolicBp: 36, pulse: 145, spo2: 65, respRate: 8 },
      postRescueSeverity: 50,
    },
  },
  asthma_copd: {
    treatment: { drugCategories: ["気管支拡張薬"] },
    vitals: {
      base: { temperature: 36.6, systolicBp: 126, diastolicBp: 78, pulse: 92, spo2: 95, respRate: 22 },
      perSeverity: { temperature: 0.2, systolicBp: 2, diastolicBp: 2, pulse: 22, spo2: -20, respRate: 16 },
    },
    labPatterns: {
      "3H080": {
        // 動脈血液ガス分析（急性増悪・慢性COPDの腎代償を背景とした呼吸性アシドーシス進行）
        kind: "values",
        patterns: {
          mild: [
            { label: "動脈血pH", value: 7.38, unit: "" },
            { label: "pCO2", value: 36, unit: "mmHg" },
            { label: "pO2", value: 75, unit: "mmHg" },
            { label: "O2飽和度", value: 93, unit: "%" },
            { label: "血漿HCO3", value: 25, unit: "mEq/L" },
            { label: "BE", value: 1, unit: "mEq/L" },
          ],
          moderate: [
            { label: "動脈血pH", value: 7.32, unit: "" },
            { label: "pCO2", value: 46, unit: "mmHg", note: "CO2貯留傾向" },
            { label: "pO2", value: 60, unit: "mmHg" },
            { label: "O2飽和度", value: 87, unit: "%" },
            { label: "血漿HCO3", value: 26, unit: "mEq/L" },
            { label: "BE", value: 2, unit: "mEq/L" },
          ],
          severe: [
            { label: "動脈血pH", value: 7.18, unit: "" },
            { label: "pCO2", value: 60, unit: "mmHg", note: "CO2貯留" },
            { label: "pO2", value: 45, unit: "mmHg" },
            { label: "O2飽和度", value: 78, unit: "%" },
            { label: "血漿HCO3", value: 28, unit: "mEq/L" },
            { label: "BE", value: 3, unit: "mEq/L" },
          ],
        },
      },
    },
    crisis: {
      name: "呼吸不全・心肺停止",
      triggers: [
        { type: "lab", code: "3H080", label: "pCO2", op: ">=", value: 60 },
        { type: "lab", code: "3H080", label: "O2飽和度", op: "<=", value: 78 },
      ],
      windowMinutes: CRISIS_WINDOW_MINUTES,
      rescueActions: [
        { label: "気管挿管・人工呼吸管理", procedureKeywords: ["気管挿管"] },
        { label: "気管支拡張薬強化投与", drugCategories: ["気管支拡張薬"] },
      ],
      crisisVitals: { temperature: 36.5, systolicBp: 100, diastolicBp: 60, pulse: 130, spo2: 62, respRate: 6 },
      postRescueSeverity: 45,
    },
  },
  thyroid_storm: {
    treatment: { drugCategories: ["甲状腺関連薬"] },
    vitals: {
      base: { temperature: 37.3, systolicBp: 130, diastolicBp: 76, pulse: 112, spo2: 97, respRate: 18 },
      perSeverity: { temperature: 2.8, systolicBp: 8, diastolicBp: -8, pulse: 48, spo2: -5, respRate: 8 },
    },
    labPatterns: {
      "4B015": {
        // 遊離トリヨードサイロニン（FT3）
        kind: "values",
        patterns: {
          mild: [{ label: "FT3", value: 6.0, unit: "pg/mL" }],
          moderate: [{ label: "FT3", value: 9.0, unit: "pg/mL" }],
          severe: [{ label: "FT3", value: 14.0, unit: "pg/mL" }],
        },
      },
      "4B035": {
        // 遊離サイロキシン（FT4）
        kind: "values",
        patterns: {
          mild: [{ label: "FT4", value: 2.8, unit: "ng/dL" }],
          moderate: [{ label: "FT4", value: 4.2, unit: "ng/dL" }],
          severe: [{ label: "FT4", value: 6.5, unit: "ng/dL" }],
        },
      },
      "4A055": {
        // 甲状腺刺激ホルモン（TSH）
        kind: "values",
        patterns: {
          mild: [{ label: "TSH", value: 0.05, unit: "μIU/mL" }],
          moderate: [{ label: "TSH", value: 0.02, unit: "μIU/mL" }],
          severe: [{ label: "TSH", value: 0.01, unit: "μIU/mL" }],
        },
      },
    },
    crisis: {
      name: "甲状腺クリーゼ・多臓器不全",
      triggers: [
        { type: "lab", code: "4B015", op: ">=", value: 14.0 },
        { type: "lab", code: "4B035", op: ">=", value: 6.5 },
      ],
      windowMinutes: CRISIS_WINDOW_MINUTES,
      rescueActions: [{ label: "β遮断薬・抗甲状腺薬強化投与", drugCategories: ["β遮断薬", "甲状腺関連薬"] }],
      crisisVitals: { temperature: 41.0, systolicBp: 80, diastolicBp: 40, pulse: 168, spo2: 88, respRate: 30 },
      postRescueSeverity: 50,
    },
  },
  gi_bleed: {
    treatment: { drugCategories: ["消化性潰瘍治療薬"] },
    vitals: {
      base: { temperature: 36.5, systolicBp: 114, diastolicBp: 72, pulse: 88, spo2: 98, respRate: 16 },
      perSeverity: { temperature: -0.2, systolicBp: -38, diastolicBp: -20, pulse: 40, spo2: -3, respRate: 8 },
    },
    labPatterns: {
      "2A030": {
        // ヘモグロビン（Hb）
        kind: "values",
        patterns: {
          mild: [{ label: "Hb", value: 11.0, unit: "g/dL" }],
          moderate: [{ label: "Hb", value: 8.0, unit: "g/dL" }],
          severe: [{ label: "Hb", value: 5.5, unit: "g/dL" }],
        },
      },
      "1B040": {
        // ヘモグロビン[便]
        kind: "values",
        patterns: {
          mild: [{ label: "便Hb", value: 300, unit: "ng/mL" }],
          moderate: [{ label: "便Hb", value: 900, unit: "ng/mL" }],
          severe: [{ label: "便Hb", value: 2500, unit: "ng/mL" }],
        },
      },
      "3C025": {
        // 尿素窒素（UN）
        kind: "values",
        patterns: {
          mild: [{ label: "BUN", value: 26, unit: "mg/dL" }],
          moderate: [{ label: "BUN", value: 42, unit: "mg/dL" }],
          severe: [{ label: "BUN", value: 60, unit: "mg/dL" }],
        },
      },
    },
    crisis: {
      name: "出血性ショック",
      triggers: [{ type: "lab", code: "2A030", op: "<=", value: 5.5 }],
      windowMinutes: CRISIS_WINDOW_MINUTES,
      rescueActions: [
        { label: "輸血", drugCategories: ["血液製剤"] },
        { label: "急速輸液", drugCategories: ["輸液"] },
      ],
      crisisVitals: { temperature: 35.6, systolicBp: 58, diastolicBp: 34, pulse: 148, spo2: 90, respRate: 30 },
      postRescueSeverity: 45,
    },
  },
  pancreatitis: {
    treatment: { drugCategories: ["輸液"] },
    vitals: {
      base: { temperature: 37.1, systolicBp: 116, diastolicBp: 72, pulse: 90, spo2: 97, respRate: 18 },
      perSeverity: { temperature: 1.4, systolicBp: -24, diastolicBp: -14, pulse: 28, spo2: -9, respRate: 10 },
    },
    labPatterns: {
      "3B160": {
        // アミラーゼ
        kind: "values",
        patterns: {
          mild: [{ label: "Amy", value: 300, unit: "U/L" }],
          moderate: [{ label: "Amy", value: 700, unit: "U/L" }],
          severe: [{ label: "Amy", value: 1300, unit: "U/L" }],
        },
      },
      "3B180": {
        // リパーゼ
        kind: "values",
        patterns: {
          mild: [{ label: "リパーゼ", value: 250, unit: "U/L" }],
          moderate: [{ label: "リパーゼ", value: 650, unit: "U/L" }],
          severe: [{ label: "リパーゼ", value: 1400, unit: "U/L" }],
        },
      },
      "3H030": {
        // カルシウム（Ca）
        kind: "values",
        patterns: {
          mild: [{ label: "Ca", value: 8.2, unit: "mg/dL" }],
          moderate: [{ label: "Ca", value: 7.5, unit: "mg/dL" }],
          severe: [{ label: "Ca", value: 6.8, unit: "mg/dL" }],
        },
      },
    },
    crisis: {
      name: "重症急性膵炎・多臓器不全",
      triggers: [{ type: "lab", code: "3H030", op: "<=", value: 6.8 }],
      windowMinutes: CRISIS_WINDOW_MINUTES,
      rescueActions: [{ label: "大量輸液・集中治療", drugCategories: ["輸液"] }],
      crisisVitals: { temperature: 38.8, systolicBp: 66, diastolicBp: 40, pulse: 136, spo2: 84, respRate: 30 },
      postRescueSeverity: 50,
    },
  },
  anaphylaxis: {
    treatment: { drugCategories: ["アドレナリン作動薬", "抗ヒスタミン薬", "副腎皮質ステロイド"] },
    vitals: {
      base: { temperature: 36.7, systolicBp: 110, diastolicBp: 68, pulse: 100, spo2: 96, respRate: 20 },
      perSeverity: { temperature: -0.3, systolicBp: -52, diastolicBp: -30, pulse: 34, spo2: -22, respRate: 12 },
    },
    labPatterns: {
      "5A090": {
        // IgE
        kind: "values",
        patterns: {
          mild: [{ label: "IgE", value: 300, unit: "IU/mL" }],
          moderate: [{ label: "IgE", value: 600, unit: "IU/mL" }],
          severe: [{ label: "IgE", value: 1200, unit: "IU/mL" }],
        },
      },
    },
    crisis: {
      name: "アナフィラキシーショック・心停止",
      triggers: [{ type: "vital", field: "systolicBp", op: "<=", value: 65 }],
      windowMinutes: CRISIS_WINDOW_MINUTES,
      rescueActions: [
        { label: "アドレナリン筋注", drugCategories: ["アドレナリン作動薬"] },
        { label: "気管挿管・人工呼吸管理", procedureKeywords: ["気管挿管"] },
      ],
      crisisVitals: { temperature: 36.0, systolicBp: 50, diastolicBp: 30, pulse: 150, spo2: 68, respRate: 8 },
      postRescueSeverity: 40,
    },
  },
  adrenal_crisis: {
    treatment: { drugCategories: ["副腎皮質ステロイド"] },
    vitals: {
      base: { temperature: 37.0, systolicBp: 98, diastolicBp: 60, pulse: 92, spo2: 97, respRate: 17 },
      perSeverity: { temperature: 0.7, systolicBp: -32, diastolicBp: -18, pulse: 24, spo2: -4, respRate: 7 },
    },
    labPatterns: {
      "4D040": {
        // コルチゾール
        kind: "values",
        patterns: {
          mild: [{ label: "コルチゾール", value: 3.0, unit: "μg/dL" }],
          moderate: [{ label: "コルチゾール", value: 1.5, unit: "μg/dL" }],
          severe: [{ label: "コルチゾール", value: 0.5, unit: "μg/dL" }],
        },
      },
      "3H010": {
        // ナトリウム（Na）
        kind: "values",
        patterns: {
          mild: [{ label: "Na", value: 130, unit: "mEq/L" }],
          moderate: [{ label: "Na", value: 124, unit: "mEq/L" }],
          severe: [{ label: "Na", value: 116, unit: "mEq/L" }],
        },
      },
      "3H015": {
        // カリウム（K）
        kind: "values",
        patterns: {
          mild: [{ label: "K", value: 5.2, unit: "mEq/L" }],
          moderate: [{ label: "K", value: 5.9, unit: "mEq/L" }],
          severe: [{ label: "K", value: 6.8, unit: "mEq/L" }],
        },
      },
    },
    crisis: {
      name: "副腎クリーゼ・循環虚脱",
      triggers: [
        { type: "lab", code: "4D040", op: "<=", value: 0.5 },
        { type: "lab", code: "3H010", op: "<=", value: 116 },
      ],
      windowMinutes: CRISIS_WINDOW_MINUTES,
      rescueActions: [{ label: "ステロイド大量投与・輸液", drugCategories: ["副腎皮質ステロイド", "輸液"] }],
      crisisVitals: { temperature: 35.2, systolicBp: 60, diastolicBp: 36, pulse: 116, spo2: 90, respRate: 24 },
      postRescueSeverity: 45,
    },
  },
  arrhythmia: {
    treatment: { drugCategories: ["抗不整脈薬", "β遮断薬"] },
    vitals: {
      base: { temperature: 36.6, systolicBp: 116, diastolicBp: 76, pulse: 98, spo2: 97, respRate: 17 },
      perSeverity: { temperature: 0, systolicBp: -18, diastolicBp: -10, pulse: 58, spo2: -6, respRate: 6 },
    },
    labPatterns: {
      "3H015": {
        // カリウム（K）
        kind: "values",
        patterns: {
          mild: [{ label: "K", value: 3.3, unit: "mEq/L" }],
          moderate: [{ label: "K", value: 2.8, unit: "mEq/L" }],
          severe: [{ label: "K", value: 2.3, unit: "mEq/L" }],
        },
      },
      "3H025": {
        // マグネシウム（Mg）
        kind: "values",
        patterns: {
          mild: [{ label: "Mg", value: 1.6, unit: "mg/dL" }],
          moderate: [{ label: "Mg", value: 1.3, unit: "mg/dL" }],
          severe: [{ label: "Mg", value: 1.0, unit: "mg/dL" }],
        },
      },
    },
    crisis: {
      name: "致死性不整脈・心停止",
      triggers: [
        { type: "lab", code: "3H015", op: "<=", value: 2.3 },
        { type: "lab", code: "3H025", op: "<=", value: 1.0 },
      ],
      windowMinutes: CRISIS_WINDOW_MINUTES,
      rescueActions: [
        { label: "除細動", procedureKeywords: ["除細動"] },
        { label: "抗不整脈薬投与", drugCategories: ["抗不整脈薬"] },
        { label: "電解質補正", drugCategories: ["輸液"] },
      ],
      crisisVitals: { temperature: 36.4, systolicBp: 0, diastolicBp: 0, pulse: 0, spo2: 80, respRate: 4 },
      postRescueSeverity: 50,
    },
  },
  // 薬物治療では改善しない（虫垂切除術のみが治療開始とみなされる）外科的治療モデル
  appendicitis: {
    treatment: { procedureKeywords: ["虫垂切除"] },
    vitals: {
      base: { temperature: 37.0, systolicBp: 120, diastolicBp: 76, pulse: 84, spo2: 98, respRate: 16 },
      perSeverity: { temperature: 2.0, systolicBp: -24, diastolicBp: -14, pulse: 40, spo2: -6, respRate: 10 },
    },
    labPatterns: {
      "2A010": {
        // 白血球数（WBC）
        kind: "values",
        patterns: {
          mild: [{ label: "WBC", value: 11200, unit: "/μL" }],
          moderate: [{ label: "WBC", value: 15600, unit: "/μL", note: "好中球優位" }],
          severe: [{ label: "WBC", value: 21000, unit: "/μL", note: "好中球優位・核左方移動" }],
        },
      },
      "5C070": {
        // C反応性蛋白（CRP）
        kind: "values",
        patterns: {
          mild: [{ label: "CRP", value: 2.5, unit: "mg/dL" }],
          moderate: [{ label: "CRP", value: 9.8, unit: "mg/dL" }],
          severe: [{ label: "CRP", value: 18.5, unit: "mg/dL" }],
        },
      },
      "IMG-002": {
        // 腹部エコー
        kind: "text",
        patterns: {
          mild: "右下腹部に軽度腫大した虫垂様構造（外径7mm前後）を認める。周囲への炎症波及は明らかでない。",
          moderate: "右下腹部に腫大した虫垂様構造（外径9〜10mm）を認め、周囲脂肪織の輝度上昇を伴う。",
          severe: "右下腹部に著明に腫大した虫垂様構造を認め、周囲に液体貯留（膿瘍形成の可能性）を伴う。虫垂の輪郭は不明瞭。",
        },
      },
      "IMG-003": {
        // 腹部CT
        kind: "text",
        patterns: {
          mild: "虫垂は軽度腫大（径7mm前後）し、虫垂周囲の脂肪織濃度上昇を軽度に認める。明らかな膿瘍形成はない。",
          moderate: "虫垂は腫大（径10mm前後）し、虫垂周囲に脂肪織濃度上昇と少量の遊離液体を認める。",
          severe: "虫垂の腫大・壁不整を認め、周囲に膿瘍形成および遊離ガス像を疑う所見があり、穿孔が疑われる。汎発性の腹水貯留を伴う。",
        },
      },
    },
    crisis: {
      name: "穿孔性虫垂炎・汎発性腹膜炎・敗血症性ショック",
      triggers: [
        { type: "lab", code: "2A010", op: ">=", value: 21000 },
        { type: "lab", code: "5C070", op: ">=", value: 18.5 },
      ],
      windowMinutes: CRISIS_WINDOW_MINUTES,
      rescueActions: [
        { label: "緊急手術（虫垂切除）", procedureKeywords: ["虫垂切除"] },
        { label: "広域抗菌薬・急速輸液", drugCategories: ["輸液"] },
      ],
      crisisVitals: { temperature: 39.5, systolicBp: 70, diastolicBp: 42, pulse: 140, spo2: 88, respRate: 30 },
      postRescueSeverity: 50,
    },
  },
};

const FLOOR_SEVERITY = 5;
const UNTREATED_DRIFT_PER_HOUR = 2; // 未治療時の悪化速度（重症度ポイント/時間）

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getTemplateConfig(templateKey: string | null | undefined): TemplateConfig | null {
  if (!templateKey) return null;
  return TEMPLATE_CONFIG[templateKey] ?? null;
}

// この検査項目コードが、いずれかの病態テンプレートの動的所見パターンで使われているか
export function isEngineLinkedLabCode(labItemCode: string): boolean {
  return Object.values(TEMPLATE_CONFIG).some((config) => labItemCode in config.labPatterns);
}

export function parsePhysiologyParams(raw: string | null | undefined): PhysiologyParams {
  if (!raw) return DEFAULT_PHYSIOLOGY_PARAMS;
  try {
    return { ...DEFAULT_PHYSIOLOGY_PARAMS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PHYSIOLOGY_PARAMS;
  }
}

// MANUAL症例は学習者が手動で進める仮想時計、REALTIME症例は実時計を「現在時刻」として使う
export function getCaseClockNow(caseRecord: Pick<Case, "timeProgressMode" | "simNowAt" | "createdAt">): Date {
  if (caseRecord.timeProgressMode === "MANUAL") {
    return caseRecord.simNowAt ?? caseRecord.createdAt;
  }
  return new Date();
}

function improvementRatePerHour(improvementSpeedSlider: number): number {
  const halfLifeHours = 24 - (improvementSpeedSlider / 100) * 20; // 4〜24時間
  return Math.log(2) / halfLifeHours;
}

type TreatmentOrder = Pick<Order, "orderedAt" | "orderType" | "label" | "detail"> & {
  drug: { categoryLinks: { category: { majorCategory: string } }[] } | null;
};

// 治療開始時刻。薬剤カテゴリ一致（処方・注射、1薬剤が複数カテゴリを持ちうるためいずれか1つでも
// drugCategoriesに含まれれば治療とみなす。判定は大分類(majorCategory)単位のみ）、または処置ラベルの
// キーワード一致（処置・手術）のうち、最も早く条件を満たしたオーダーの時刻を返す。未治療ならnull。
export function findTreatmentStartAt(orders: TreatmentOrder[], trigger: TreatmentTrigger): Date | null {
  let earliest: Date | null = null;
  for (const order of orders) {
    let matched = false;
    if (order.orderType === "MEDICATION" || order.orderType === "INJECTION") {
      const majors = order.drug?.categoryLinks.map((l) => l.category.majorCategory) ?? [];
      matched = !!trigger.drugCategories?.length && majors.some((m) => trigger.drugCategories!.includes(m));
    } else if (order.orderType === "PROCEDURE") {
      matched = !!trigger.procedureKeywords?.length && trigger.procedureKeywords.some((kw) => order.label.includes(kw));
    }
    if (matched && (!earliest || order.orderedAt < earliest)) earliest = order.orderedAt;
  }
  return earliest;
}

// 一般指示カテゴリ「酸素投与」のデバイス・流量ごとのSpO2上乗せ幅（%pt）。基礎疾患の重症度自体は
// 改善しない対症療法的な効果として扱う。選択肢の文言はGeneralOrderDialog.tsxのプリセットと対応させる。
const OXYGEN_SPO2_BOOST: Record<string, number> = {
  "鼻カニューレ 1L/分": 2,
  "鼻カニューレ 2L/分": 3,
  "鼻カニューレ 3L/分": 4,
  "鼻カニューレ 4L/分": 5,
  "鼻カニューレ 5L/分": 6,
  "簡易酸素マスク 5L/分": 6,
  "簡易酸素マスク 6L/分": 7,
  "簡易酸素マスク 7L/分": 8,
  "リザーバーマスク 8L/分": 10,
  "リザーバーマスク 10L/分": 12,
  "リザーバーマスク 15L/分": 14,
  "中止（room air）": 0,
};

// 指定時刻の時点で有効な酸素投与指示（時刻以前の最新の一般指示「酸素投与」オーダー）による
// SpO2上乗せ幅を返す。一般指示オーダーのdetailにはカテゴリ・選択値をJSON文字列で保存している。
export function findActiveOxygenBoost(orders: TreatmentOrder[], atTime: Date): number {
  let latest: { orderedAt: Date; selection: string } | null = null;
  for (const order of orders) {
    if (order.orderType !== "GENERAL" || order.orderedAt > atTime) continue;
    let detail: { category?: string; selection?: string } = {};
    if (order.detail) {
      try {
        detail = JSON.parse(order.detail);
      } catch {
        continue;
      }
    }
    if (detail.category !== "酸素投与") continue;
    if (!latest || order.orderedAt > latest.orderedAt) latest = { orderedAt: order.orderedAt, selection: detail.selection ?? "" };
  }
  return latest ? (OXYGEN_SPO2_BOOST[latest.selection] ?? 0) : 0;
}

export function computeSeverityAt(params: {
  baseSeverity: number;
  improvementSpeedSlider: number;
  caseStartAt: Date;
  treatmentStartAt: Date | null;
  atTime: Date;
}): number {
  const { baseSeverity, improvementSpeedSlider, caseStartAt, treatmentStartAt, atTime } = params;

  if (!treatmentStartAt || atTime <= treatmentStartAt) {
    const hoursSinceStart = Math.max(0, (atTime.getTime() - caseStartAt.getTime()) / 3_600_000);
    return clamp(baseSeverity + UNTREATED_DRIFT_PER_HOUR * hoursSinceStart, 0, 100);
  }

  // 治療開始時点の重症度を起点に、そこから治療効果で減衰させる
  const severityAtTreatmentStart = clamp(
    baseSeverity + UNTREATED_DRIFT_PER_HOUR * Math.max(0, (treatmentStartAt.getTime() - caseStartAt.getTime()) / 3_600_000),
    0,
    100
  );
  const hoursSinceTreatment = Math.max(0, (atTime.getTime() - treatmentStartAt.getTime()) / 3_600_000);
  const k = improvementRatePerHour(improvementSpeedSlider);
  const severity = FLOOR_SEVERITY + (severityAtTreatmentStart - FLOOR_SEVERITY) * Math.exp(-k * hoursSinceTreatment);
  return clamp(severity, 0, 100);
}

export function getSeverityTier(severity: number): SeverityTier {
  if (severity < 34) return "mild";
  if (severity < 67) return "moderate";
  return "severe";
}

// oxygenBoostは酸素投与によるSpO2上乗せ幅（findActiveOxygenBoostの戻り値）。省略時は0（酸素投与なし）。
export function computeVitalsForSeverity(templateKey: string, severity: number, oxygenBoost = 0): VitalPoint | null {
  const config = TEMPLATE_CONFIG[templateKey];
  if (!config) return null;
  const ratio = clamp(severity, 0, 100) / 100;
  const { base, perSeverity } = config.vitals;
  const round1 = (v: number) => Math.round(v * 10) / 10;
  const round0 = (v: number) => Math.round(v);
  const spo2WithoutO2 = clamp(round0(base.spo2 + perSeverity.spo2 * ratio), 70, 100);
  return {
    temperature: round1(base.temperature + perSeverity.temperature * ratio),
    systolicBp: round0(base.systolicBp + perSeverity.systolicBp * ratio),
    diastolicBp: round0(base.diastolicBp + perSeverity.diastolicBp * ratio),
    pulse: round0(base.pulse + perSeverity.pulse * ratio),
    spo2: clamp(spo2WithoutO2 + oxygenBoost, 70, 100),
    respRate: round0(base.respRate + perSeverity.respRate * ratio),
  };
}

export type DynamicLabResult = { text: string; values: LabValue[] | null };

// テンプレートに紐づく検査項目であれば重症度に応じた所見を返す。対象外ならnull（呼び出し側は静的サンプルにフォールバック）
export function resolveDynamicLab(
  templateKey: string | null | undefined,
  labItemCode: string,
  severity: number
): DynamicLabResult | null {
  const config = getTemplateConfig(templateKey);
  if (!config) return null;
  const patternSet = config.labPatterns[labItemCode];
  if (!patternSet) return null;
  const tier = getSeverityTier(severity);
  if (patternSet.kind === "text") return { text: patternSet.patterns[tier], values: null };
  const values = patternSet.patterns[tier];
  return { text: formatLabValues(values), values };
}

// severityBaselineAtは重症度カーブの起点。通常は症例作成時刻（createdAt相当）だが、
// 危機シナリオからの救命成功時にその時刻へ更新され、以降はそこを新たな起点として
// 重症度が再計算される（救命前の治療オーダーはこの新しい起点以降のものだけを見る）。
export function computeCaseSeverityAtTime(
  caseRecord: Pick<Case, "physiologyParams" | "severityBaselineAt">,
  orders: TreatmentOrder[],
  templateKey: string | null | undefined,
  atTime: Date
): number | null {
  const config = getTemplateConfig(templateKey);
  if (!config) return null;
  const params = parsePhysiologyParams(caseRecord.physiologyParams);
  const baselineAt = caseRecord.severityBaselineAt;
  const relevantOrders = orders.filter((o) => o.orderedAt >= baselineAt);
  const treatmentStartAt = findTreatmentStartAt(relevantOrders, config.treatment);
  return computeSeverityAt({
    baseSeverity: params.severitySlider,
    improvementSpeedSlider: params.improvementSpeedSlider,
    caseStartAt: baselineAt,
    treatmentStartAt,
    atTime,
  });
}

function compareOp(value: number, op: ">=" | "<=", threshold: number): boolean {
  return op === ">=" ? value >= threshold : value <= threshold;
}

// 危機シナリオの発動条件を判定する。lab/vitalは実際にオーダーされた結果ではなく、
// その時点の重症度から導かれる「真の」値を参照する（未オーダーでも急変しうる）。
export function evaluateCrisisTriggers(templateKey: string, scenario: CrisisScenario, severity: number, oxygenBoost: number): boolean {
  return scenario.triggers.some((trigger) => {
    if (trigger.type === "severity") return compareOp(severity, trigger.op, trigger.value);
    if (trigger.type === "vital") {
      const vitals = computeVitalsForSeverity(templateKey, severity, oxygenBoost);
      return vitals ? compareOp(vitals[trigger.field], trigger.op, trigger.value) : false;
    }
    const dynamic = resolveDynamicLab(templateKey, trigger.code, severity);
    const entry = trigger.label ? dynamic?.values?.find((v) => v.label === trigger.label) : dynamic?.values?.[0];
    return typeof entry?.value === "number" && compareOp(entry.value, trigger.op, trigger.value);
  });
}

// crisisStartedAt以降のオーダーに、いずれかのrescueActionsに該当するものがあるか（＝救命に成功したか）
export function findCrisisRescueAt(orders: TreatmentOrder[], scenario: CrisisScenario, crisisStartedAt: Date): Date | null {
  const eligibleOrders = orders.filter((o) => o.orderedAt >= crisisStartedAt);
  const combinedTrigger: TreatmentTrigger = {
    drugCategories: scenario.rescueActions.flatMap((a) => a.drugCategories ?? []),
    procedureKeywords: scenario.rescueActions.flatMap((a) => a.procedureKeywords ?? []),
  };
  return findTreatmentStartAt(eligibleOrders, combinedTrigger);
}

