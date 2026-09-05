# 模擬電子カルテ・オーダリングシステム

医学生・看護学生向けの、模擬患者症例を使った電子カルテ・オーダリング演習システム。学生はカルテ記載・
検査/処方/処置のオーダー・AI模擬患者との問診チャットを行い、裏側の生理学エンジンが病態の重症度・
バイタル・検査所見を時間経過とともに変化させる。教員・管理者は症例と病態テンプレート（治療条件・
急変シナリオ・薬剤マスター等）を作成・管理する。

## 技術スタック

- **Next.js 16**（App Router、Server Actions）/ **React 19** / TypeScript（`strict: true`）
- **Prisma 7** + `@prisma/adapter-libsql`（SQLiteドライバアダプタ、Prisma標準エンジンは不使用）
- ローカル開発: SQLiteファイル（`prisma/dev.db`）／本番: **Turso**（libSQLのマネージドホスティング）
- 認証: 自前実装（bcrypt + ランダムトークンのセッションCookie。`src/lib/auth.ts`）
- AI: Google Gemini（`@google/genai`）— 模擬患者との問診チャット、AI治療評価

`AGENTS.md` に記載の通り、このリポジトリのNext.jsは通常想定と異なる可能性があるバージョンを使っている。
挙動に迷ったら `node_modules/next/dist/docs/` を直接参照すること。

## セットアップ

```bash
npm install
cp .env.example .env
# .env に GEMINI_API_KEY を設定する（問診チャット・AI治療評価に必須。無くても他機能は動く）
npm run db:migrate     # ローカルSQLite(prisma/dev.db)にマイグレーションを適用
npm run db:seed        # ログイン用ユーザー・デモ症例を投入
npm run dev
```

`.env` の詳細は [.env.example](.env.example) を参照。`DATABASE_URL` を空にすると開発時は
`file:./prisma/dev.db` にフォールバックするが、本番（`NODE_ENV=production`）では起動時にエラーになる
（空のDBへ気付かず接続するのを防ぐため）。

### 初回データ投入の順序

`db:seed` はユーザー・デモ症例のみを作る。実際の薬剤マスター・検査項目・病態テンプレートのエンジン設定は
別スクリプトで投入する（`package.json` の `db:*` スクリプト一覧を参照）。代表的なもの:

```bash
npm run db:import-hot              # MEDIS HOT9形式の薬剤マスターを取り込み
npm run db:seed-aliases            # 薬剤の別名(略称・俗称)を投入
npm run db:import-drug-categories  # 薬効カテゴリ辞書とリンクを投入
npm run db:import-pathogens        # 原因菌・感受性マスターを投入
npm run db:seed-drug-effects       # 薬剤影響ルール(検査値・バイタルへの影響)を投入
npm run db:apply-engine-config     # 病態テンプレートのエンジン設定・急変シナリオ・薬効カテゴリ辞書を投入
```

ログイン情報はシード内容を参照（`student1` / `teacher1` / `admin1`、パスワードは全員 `password1`）。

## ローカルDBと本番(Turso)の関係

Prisma migrate は `libsql://` を直接デプロイできない（`prisma migrate deploy` はTursoでP1013エラー）ため、
本番へのマイグレーション適用は自前のランナー（`prisma/apply-turso-migrations.ts`）で行う。

```bash
npm run db:migrate                # ローカル: 通常のPrisma migrate
DATABASE_URL="libsql://...?authToken=..." npm run db:migrate-turso   # 本番: 自前ランナーで適用
```

**注意**: `apply-turso-migrations.ts` は `RedefineTable`（テーブル再構築を伴うマイグレーション）を
文字列パターンで検出し、既に反映済みなら安全にスキップする仕組みを持つ。これは2026-09-01に
再構築系マイグレーションを本番へ再実行してしまい `DrugMaster.normalizedName` が消失・
`isInjectable` が全件リセットされた事故（`repair-drugmaster-schema.ts` 参照）を受けて追加された。
`CREATE INDEX` のみの新規マイグレーション（再構築を伴わない）は素朴に流れるので影響しない。

### エンジン設定（病態テンプレート・急変シナリオ・薬効カテゴリ）

これらはリポジトリの `prisma/data/engine-config/*.json` を正として管理する：

```bash
npm run db:export-engine-config   # 現在のDB(既定: ローカル)からJSONへ書き出す（管理画面での編集を反映）
npm run db:apply-engine-config    # JSONをDATABASE_URLが指すDB(ローカル/Turso問わず)へ冪等に適用
npm run db:verify-engine-config   # DATABASE_URLが指すDBとJSONの差分を確認
```

過去、この3種のデータ（病態テンプレートのエンジン設定・急変シナリオ・薬効カテゴリ辞書）が
ローカル`dev.db`にしか存在せず本番Tursoに反映されていなかったことが原因で、実際に3件の本番障害が
発生していた（特に薬効カテゴリ未反映は「全症例が未治療扱いになり重症度が際限なく悪化、急変・死亡が
誤発火する」という重大なもの）。2026-09-05に `db:apply-engine-config` で本番へ反映済み・
`db:verify-engine-config` で差分ゼロを確認済み。今後、管理画面（`/admin/templates`, `/admin/drugs` 等）
で設定を変更したら、`db:export-engine-config` でJSONへ書き戻してコミットし、`db:apply-engine-config`
で本番へ反映する運用にする。

上記3種を個別にTursoへ同期していた `prisma/sync-crisis-scenarios-to-turso.ts` /
`sync-drug-categories-to-turso.ts` / `sync-template-engine-config-to-turso.ts` は本番反映確認後に
削除済み。`prisma/sync-drug-catalog-to-turso.ts`（`DrugMaster`/`DrugAlias` 本体の同期。薬効カテゴリの
ように「エンジン設定」ではなく薬剤カタログそのものなので対象外）のみ引き続き使用する。

## テスト・Lint

```bash
npx tsc --noEmit
npx eslint .
```

自動テストは未整備（`vitest` 等のテストランナー・CIは今後の課題）。`src/lib/physiology-engine.ts` と
`src/lib/infection-engine.ts` はDB非依存の純粋関数として設計されているため、ユニットテストの対象として
着手しやすい。

## ディレクトリ構成の要点

- `src/app/(app)/patients/[caseId]/` — 患者カルテ本体（サマリ／問診／カルテ記載／オーダー／検査結果／
  バイタル／退院の各タブ）
- `src/app/(app)/teacher/` — 教員・管理者向けの症例作成・重症度モニター
- `src/app/(app)/admin/` — マスターデータ管理（薬剤・検査項目・病態テンプレート・原因菌・監査ログ）
- `src/lib/engine.ts` — DBと連携するエンジン本体（reconcile処理、急変・死亡の状態遷移、AI治療評価）
- `src/lib/physiology-engine.ts` / `src/lib/infection-engine.ts` — DB非依存の純粋計算ロジック
  （重症度カーブ、バイタル・検査値の集約、感染症の培養結果生成）
- `src/lib/schemas.ts` — 信頼境界（DB上のJSON文字列・クライアントから渡されるServer Action引数）を
  越える値のzod検証
- `prisma/data/engine-config/` — 病態テンプレート・急変シナリオ・薬効カテゴリ辞書のJSON（正データ）
