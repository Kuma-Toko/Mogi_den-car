"use client";

import { useEffect } from "react";

// (app)配下（カルテ・オーダー・管理画面など）の各ページはreconcile処理やJSON.parseを含む
// DB読み取りをレンダリング中に同期実行しており、失敗すると従来は素のNext.jsエラー画面になっていた。
// このファイルがあることでサイドバー（親のlayout.tsx）は表示されたまま、コンテンツ領域だけが
// エラー表示に切り替わる。
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="content">
      <div className="banner-error" style={{ marginBottom: 14 }}>
        表示中にエラーが発生しました。データが破損しているか、一時的な問題の可能性があります。
      </div>
      <button type="button" className="btn primary" onClick={() => retry()}>
        再読み込み
      </button>
    </div>
  );
}
