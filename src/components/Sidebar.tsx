"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { roleLabel } from "@/lib/labels";
import type { Role } from "@prisma/client";

type NavItem = { href: string; label: string; notifKey?: true };

const NAV_BY_ROLE: Record<Role, { sub: string; items: NavItem[] }> = {
  STUDENT: {
    sub: "実習常時利用ツール",
    items: [
      { href: "/patients", label: "患者リスト" },
      { href: "/notifications", label: "通知", notifKey: true },
    ],
  },
  TEACHER: {
    sub: "教員 症例管理",
    items: [{ href: "/teacher/cases", label: "症例一覧・作成" }],
  },
  ADMIN: {
    sub: "管理者",
    items: [
      { href: "/teacher/cases", label: "症例一覧・作成" },
      { href: "/admin/drugs", label: "薬剤マスター" },
      { href: "/admin/lab-items", label: "検査項目マスター" },
      { href: "/admin/templates", label: "病態テンプレート" },
      { href: "/admin/audit-logs", label: "監査ログ" },
    ],
  },
};

export function Sidebar({
  name,
  role,
  affiliation,
  grade,
  unreadNotifications,
}: {
  name: string;
  role: Role;
  affiliation: string | null;
  grade: string | null;
  unreadNotifications: number;
}) {
  const pathname = usePathname();
  const nav = NAV_BY_ROLE[role];
  const userLine = [grade, affiliation].filter(Boolean).join(" / ") || roleLabel[role];

  return (
    <div className="sidebar">
      <div className="brand">
        模擬臨床カルテ
        <span>{nav.sub}</span>
      </div>
      <nav>
        {nav.items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={pathname.startsWith(item.href) ? "on" : ""}
            style={{ justifyContent: "space-between" }}
          >
            <span>{item.label}</span>
            {item.notifKey && unreadNotifications > 0 && (
              <span className="badge red" style={{ background: "#fff", color: "var(--red)" }}>
                {unreadNotifications}
              </span>
            )}
          </Link>
        ))}
      </nav>
      <div className="userbox">
        <div>
          {name}（{roleLabel[role]}）
        </div>
        <div>{userLine}</div>
        <form action={logout}>
          <button type="submit">ログアウト</button>
        </form>
      </div>
    </div>
  );
}
