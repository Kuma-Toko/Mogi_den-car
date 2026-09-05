"use client";

import Link from "next/link";
import { useNavigationBlocker } from "./NavigationBlockerContext";

export function TabLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { isBlocked } = useNavigationBlocker();

  return (
    <Link
      href={href}
      className={className}
      onNavigate={(e) => {
        if (
          isBlocked &&
          !window.confirm(
            "カルテ記載に未保存の入力内容があります。このまま他のタブへ移動しますか？（入力内容は下書きとして保持されます）",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      {children}
    </Link>
  );
}
