import Link from "next/link";

// アプリ全体でnot-found.tsxが1つも無く、未マッチのURL・notFound()呼び出しが
// 英語のデフォルトNext.js 404画面になっていたため追加する。
export default function NotFound() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        gap: 10,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700 }}>ページが見つかりません</div>
      <div style={{ fontSize: 12.5, color: "#666" }}>
        URLが間違っているか、削除・移動された可能性があります。
      </div>
      <Link
        href="/"
        style={{
          marginTop: 8,
          padding: "8px 20px",
          borderRadius: 6,
          background: "#2b6cb0",
          color: "#fff",
          fontSize: 13,
          textDecoration: "none",
        }}
      >
        トップへ戻る
      </Link>
    </div>
  );
}
