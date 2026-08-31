import type { Case } from "@prisma/client";
import { formatJaDateTime } from "@/lib/format";
import { getCaseClockNow } from "@/lib/physiology-engine";
import { advanceSimTime } from "./actions";

const STEPS = [
  { hours: 2, label: "+2時間" },
  { hours: 6, label: "+6時間" },
  { hours: 24, label: "+1日" },
];

export function SimTimeControl({
  caseId,
  caseRecord,
}: {
  caseId: string;
  caseRecord: Pick<Case, "timeProgressMode" | "simNowAt" | "createdAt">;
}) {
  if (caseRecord.timeProgressMode !== "MANUAL") return null;

  const now = getCaseClockNow(caseRecord);

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-h">
        シミュレーション時刻：{formatJaDateTime(now)}
        <span style={{ display: "flex", gap: 6 }}>
          {STEPS.map((s) => (
            <form key={s.hours} action={advanceSimTime.bind(null, caseId, s.hours)}>
              <button type="submit" className="btn">
                {s.label}
              </button>
            </form>
          ))}
        </span>
      </div>
    </div>
  );
}
