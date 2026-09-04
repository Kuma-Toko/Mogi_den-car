import { loadEncounterLog } from "@/lib/encounter-log";
import { EncounterChat } from "./EncounterChat";

export async function EncounterTab({ caseId }: { caseId: string }) {
  const messages = await loadEncounterLog(caseId);

  return (
    <div className="card">
      <div className="card-h">問診・身体診察</div>
      <div className="card-b">
        <EncounterChat caseId={caseId} initialMessages={messages} />
      </div>
    </div>
  );
}
