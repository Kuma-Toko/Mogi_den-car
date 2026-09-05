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
// LabItemMaster.microbiologyKind===null/"GENERAL"（既定）の既定遅延。他の検査方式はgetCultureDelayHours参照。
export const CULTURE_PRELIMINARY_DELAY_HOURS = 12;
export const CULTURE_FINAL_DELAY_HOURS = 48;

export const SUSCEPTIBILITY_LABEL: Record<"S" | "I" | "R", string> = {
  S: "感受性あり",
  I: "中間",
  R: "耐性",
};

// 検体採取部位（LabItemMaster.specimenSite）の語彙とラベル。CaseFormの検体部位制限UI・admin/lab-itemsで共用する。
export const SPECIMEN_SITE_LABELS: Record<string, string> = {
  blood: "血液",
  sputum: "喀痰",
  throat: "咽頭ぬぐい液",
  urine: "尿",
  stool: "便",
  pus: "膿（穿刺・排膿）",
  vaginal: "腟分泌物",
};

// 検査方式（LabItemMaster.microbiologyKind）の語彙とラベル。admin/lab-itemsのセレクトで使う。
export const MICROBIOLOGY_KIND_LABELS: Record<string, string> = {
  GENERAL: "一般細菌（塗抹→培養、既定）",
  AFB: "抗酸菌（塗抹→培養、長期）",
  STOOL: "便培養（塗抹段階なし）",
  TOXIN: "毒素検出（迅速・感受性パネルなし）",
  SUSCEPTIBILITY: "薬剤感受性検査単体",
};

// 症例の検体部位制限(CaseDiseaseLink.relevantSpecimenSites)に対して、この検査項目の検体部位が妥当かを判定する。
// relevantSitesがnull（教員が制限を設定していない）、またはspecimenSiteがnull（部位を問わない項目。薬剤感受性検査等）
// なら常にtrue＝妥当とみなす。既存挙動を変えないためのデフォルトは「制限なし」。
export function isSpecimenSiteRelevant(relevantSites: string[] | null, specimenSite: string | null): boolean {
  if (!relevantSites) return true;
  if (!specimenSite) return true;
  return relevantSites.includes(specimenSite);
}

// 検査方式ごとの速報/確定の遅延時間。GENERAL(既定)は既存の2定数のまま。STOOL/TOXIN/SUSCEPTIBILITYは
// preliminaryとfinalを同値にすることで、reconcileCaseResults側の「両閾値に同時到達したら速報を飛ばす」
// 既存分岐をそのまま利用し、塗抹段階を持たない検査を1段階の結果開示として扱う。
export function getCultureDelayHours(microbiologyKind: string | null): { preliminary: number; final: number } {
  switch (microbiologyKind) {
    case "AFB":
      return { preliminary: 24, final: 240 }; // 抗酸菌塗抹は翌日程度、培養確定は数週間を圧縮して10日相当
    case "STOOL":
      return { preliminary: 48, final: 48 };
    case "TOXIN":
      return { preliminary: 6, final: 6 };
    case "SUSCEPTIBILITY":
      return { preliminary: 24, final: 24 };
    default:
      return { preliminary: CULTURE_PRELIMINARY_DELAY_HOURS, final: CULTURE_FINAL_DELAY_HOURS };
  }
}

// 培養オーダーの速報結果（グラム染色相当）。原因菌が割り当てられていない症例、または検体部位が
// 症例にとって妥当でない場合（呼び出し側がpathogenにnullを渡す）は、フォールバック文
// （LabItemMaster.sampleResult等、呼び出し側が渡す既存の静的結果）をそのまま使う。
export function resolveCulturePreliminaryResult(
  pathogen: PathogenProfile | null,
  fallbackText: string | null,
  microbiologyKind: string | null = null
): string {
  if (!pathogen) return fallbackText ?? "検体を提出しました。結果を待っています。";
  if (microbiologyKind === "AFB") {
    return "抗酸菌染色で抗酸菌を検出（同定検査中）。";
  }
  if (!pathogen.gramStain) {
    return "グラム染色では明らかな菌体を確認できません。非定型病原体の関与を考慮し、同定検査を継続しています。";
  }
  return `${pathogen.gramStain}を検出（同定検査中）。`;
}

// 培養オーダーの確定結果（原因菌の同定＋感受性検査）。原因菌未割り当て・検体部位不一致の場合は
// 速報時と同じフォールバック文のまま（＝多段階になっていることを学生に意識させない）。
export function resolveCultureFinalResult(
  pathogen: PathogenProfile | null,
  fallbackText: string | null,
  microbiologyKind: string | null = null
): string {
  if (!pathogen) return fallbackText ?? "検体を提出しました。結果を待っています。";
  if (microbiologyKind === "TOXIN") {
    return `${pathogen.name} 毒素を検出しました。\n抗菌薬感受性検査の対象外（トキシン検出による診断のため）。`;
  }
  if (microbiologyKind === "SUSCEPTIBILITY") {
    const susceptibleCategories = pathogen.susceptibilities.filter((s) => s.susceptibility === "S").map((s) => s.subCategory);
    if (susceptibleCategories.length === 0) return "感受性が確認された薬剤分類はありません。";
    return `感受性が期待される薬剤分類: ${susceptibleCategories.join("、")}`;
  }
  if (pathogen.susceptibilities.length === 0) {
    return `${pathogen.name} を検出しました。\n[感受性検査] 登録されているデータがありません。`;
  }
  const lines = pathogen.susceptibilities
    .map((s) => `・${s.subCategory}: ${SUSCEPTIBILITY_LABEL[s.susceptibility]}${s.note ? `（${s.note}）` : ""}`)
    .join("\n");
  return `${pathogen.name} を検出しました。\n[感受性検査]\n${lines}`;
}

// ── 抗菌薬カバレッジ判定 ──────────────────────────────────────────────
// 症例に原因菌が割り当てられていれば、学生への培養結果開示状況とは無関係に、現在の抗菌薬オーダーが
// その原因菌をカバーしているかをAI治療評価向けに判定する（「効いていない」ことも治療効果の重要な
// 判断材料であるため、培養未確定の経験的治療フェーズでも常に評価する）。原因菌未割当の症例
// （＝感染症エンジン未使用）ではこの一式は呼ばれず、既存の大分類ベースの二値判定のみで評価される
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
