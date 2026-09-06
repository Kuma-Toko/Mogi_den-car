import Link from "next/link";

export function SortableTh({
  label,
  sortKey,
  sort,
  dir,
  basePath,
  params,
}: {
  label: string;
  sortKey: string;
  sort?: string;
  dir?: "asc" | "desc";
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  const active = sort === sortKey;
  const nextDir: "asc" | "desc" = active && dir === "asc" ? "desc" : "asc";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v) sp.set(k, v);
  }
  sp.set("sort", sortKey);
  sp.set("dir", nextDir);

  return (
    <th>
      <Link href={`${basePath}?${sp.toString()}`} className="th-sort">
        {label}
        <span className={`th-sort-arrow${active ? " active" : ""}`}>{active ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </Link>
    </th>
  );
}
