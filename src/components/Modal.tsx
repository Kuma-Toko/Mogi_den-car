"use client";

import { useRef, type ReactNode } from "react";

export function Modal({
  trigger,
  triggerClassName = "btn",
  title,
  children,
  size = "md",
}: {
  trigger: ReactNode;
  triggerClassName?: string;
  title: string;
  children: ReactNode;
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => ref.current?.showModal()}>
        {trigger}
      </button>
      <dialog
        ref={ref}
        className={`modal modal-${size}`}
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="modal-box" onClick={(e) => e.stopPropagation()}>
          <div className="modal-h">
            <span>{title}</span>
            <button type="button" className="btn ghost" onClick={() => ref.current?.close()}>
              閉じる
            </button>
          </div>
          <div className="modal-b">{children}</div>
        </div>
      </dialog>
    </>
  );
}
