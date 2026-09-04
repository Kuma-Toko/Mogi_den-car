const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const JST_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hour12: false,
});

// サーバープロセスのタイムゾーン設定に関わらず、常に日本標準時（Asia/Tokyo）で年月日時分を取得する。
function getJstParts(date: Date): { y: number; m: number; d: number; hh: number; mm: number } {
  const parts = JST_PARTS.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hh = get("hour");
  return { y: get("year"), m: get("month"), d: get("day"), hh: hh === 24 ? 0 : hh, mm: get("minute") };
}

export function formatJaDateTime(date: Date): string {
  const { y, m, d, hh, mm } = getJstParts(date);
  // 曜日は年月日（JST基準の暦日）のみに依存するため、ロケール依存の表記に頼らずローカルで再計算する。
  const w = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日（${w}）${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function formatJaDateTimeShort(date: Date): string {
  const { m, d, hh, mm } = getJstParts(date);
  return `${m}/${d} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function formatRelative(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}日前`;
}
