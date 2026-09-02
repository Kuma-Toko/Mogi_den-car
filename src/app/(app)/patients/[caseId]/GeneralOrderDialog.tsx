"use client";

import { useRef, useState } from "react";
import { orderTypeLabel } from "@/lib/labels";
import type { CartItem } from "./actions";

const GENERAL_CATEGORIES = [
  "安静度",
  "食事",
  "清潔・清拭",
  "活動・リハビリ",
  "酸素投与",
  "吸引（気道吸引）",
  "抑制（身体拘束）",
  "ドレーン・カテーテル管理",
];

// 安静度・食事・酸素投与・吸引・抑制・ドレーン管理はプルダウンから選択。
// それ以外（清潔・清拭／活動・リハビリ）は従来どおり自由記述のみ。
const SELECT_OPTIONS: Record<string, string[]> = {
  安静度: ["ベッド上安静", "ベッド上安静（体位変換可）", "室内フリー", "病棟内フリー", "院内フリー", "安静制限なし"],
  食事: ["絶食", "飲水のみ可", "流動食", "三分粥", "五分粥", "七分粥", "全粥", "常食", "糖尿病食", "塩分制限食（6g/日）"],
  酸素投与: [
    "鼻カニューレ 1L/分",
    "鼻カニューレ 2L/分",
    "鼻カニューレ 3L/分",
    "鼻カニューレ 4L/分",
    "鼻カニューレ 5L/分",
    "簡易酸素マスク 5L/分",
    "簡易酸素マスク 6L/分",
    "簡易酸素マスク 7L/分",
    "リザーバーマスク 8L/分",
    "リザーバーマスク 10L/分",
    "リザーバーマスク 15L/分",
    "中止（room air）",
  ],
  "吸引（気道吸引）": ["口腔・鼻腔吸引 適宜", "口腔・鼻腔吸引 1時間毎", "気管内吸引 適宜", "気管内吸引 2時間毎", "中止"],
  "抑制（身体拘束）": ["両上肢抑制", "体幹抑制", "両上肢・体幹抑制", "ミトン型抑制具使用", "解除"],
  "ドレーン・カテーテル管理": [
    "膀胱留置カテーテル管理",
    "胃管（経鼻胃管）管理",
    "創部ドレーン管理",
    "胸腔ドレーン管理",
    "抜去",
  ],
};

export function GeneralOrderDialog({ onAdd }: { onAdd: (item: CartItem) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState(GENERAL_CATEGORIES[0]);
  const [selection, setSelection] = useState(SELECT_OPTIONS[GENERAL_CATEGORIES[0]][0]);
  const [comment, setComment] = useState("");

  const options = SELECT_OPTIONS[category];

  function switchCategory(c: string) {
    setCategory(c);
    setSelection(SELECT_OPTIONS[c]?.[0] ?? "");
    setComment("");
  }

  function openDialog() {
    switchCategory(GENERAL_CATEGORIES[0]);
    dialogRef.current?.showModal();
  }

  function addToCart() {
    onAdd({ kind: "GENERAL", category, selection: options ? selection : "", comment: comment.trim() });
    setComment("");
    if (options) setSelection(options[0]);
  }

  return (
    <>
      <div onClick={openDialog}>＋ {orderTypeLabel.GENERAL}</div>
      <dialog
        ref={dialogRef}
        className="order-dialog"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="order-dialog-inner">
          <div className="order-dialog-body">
            <div className="order-dialog-title">{orderTypeLabel.GENERAL}オーダー</div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>カテゴリ</label>
              <div className="radio2">
                {GENERAL_CATEGORIES.map((c) => (
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
              <label>{options ? "補足コメント（任意）" : "内容"}</label>
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={options ? "例: 夜間のみ制限あり" : "例: ベッド上安静"}
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
