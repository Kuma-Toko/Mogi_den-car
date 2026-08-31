import { db } from "@/lib/db";
import { formatJaDateTimeShort } from "@/lib/format";
import { addSoapNote } from "./actions";

export async function SoapTab({ caseId }: { caseId: string }) {
  const notes = await db.soapNote.findMany({
    where: { caseId },
    orderBy: { createdAt: "desc" },
    include: { author: true },
  });

  const saveNote = addSoapNote.bind(null, caseId);

  return (
    <div className="split">
      <div className="card">
        <div className="card-h">診療記録を記入</div>
        <div className="card-b">
          <form action={saveNote}>
            <div className="soap-row">
              <div className="tag">S</div>
              <textarea name="subjective" placeholder="患者の訴え・自覚症状を記載" />
            </div>
            <div className="soap-row">
              <div className="tag">O</div>
              <textarea name="objective" placeholder="診察所見・検査結果を記載" />
            </div>
            <div className="soap-row">
              <div className="tag">A</div>
              <textarea name="assessment" placeholder="評価・アセスメントを記載" />
            </div>
            <div className="soap-row">
              <div className="tag">P</div>
              <textarea name="plan" placeholder="計画・プランを記載" />
            </div>
            <div style={{ textAlign: "right" }}>
              <button type="submit" className="btn primary">
                記録を保存
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="card-h">記載履歴</div>
        <div className="card-b">
          {notes.length === 0 ? (
            <div className="empty-note">記載履歴はまだありません。</div>
          ) : (
            notes.map((n) => (
              <div key={n.id} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: "1px solid var(--line-soft)", fontSize: 12.5 }}>
                <div style={{ color: "var(--ink-soft)", fontSize: 11, marginBottom: 6 }}>
                  {formatJaDateTimeShort(n.createdAt)}　{n.author.name}
                </div>
                {n.subjective && <p style={{ marginBottom: 4 }}>S: {n.subjective}</p>}
                {n.objective && <p style={{ marginBottom: 4 }}>O: {n.objective}</p>}
                {n.assessment && <p style={{ marginBottom: 4 }}>A: {n.assessment}</p>}
                {n.plan && <p>P: {n.plan}</p>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
