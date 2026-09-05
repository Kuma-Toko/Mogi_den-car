"use client";

// ルートレイアウト（src/app/layout.tsx）自体を含め、アプリ全体で捕捉されなかった例外が
// 到達する最後の砦。ここが無いと、この種のエラーは英語のデフォルトNext.jsエラー画面になる。
// ルートレイアウトを丸ごと置き換えるため、html/bodyを自前で持つ必要がある。
// Next.js 16.3+ ではretry()が正式版（内容を再フェッチ・再レンダリング）。resetは特定用途向けの代替。
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="ja">
      <body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            gap: 12,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700 }}>予期しないエラーが発生しました</div>
          <div style={{ fontSize: 12.5, color: "#666" }}>お手数ですが、もう一度お試しください。</div>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: 8,
              padding: "8px 20px",
              borderRadius: 6,
              border: "none",
              background: "#2b6cb0",
              color: "#fff",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            再読み込み
          </button>
        </div>
      </body>
    </html>
  );
}
