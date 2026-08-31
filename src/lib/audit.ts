import "server-only";
import { db } from "@/lib/db";

export async function logAudit(params: {
  userId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: unknown;
}) {
  await db.auditLog.create({
    data: {
      userId: params.userId ?? null,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      detail: params.detail !== undefined ? JSON.stringify(params.detail) : undefined,
    },
  });
}
