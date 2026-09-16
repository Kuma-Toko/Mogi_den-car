import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import type { PathologyTemplateCatalog } from "./pathology-catalog/types";

// prisma/data/pathology-catalog/*.jsonの静的検証（DB接続はマスターデータの参照確認にのみ使う。
// DBの書き換えは一切行わない）。apply-engine-config.tsを実行する前に必ずこれを通す。
// 検出する問題:
//   [ERROR]（1件でもあればexit 1）: key重複 / labItemCodeがLabItemMasterに存在しない /
//     数値パターンのlabelがそのlabItemCodeのsampleValuesに存在しない(合成不能) /
//     drugCategories(系統指定含む)がDrugCategoryMasterに存在しない / targetKeyが
//     どのカタログにも存在しない、またはisCrisisPathology=trueでない / isCrisisPathology=trueなのに
//     crisisRescueが未設定 / crisisRescueのactionsが空
//   [WARN]（exit 0のまま表示のみ）: aiEvaluationGuideline未設定 / tierが単調でない(mild<moderate<severeの
//     昇順を期待する数値項目で逆転) / procedureKeywordsが既知のプリセット文言に含まれない

const rawUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
const catalogDir = join(__dirname, "data", "pathology-catalog");

// ProcedureOrderDialog.tsxのSELECT_OPTIONS.処置と同期させておく既知の処置プリセット文言。
// ここに無いキーワードでも「エラー」にはしない(自由記述の手術ラベルもあるため)が、WARNで気づけるようにする。
const KNOWN_PROCEDURE_KEYWORDS = [
  "創傷処置（洗浄・消毒）", "縫合", "抜糸", "ギプス固定", "導尿", "浣腸", "腰椎穿刺", "胸腔穿刺", "腹腔穿刺",
  "気管挿管", "中心静脈カテーテル挿入", "胃洗浄", "除細動", "心肺蘇生（胸骨圧迫）",
  "胸腔ドレナージ", "心嚢穿刺", "血液透析", "内視鏡的止血術", "内視鏡的胆道ドレナージ（ERCP）",
  "経皮的冠動脈インターベンション（PCI）", "血栓溶解療法（tPA静注）", "血栓回収療法（機械的血栓除去）",
  "血漿交換療法", "開頭術（血腫除去・減圧）", "高張食塩水投与", "体表冷却", "積極的復温", "高気圧酸素療法",
  "試験開腹止血術", "緊急帝王切開術", "経皮的ペーシング・ペースメーカー植込み", "壊死組織デブリードマン",
];

function loadCatalog(): { templates: PathologyTemplateCatalog[]; file: string }[] {
  const files = readdirSync(catalogDir).filter((f) => f.endsWith(".json"));
  return files.map((file) => ({
    file,
    templates: JSON.parse(readFileSync(join(catalogDir, file), "utf-8")) as PathologyTemplateCatalog[],
  }));
}

function splitCategorySpec(spec: string): { major: string; sub: string | null } {
  const idx = spec.indexOf("/");
  return idx === -1 ? { major: spec, sub: null } : { major: spec.slice(0, idx), sub: spec.slice(idx + 1) };
}

async function main() {
  const errors: string[] = [];
  const warnings: string[] = [];

  const groups = loadCatalog();
  const allTemplates = groups.flatMap((g) => g.templates.map((t) => ({ ...t, __file: g.file })));

  // ── key重複 ──
  const seenKeys = new Map<string, string>();
  for (const t of allTemplates) {
    if (seenKeys.has(t.key)) errors.push(`[key重複] ${t.key} (${seenKeys.get(t.key)} と ${t.__file})`);
    seenKeys.set(t.key, t.__file);
  }

  const db = createClient({ url: rawUrl });

  const baseRow = await db.execute(`SELECT temperature, systolicBp, diastolicBp, pulse, spo2, respRate FROM BasePhysiologyModel WHERE id = 'default'`);
  const base = (baseRow.rows[0] ?? { temperature: 36.5, systolicBp: 120, diastolicBp: 70, pulse: 75, spo2: 98, respRate: 16 }) as unknown as Record<
    "temperature" | "systolicBp" | "diastolicBp" | "pulse" | "spo2" | "respRate",
    number
  >;

  const labRows = await db.execute(`SELECT code, sampleValues FROM LabItemMaster`);
  const labCodeSet = new Set(labRows.rows.map((r) => r.code as string));
  const labValueLabels = new Map<string, Set<string>>();
  for (const r of labRows.rows) {
    const raw = r.sampleValues as string | null;
    if (!raw) continue;
    try {
      const values = JSON.parse(raw) as { label: string }[];
      labValueLabels.set(r.code as string, new Set(values.map((v) => v.label)));
    } catch {
      // 無視（既存データの破損はここでは扱わない）
    }
  }

  const categoryRows = await db.execute(`SELECT majorCategory, subCategory FROM DrugCategoryMaster`);
  const validCategorySpecs = new Set<string>();
  const validMajors = new Set<string>();
  for (const r of categoryRows.rows) {
    const major = r.majorCategory as string;
    const sub = r.subCategory as string | null;
    validMajors.add(major);
    if (sub) validCategorySpecs.add(`${major}/${sub}`);
  }

  function checkCategorySpec(spec: string, context: string) {
    const { major, sub } = splitCategorySpec(spec);
    if (sub === null) {
      if (!validMajors.has(major)) errors.push(`[薬効カテゴリ不明] ${context}: "${spec}" はDrugCategoryMasterに存在しません`);
    } else {
      if (!validCategorySpecs.has(spec)) errors.push(`[薬効カテゴリ不明] ${context}: "${spec}" (系統指定)はDrugCategoryMasterに存在しません`);
    }
  }

  const crisisPathologyKeys = new Set(allTemplates.filter((t) => t.isCrisisPathology).map((t) => t.key));
  const allKeys = new Set(allTemplates.map((t) => t.key));

  for (const t of allTemplates) {
    const ctx = `${t.key}(${t.__file})`;

    // ── labPatterns ──
    for (const p of t.labPatterns) {
      if (!labCodeSet.has(p.labItemCode)) {
        errors.push(`[検査コード不明] ${ctx}: labItemCode="${p.labItemCode}" はLabItemMasterに存在しません`);
        continue;
      }
      if (p.kind === "values") {
        const knownLabels = labValueLabels.get(p.labItemCode);
        if (!knownLabels) {
          errors.push(`[検査基礎値なし] ${ctx}: labItemCode="${p.labItemCode}" はsampleValuesが未設定のため数値合成できません`);
        } else {
          for (const tier of ["mild", "moderate", "severe"] as const) {
            for (const v of p.tiers[tier]) {
              if (!knownLabels.has(v.label)) {
                errors.push(`[ラベル不一致] ${ctx}: ${p.labItemCode}の label="${v.label}" (${tier}) がsampleValuesのラベルと一致しません`);
              }
            }
          }
          // 単調性チェック（多くの検査は重症度とともに単調増加/減少するはずだが例外もあるためWARN）
          for (const value0 of p.tiers.mild) {
            const m = p.tiers.moderate.find((v) => v.label === value0.label)?.value;
            const s = p.tiers.severe.find((v) => v.label === value0.label)?.value;
            if (m !== undefined && s !== undefined) {
              const increasing = value0.value <= m && m <= s;
              const decreasing = value0.value >= m && m >= s;
              if (!increasing && !decreasing) {
                warnings.push(`[非単調] ${ctx}: ${p.labItemCode} label="${value0.label}" が mild→moderate→severe で単調でありません`);
              }
            }
          }
        }
      }
    }

    // ── treatment / crisisRescue の drugCategories ──
    for (const c of t.treatment.drugCategories ?? []) checkCategorySpec(c, `${ctx}.treatment`);
    for (const kw of t.treatment.procedureKeywords ?? []) {
      if (!KNOWN_PROCEDURE_KEYWORDS.some((k) => k.includes(kw) || kw.includes(k))) {
        warnings.push(`[処置プリセット未確認] ${ctx}.treatment: "${kw}" はProcedureOrderDialogの既知プリセットに一致しません`);
      }
    }

    // ── crisisTriggers ──
    for (const scenario of t.crisisTriggers ?? []) {
      if (!allKeys.has(scenario.targetKey)) {
        errors.push(`[targetKey不明] ${ctx}: crisisTriggers.targetKey="${scenario.targetKey}" はどのカタログにも存在しません`);
      } else if (!crisisPathologyKeys.has(scenario.targetKey)) {
        errors.push(`[targetKey不正] ${ctx}: crisisTriggers.targetKey="${scenario.targetKey}" はisCrisisPathology=trueではありません`);
      }
      for (const trig of scenario.triggers) {
        if (trig.type === "lab" && !labCodeSet.has(trig.code)) {
          errors.push(`[検査コード不明] ${ctx}: crisisTriggers内のlabコード="${trig.code}" はLabItemMasterに存在しません`);
        }
        // vitalトリガーは、このテンプレート自身のvitalsPerSeverityだけで重症度100まで悪化した場合に
        // 到達可能かを機械的にチェックする（他疾患との合算や薬剤影響は考慮しない下限チェック）。
        // 到達不能なら「永遠に発火しない」バグとして検出する。
        if (trig.type === "vital") {
          const achievable = base[trig.field] + t.vitalsPerSeverity[trig.field];
          const reachable = trig.op === ">=" ? achievable >= trig.value : achievable <= trig.value;
          if (!reachable) {
            errors.push(
              `[到達不能トリガー] ${ctx}: crisisTriggers vital.${trig.field} ${trig.op} ${trig.value} は自身のvitalsPerSeverity(重症度100時=${achievable})だけでは到達できません`
            );
          }
        }
      }
    }

    // ── isCrisisPathologyならcrisisRescue必須 ──
    if (t.isCrisisPathology) {
      if (!t.crisisRescue) {
        errors.push(`[救命設定なし] ${ctx}: isCrisisPathology=trueですがcrisisRescueが未設定です`);
      } else {
        if (t.crisisRescue.actions.length === 0) errors.push(`[救命アクションなし] ${ctx}: crisisRescue.actionsが空です`);
        for (const action of t.crisisRescue.actions) {
          for (const c of action.drugCategories ?? []) checkCategorySpec(c, `${ctx}.crisisRescue`);
        }
      }
    }

    // ── AI評価ルーブリック未設定はWARN ──
    if (!t.aiEvaluationGuideline || !t.aiEvaluationGuideline.trim()) {
      warnings.push(`[ルーブリック未設定] ${ctx}: aiEvaluationGuidelineが未設定です`);
    }

    // treatment/crisisTriggersが両方とも空の通常疾患はWARN（永久に未治療扱いになる）
    if (!t.isCrisisPathology) {
      const hasTreatment = (t.treatment.drugCategories?.length ?? 0) > 0 || (t.treatment.procedureKeywords?.length ?? 0) > 0;
      if (!hasTreatment) warnings.push(`[治療条件なし] ${ctx}: treatmentが空です（永久に未治療として悪化し続けます）`);
    }
  }

  db.close();

  console.log(`検証対象: ${allTemplates.length}テンプレート（${groups.length}ファイル）`);
  if (warnings.length > 0) {
    console.log(`\n--- 警告 ${warnings.length}件 ---`);
    for (const w of warnings) console.log(w);
  }
  if (errors.length > 0) {
    console.log(`\n--- エラー ${errors.length}件 ---`);
    for (const e of errors) console.log(e);
    console.log(`\n検証失敗。上記エラーを修正してください。`);
    process.exitCode = 1;
  } else {
    console.log(`\nエラーなし。${warnings.length > 0 ? "警告を確認のうえ" : ""}apply-engine-configを実行できます。`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
