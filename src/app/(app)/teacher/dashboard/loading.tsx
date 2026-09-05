// page.tsxはアクティブな全症例に対してreconcileCase()を逐次awaitしてから描画するため、
// 症例数が多いと応答までの待ち時間が目立つ。loading.tsxが無いとこの間何も表示されなかった。
export default function TeacherDashboardLoading() {
  return (
    <div className="content">
      <div className="empty-note">重症度モニターを読み込んでいます…</div>
    </div>
  );
}
