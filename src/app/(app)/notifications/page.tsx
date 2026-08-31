import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatJaDateTime, formatJaDateTimeShort } from "@/lib/format";
import { markAllNotificationsRead, markNotificationRead } from "./actions";

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const notifications = await db.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { case: true },
    take: 200,
  });

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <>
      <div className="topbar">
        <h1>通知</h1>
        <div className="meta">{formatJaDateTime(new Date())}</div>
      </div>
      <div className="content">
        <div className="card">
          <div className="card-h">
            通知一覧（未読 {unreadCount}件 / 全{notifications.length}件）
            {unreadCount > 0 && (
              <form action={markAllNotificationsRead}>
                <button type="submit" className="btn ghost" style={{ fontSize: 11 }}>
                  すべて既読にする
                </button>
              </form>
            )}
          </div>
          <div className="card-b" style={{ padding: 0 }}>
            {notifications.length === 0 ? (
              <div className="empty-note">通知はまだありません。</div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className="order-item"
                  style={{ background: n.isRead ? "transparent" : "var(--teal-tint)", padding: "10px 16px" }}
                >
                  <div>
                    <div className="name" style={{ fontWeight: n.isRead ? 400 : 700 }}>
                      {n.message}
                    </div>
                    <div className="sub">
                      {formatJaDateTimeShort(n.createdAt)}
                      {n.case && (
                        <>
                          {"　"}
                          <Link href={`/patients/${n.caseId}`} style={{ textDecoration: "underline" }}>
                            {n.case.patientName}（{n.case.caseCode}）を開く
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                  {!n.isRead && (
                    <form action={markNotificationRead.bind(null, n.id)}>
                      <button type="submit" className="btn" style={{ fontSize: 11 }}>
                        既読にする
                      </button>
                    </form>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
