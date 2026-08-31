import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Sidebar } from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const unreadNotifications = await db.notification.count({ where: { userId: user.id, isRead: false } });

  return (
    <div className="app-shell">
      <Sidebar
        name={user.name}
        role={user.role}
        affiliation={user.affiliation}
        grade={user.grade}
        unreadNotifications={unreadNotifications}
      />
      <div className="main">{children}</div>
    </div>
  );
}
