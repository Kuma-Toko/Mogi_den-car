"use client";

import { useEffect, useRef, useState } from "react";
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
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!confirming) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setConfirming(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setConfirming(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [confirming]);

  return (
    <span ref={wrapRef} className="confirm-btn-wrap">
      <button type="button" className={className} onClick={() => setConfirming(true)}>
        {children}
      </button>
      {confirming && (
        <span className="confirm-popover">
          <span className="confirm-popover-text">{confirmText}</span>
          <span className="confirm-popover-actions">
            <SubmitButton formAction={formAction} actionLabel={actionLabel} actionClassName={actionClassName} />
            <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>
              取消
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
