// 添付文書検索リンク。DrugMasterはHOT9コード管理でPMDA側のYJコードと対応表がなく、
// 個別文書への直リンクは作れないため、薬品名でPMDA添付文書検索サイトを引くGoogle検索へ誘導する。
export function packageInsertSearchUrl(drugName: string): string {
  const query = `site:pmda.go.jp 添付文書 ${drugName}`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
