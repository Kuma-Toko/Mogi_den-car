// 感染症エンジン: 原因菌×抗菌薬感受性(PathogenMaster/PathogenSusceptibility)を用いた、
// 培養系検査(LabItemMaster.isCulture)の多段階結果生成を担う純関数群。
// physiology-engine.tsと同様、DBアクセスは持たない（呼び出し側=engine.tsが解決済みのデータを渡す）。
//
// 症例に「真の原因菌」(CaseDiseaseLink.pathogenId)が割り当てられていない場合、この一式は一切
// 使われず、既存の重症度連動テキスト(TemplateLabPattern経由のaggregateLabResult)にフォールバックする
// ——既存症例（原因菌モデル未使用）の挙動は完全に変更しない。

export type PathogenSusceptibilityInfo = {
  subCategory: string; // 抗菌薬の系統名（DrugCategoryMaster.subCategory、nullの場合はmajorCategoryを渡す）
  susceptibility: "S" | "I" | "R";
  note: string | null;
};

export type PathogenProfile = {
  name: string;
  gramStain: string | null; // null=マイコプラズマ等、通常のグラム染色で明らかな菌体を確認できない病原体
  susceptibilities: PathogenSusceptibilityInfo[];
};

// 培養オーダーの多段階結果開示タイミング（症例の時計基準、resultTiming=IMMEDIATE/DELAYEDに関わらず適用）。
// 現実の血液培養の検体処理時間（グラム染色速報は半日程度、確定同定+感受性検査は数日）を、
// 既存の急変シナリオwindowMinutes等と同様にシミュレーションのペースに合わせて採用した固定値。
export const CULTURE_PRELIMINARY_DELAY_HOURS = 12;
export const CULTURE_FINAL_DELAY_HOURS = 48;

export const SUSCEPTIBILITY_LABEL: Record<"S" | "I" | "R", string> = {
  S: "感受性あり",
  I: "中間",
  R: "耐性",
};

// 培養オーダーの速報結果（グラム染色相当）。原因菌が割り当てられていない症例では
// フォールバック文（LabItemMaster.sampleResult等、呼び出し側が渡す既存の静的結果）をそのまま使う。
export function resolveCulturePreliminaryResult(pathogen: PathogenProfile | null, fallbackText: string | null): string {
  if (!pathogen) return fallbackText ?? "検体を提出しました。結果を待っています。";
  if (!pathogen.gramStain) {
    return "グラム染色では明らかな菌体を確認できません。非定型病原体の関与を考慮し、同定検査を継続しています。";
  }
  return `${pathogen.gramStain}を検出（同定検査中）。`;
}

// 培養オーダーの確定結果（原因菌の同定＋感受性検査）。原因菌が割り当てられていない症例では
// 速報時と同じフォールバック文のまま（＝多段階になっていることを学生に意識させない）。
export function resolveCultureFinalResult(pathogen: PathogenProfile | null, fallbackText: string | null): string {
  if (!pathogen) return fallbackText ?? "検体を提出しました。結果を待っています。";
  if (pathogen.susceptibilities.length === 0) {
    return `${pathogen.name} を検出しました。\n[感受性検査] 登録されているデータがありません。`;
  }
  const lines = pathogen.susceptibilities
    .map((s) => `・${s.subCategory}: ${SUSCEPTIBILITY_LABEL[s.susceptibility]}${s.note ? `（${s.note}）` : ""}`)
    .join("\n");
  return `${pathogen.name} を検出しました。\n[感受性検査]\n${lines}`;
}

// ── 標的治療フェーズ: 抗菌薬カバレッジ判定 ──────────────────────────────────
// 培養の確定結果（原因菌＋感受性）が開示された後、学生の現在の抗菌薬オーダーがその原因菌を
// カバーしているかをAI治療評価向けに判定する。培養未確定・原因菌未割当の症例（＝学生がまだ原因菌を
// 知り得ない経験的治療フェーズ）ではこの一式は呼ばれず、既存の大分類ベースの二値判定のみで評価される
// （呼び出し側=engine.tsのloadTargetedTherapyContextがガードする）。

export type ActiveAntibioticCategory = {
  subCategory: string; // 抗菌薬の系統名（DrugCategoryMaster.subCategory、nullの場合はmajorCategory）
  drugLabel: string; // オーダー表示名（採点根拠の可読性のため保持）
};

// 感受性データが無い(菌,系統)の組は、PathogenSusceptibilityモデルの設計方針どおり
// 「カバーしない(R相当)」として扱う（UNKNOWN）。
export type CoverageSusceptibility = "S" | "I" | "R" | "UNKNOWN";

export type AntibioticCoverageDetail = {
  subCategory: string;
  drugLabel: string;
  susceptibility: CoverageSusceptibility;
};

export type AntibioticCoverageLevel = "NONE" | "INADEQUATE" | "PARTIAL" | "ADEQUATE";

export type AntibioticCoverageResult = {
  level: AntibioticCoverageLevel;
  details: AntibioticCoverageDetail[];
};

export const COVERAGE_SUSCEPTIBILITY_LABEL: Record<CoverageSusceptibility, string> = {
  ...SUSCEPTIBILITY_LABEL,
  UNKNOWN: "データなし（耐性相当として扱う）",
};

export const ANTIBIOTIC_COVERAGE_LEVEL_LABEL: Record<AntibioticCoverageLevel, string> = {
  NONE: "抗菌薬オーダーなし",
  INADEQUATE: "不適切（原因菌をカバーする抗菌薬がない）",
  PARTIAL: "部分的（中間感受性の抗菌薬のみ）",
  ADEQUATE: "適切（感受性のある抗菌薬でカバーされている）",
};

// 複数の抗菌薬がオーダーされていれば、最も良い感受性（S>I>R/UNKNOWN）で全体判定する
// （併用療法で1剤でも効いていれば、その分の治療効果は見込めるという想定）。
export function evaluateAntibioticCoverage(
  pathogen: PathogenProfile,
  activeCategories: ActiveAntibioticCategory[]
): AntibioticCoverageResult {
  if (activeCategories.length === 0) return { level: "NONE", details: [] };

  const susceptibilityByCategory = new Map(pathogen.susceptibilities.map((s) => [s.subCategory, s.susceptibility]));
  const details: AntibioticCoverageDetail[] = activeCategories.map((c) => ({
    subCategory: c.subCategory,
    drugLabel: c.drugLabel,
    susceptibility: susceptibilityByCategory.get(c.subCategory) ?? "UNKNOWN",
  }));

  const level: AntibioticCoverageLevel = details.some((d) => d.susceptibility === "S")
    ? "ADEQUATE"
    : details.some((d) => d.susceptibility === "I")
      ? "PARTIAL"
      : "INADEQUATE";

  return { level, details };
}
