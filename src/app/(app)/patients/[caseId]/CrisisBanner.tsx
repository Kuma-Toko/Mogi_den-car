import type { CrisisMode, CrisisState } from "@prisma/client";

function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}時間${r}分` : `${r}分`;
}

export function CrisisBanner({
  crisisState,
  crisisMode,
  scenarioName,
  elapsedMinutes,
  windowMinutes,
}: {
  crisisState: CrisisState;
  crisisMode: CrisisMode;
  scenarioName: string;
  elapsedMinutes: number;
  windowMinutes: number;
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

  const remaining = windowMinutes - elapsedMinutes;
  return (
    <div className="crisis-banner critical">
      <div className="crisis-banner-title">🚨 急変：{scenarioName}を疑う状態です</div>
      <div className="crisis-banner-body">
        直ちに救命処置を行ってください。
        {crisisMode === "LETHAL" && `対応の目安時間：残り約${formatMinutes(remaining)}`}
      </div>
    </div>
  );
}
