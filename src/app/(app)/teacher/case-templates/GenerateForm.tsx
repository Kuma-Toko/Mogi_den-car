"use client";

import { useMemo, useState } from "react";

type Breakdown = { grade: string | null; affiliation: string | null; count: number };

// 学年・所属ごとの学生数の内訳を props で受け取り、選択に応じた対象人数をクライアント側だけで
// 即時計算する（追加の通信なし）。groupBy済みの粒度が最小単位なので、フィルタの一致判定だけで済む。
export function GenerateForm({
  action,
  breakdown,
}: {
  action: (formData: FormData) => void | Promise<void>;
  breakdown: Breakdown[];
}) {
  const grades = useMemo(
    () => Array.from(new Set(breakdown.map((b) => b.grade).filter((g): g is string => Boolean(g)))).sort(),
    [breakdown]
  );
  const affiliations = useMemo(
    () => Array.from(new Set(breakdown.map((b) => b.affiliation).filter((a): a is string => Boolean(a)))).sort(),
    [breakdown]
  );

  const [grade, setGrade] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [allStudents, setAllStudents] = useState(false);

  const hasFilter = grade !== "" || affiliation !== "";

  const matchCount = useMemo(() => {
    return breakdown
      .filter((b) => (grade ? b.grade === grade : true) && (affiliation ? b.affiliation === affiliation : true))
      .reduce((sum, b) => sum + b.count, 0);
  }, [breakdown, grade, affiliation]);

  const canSubmit = (hasFilter || allStudents) && matchCount > 0;

  return (
    <form action={action}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="grade">対象学年</label>
          <select
            id="grade"
            name="grade"
            value={grade}
            onChange={(e) => {
              setGrade(e.target.value);
              if (e.target.value) setAllStudents(false);
            }}
          >
            <option value="">（指定なし）</option>
            {grades.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="affiliation">対象所属</label>
          <select
            id="affiliation"
            name="affiliation"
            value={affiliation}
            onChange={(e) => {
              setAffiliation(e.target.value);
              if (e.target.value) setAllStudents(false);
            }}
          >
            <option value="">（指定なし）</option>
            {affiliations.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ margin: "10px 0", fontSize: 13 }}>
        対象学生数: <strong>{matchCount}</strong>人
      </div>

      {!hasFilter && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginBottom: 8 }}>
          <input
            type="checkbox"
            name="allStudents"
            checked={allStudents}
            onChange={(e) => setAllStudents(e.target.checked)}
          />
          学年・所属を指定せず、全学生を対象にする
        </label>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, padding: "6px 0" }}>
        <input type="checkbox" name="skipExisting" defaultChecked />
        既にこのテンプレートから生成済みの学生はスキップする
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, padding: "6px 0" }}>
        <input type="checkbox" name="appendStudentName" defaultChecked />
        症例名に学生名を付ける（例: 肺炎の72歳男性（山田太郎））
      </label>

      <div style={{ textAlign: "right", marginTop: 14 }}>
        <button type="submit" name="intent" value="draft" className="btn ghost" disabled={!canSubmit}>
          下書きとして生成
        </button>{" "}
        <button type="submit" name="intent" value="publish" className="btn primary" disabled={!canSubmit}>
          公開して生成
        </button>
      </div>
    </form>
  );
}
