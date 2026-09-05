// page.tsxはレンダリング中にreconcileCase()（複数のDB書き込みを伴うエンジン処理一式）を
// 同期実行するため、体感の待ち時間が発生しうる。loading.tsxが無いとこの間何も表示されなかった。
export default function CaseDetailLoading() {
  return (
    <div className="content">
      <div className="empty-note">カルテを読み込んでいます…</div>
    </div>
  );
}
