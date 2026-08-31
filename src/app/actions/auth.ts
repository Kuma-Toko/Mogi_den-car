"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession, verifyPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export type LoginState = { error?: string } | undefined;

function homePathForRole(role: string): string {
  if (role === "STUDENT") return "/patients";
  return "/teacher/cases";
}

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const loginId = String(formData.get("loginId") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!loginId || !password) {
    return { error: "ログインIDとパスワードを入力してください。" };
  }

  const user = await db.user.findUnique({ where: { loginId } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "ログインIDまたはパスワードが正しくありません。" };
  }

  await createSession(user.id);
  await logAudit({ userId: user.id, action: "login" });

  redirect(homePathForRole(user.role));
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
