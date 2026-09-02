"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatJaDateTimeShort } from "@/lib/format";
import { sendEncounterMessage, type EncounterMessageView } from "./encounter-actions";

export function EncounterChat({ caseId, initialMessages }: { caseId: string; initialMessages: EncounterMessageView[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isPending]);

  function submit() {
    const text = input.trim();
    if (!text || isPending) return;
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: `pending-${Date.now()}`, role: "STUDENT", content: text, createdAt: new Date().toISOString() },
    ]);
    startTransition(async () => {
      const updated = await sendEncounterMessage(caseId, text);
      setMessages(updated);
    });
  }

  return (
    <>
      <div className="chat-log" ref={logRef}>
        {messages.length === 0 ? (
          <div className="empty-note">患者への質問（例:「いつから咳が出ていますか？」）や、診察の内容（例:「腹部を触診します」）を入力してください。</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`chat-msg ${m.role === "STUDENT" ? "student" : "patient"}`}>
              <div className="chat-bubble">
                <div className="chat-meta">
                  {m.role === "STUDENT" ? "学生" : "患者"}　{formatJaDateTimeShort(new Date(m.createdAt))}
                </div>
                {m.content}
              </div>
            </div>
          ))
        )}
        {isPending && (
          <div className="chat-msg patient">
            <div className="chat-bubble chat-bubble-loading">……</div>
          </div>
        )}
      </div>
      <div className="chat-input-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="質問または診察内容を入力（Enterで送信 / Shift+Enterで改行）"
          disabled={isPending}
        />
        <button type="button" className="btn primary" onClick={submit} disabled={isPending || !input.trim()}>
          送信
        </button>
      </div>
    </>
  );
}
