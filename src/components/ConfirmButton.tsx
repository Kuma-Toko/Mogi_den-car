"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

function SubmitButton({
  formAction,
  actionLabel,
  actionClassName,
}: {
  formAction: (formData: FormData) => void;
  actionLabel: string;
  actionClassName: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" formAction={formAction} className={actionClassName} disabled={pending}>
      {pending ? "処理中…" : actionLabel}
    </button>
  );
}

export function ConfirmButton({
  formAction,
  confirmText,
  className,
  children,
  actionLabel = "削除する",
  actionClassName = "btn danger",
}: {
  formAction: (formData: FormData) => void;
  confirmText: string;
  className?: string;
  children: React.ReactNode;
  actionLabel?: string;
  actionClassName?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className={className} onClick={() => setConfirming(true)}>
        {children}
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      <span style={{ fontSize: 11, color: "var(--red)" }}>{confirmText}</span>
      <SubmitButton formAction={formAction} actionLabel={actionLabel} actionClassName={actionClassName} />
      <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>
        取消
      </button>
    </span>
  );
}
