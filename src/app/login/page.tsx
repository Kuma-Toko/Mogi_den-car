"use client";

import { useActionState } from "react";
import { login } from "@/app/actions/auth";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>模擬臨床カルテ</h1>
        <div className="sub">臨床実習支援システム ログイン</div>

        {state?.error && <div className="error">{state.error}</div>}

        <form action={formAction}>
          <div className="field">
            <label htmlFor="loginId">ログインID</label>
            <input id="loginId" name="loginId" type="text" autoComplete="username" required />
          </div>
          <div className="field">
            <label htmlFor="password">パスワード</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <button type="submit" className="btn primary" style={{ width: "100%" }} disabled={pending}>
            {pending ? "ログイン中…" : "ログイン"}
          </button>
        </form>

        <div className="hint">
          学生: student1 / password1<br />
          教員: teacher1 / password1<br />
          管理者: admin1 / password1
        </div>
      </div>
    </div>
  );
}
