"use client";

import { useRef, useState } from "react";
import { orderTypeLabel } from "@/lib/labels";
import type { CartItem } from "./actions";

const PROCEDURE_CATEGORIES = ["処置", "手術"];

// 処置はプルダウンから選択。手術は術式が多岐にわたるため従来どおり自由記述のみ。
const SELECT_OPTIONS: Record<string, string[]> = {
  処置: [
    "創傷処置（洗浄・消毒）",
    "縫合",
    "抜糸",
    "ギプス固定",
    "導尿",
    "浣腸",
    "腰椎穿刺",
    "胸腔穿刺",
    "腹腔穿刺",
    "気管挿管",
    "中心静脈カテーテル挿入",
    "胃洗浄",
    "除細動",
    "心肺蘇生（胸骨圧迫）",
    // 2026-09-16、病態モデル再構築に伴い追加。薬剤マスター上に対応カテゴリを持たない治療手技
    // （血栓溶解療法・電解質補正等）を処置オーダーとして表現し、治療開始判定のprocedureKeywords対象にする。
    "胸腔ドレナージ",
    "心嚢穿刺",
    "血液透析",
    "内視鏡的止血術",
    "内視鏡的胆道ドレナージ（ERCP）",
    "経皮的冠動脈インターベンション（PCI）",
    "血栓溶解療法（tPA静注）",
    "血栓回収療法（機械的血栓除去）",
    "血漿交換療法",
    "開頭術（血腫除去・減圧）",
    "高張食塩水投与",
    "体表冷却",
    "積極的復温",
    "高気圧酸素療法",
    "試験開腹止血術",
    "緊急帝王切開術",
    "経皮的ペーシング・ペースメーカー植込み",
    "壊死組織デブリードマン",
  ],
};

export function ProcedureOrderDialog({ onAdd }: { onAdd: (item: CartItem) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState(PROCEDURE_CATEGORIES[0]);
  const [selection, setSelection] = useState(SELECT_OPTIONS[PROCEDURE_CATEGORIES[0]][0]);
  const [comment, setComment] = useState("");

  const options = SELECT_OPTIONS[category];

  function switchCategory(c: string) {
    setCategory(c);
    setSelection(SELECT_OPTIONS[c]?.[0] ?? "");
    setComment("");
  }

  function openDialog() {
    switchCategory(PROCEDURE_CATEGORIES[0]);
    dialogRef.current?.showModal();
  }

  function addToCart() {
    onAdd({ kind: "PROCEDURE", category, selection: options ? selection : "", comment: comment.trim() });
    setComment("");
    if (options) setSelection(options[0]);
    dialogRef.current?.close();
  }

  return (
    <>
      <div onClick={openDialog}>＋ {orderTypeLabel.PROCEDURE}</div>
      <dialog
        ref={dialogRef}
        className="order-dialog"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="order-dialog-inner">
          <div className="order-dialog-body">
            <div className="order-dialog-title">{orderTypeLabel.PROCEDURE}オーダー</div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>カテゴリ</label>
              <div className="radio2">
                {PROCEDURE_CATEGORIES.map((c) => (
                  <div key={c} className={category === c ? "on" : ""} onClick={() => switchCategory(c)}>
                    {c}
                  </div>
                ))}
              </div>
            </div>
            {options && (
              <div className="field" style={{ marginBottom: 10 }}>
                <label>{category}</label>
                <select value={selection} onChange={(e) => setSelection(e.target.value)}>
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field" style={{ marginBottom: 10 }}>
              <label>{options ? "補足コメント（任意・部位や麻酔など）" : "術式名"}</label>
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={options ? "例: 右前腕、局所麻酔下" : "例: 虫垂切除術"}
              />
            </div>
          </div>
          <div className="order-dialog-footer">
            <button type="button" className="btn ghost" onClick={() => dialogRef.current?.close()}>
              閉じる
            </button>
            <button type="button" className="btn primary" onClick={addToCart}>
              カートに追加
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
