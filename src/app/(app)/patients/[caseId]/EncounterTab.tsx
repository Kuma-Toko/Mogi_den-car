import { db } from "@/lib/db";
import { EncounterChat } from "./EncounterChat";

export async function EncounterTab({ caseId }: { caseId: string }) {
  const messages = await db.encounterMessage.findMany({
    where: { caseId },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="card">
      <div className="card-h">問診・身体診察</div>
      <div className="card-b">
        <EncounterChat
          caseId={caseId}
          initialMessages={messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt.toISOString(),
          }))}
        />
      </div>
    </div>
  );
}
