import type { CrisisMode, CrisisState } from "@prisma/client";

export function CrisisBanner({
  crisisState,
  crisisMode,
  scenarioName,
  severity,
}: {
  crisisState: CrisisState;
  crisisMode: CrisisMode;
  scenarioName: string;
  // 危機病態(=発火後の主病態)自身の現在の重症度。死亡は重症度が100に達したときに発生するため、
  // 猶予時間の代わりにこの数値を切迫度の目安として表示する。
  severity: number | null;
}) {
  if (crisisState === "STABLE") return null;

  if (crisisState === "DECEASED") {
    return (
      <div className="crisis-banner deceased">
        <div className="crisis-banner-title">死亡確認</div>
        <div className="crisis-banner-body">
          {scenarioName}への対応が間に合わず、患者は死亡が確認されました。以降このカルテへの新規オーダーはできません。
        </div>
      </div>
    );
  }

  return (
    <div className="crisis-banner critical">
      <div className="crisis-banner-title">🚨 急変：{scenarioName}を疑う状態です</div>
      <div className="crisis-banner-body">
        直ちに救命処置を行ってください。
        {crisisMode === "LETHAL" && severity !== null && `現在の重症度：${Math.round(severity)}/100（100到達で死亡）`}
      </div>
    </div>
  );
}
