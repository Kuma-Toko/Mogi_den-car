// 薬剤名・別名の検索キー用正規化。表記ゆれ(全角/半角、半角カナ、区切り記号、大小文字)を
// 吸収して比較できるようにする。DrugMaster.normalizedName / DrugAlias.normalizedText は
// この関数の出力を保存し、検索クエリ側も同じ関数を通してから contains 比較する。
//
// NFKC正規化で「全角英数字→半角」と「半角カナ→全角カナ」の両方が一度に片付く。
// 残りの区切り記号統一・大小文字統一・空白圧縮は個別に処理する。
const DELIMITER_CHARS = /[・/、\-ー]/g;

export function normalizeDrugName(input: string): string {
  return input
    .normalize("NFKC")
    .toUpperCase()
    .replace(DELIMITER_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
}
