# APEXIA イベント管理システム

## セットアップ手順

### 1. 依存パッケージのインストール
```bash
npm install
```

### 2. 環境変数の設定
```bash
cp .env.local.example .env.local
```
`.env.local` を編集して Supabase の URL とキーを設定してください。

### 3. Supabase プロジェクトのセットアップ

#### マイグレーション実行
```bash
# Supabase CLI を使う場合
supabase db push

# または Supabase Dashboard の SQL Editor で順番に実行
# supabase/migrations/001_create_master_tables.sql
# supabase/migrations/002_create_cases_table.sql
# supabase/migrations/003_create_case_related_tables.sql
# supabase/migrations/004_create_rls_policies.sql
```

> **注記: migration 005 について**  
> `005_auto_cancel_function.sql` は存在しません（欠番）。  
> 自動キャンセル処理は DB 関数ではなく、アプリ側の `app/api/auto-cancel/route.ts` で実装されています。  
> 本番環境への適用は **001〜004 の4ファイルのみ** で完結します。

#### 初期データ投入
```bash
# Supabase Dashboard の SQL Editor で実行
# supabase/seed/01_initial_master_data.sql
```

### 4. 最初のユーザー作成（管理者）

Supabase Dashboard → Authentication → Users → "Add user" から作成し、
作成後に SQL Editor で以下を実行して admin ロールを付与します：

```sql
UPDATE auth.users
SET raw_user_meta_data = raw_user_meta_data || '{"role": "admin"}'
WHERE email = 'your-admin@example.com';
```

スタッフユーザーの場合は `"role": "staff"` を設定してください。

### 5. 開発サーバー起動
```bash
npm run dev
```

http://localhost:3000 にアクセス → `/login` にリダイレクトされます。

---

## 実装フェーズ状況

| Phase | 内容 | 状態 |
|-------|------|------|
| Phase 1 | 認証・案件CRUD・ダッシュボード | ✅ 完了 |
| Phase 2 | マスタ管理画面 | 🔲 未着手 |
| Phase 3 | オプション・ファイル・確認事項・仮押さえ | 🔲 未着手 |
| Phase 4 | 集計・グラフ | 🔲 未着手 |
| Phase 5 | 自動キャンセル・GCal・PDF出力 | 🔲 未着手 |

---

## ディレクトリ構成（主要ファイル）

```
app/
  (auth)/login/          ← ログイン画面
  (dashboard)/
    page.tsx             ← ダッシュボード
    cases/
      page.tsx           ← 案件一覧
      new/page.tsx       ← 新規登録
      [id]/
        page.tsx         ← 案件詳細
        edit/page.tsx    ← 案件編集
  api/
    cases/               ← 案件API
    master/              ← マスタAPI（読み取り）
    analytics/           ← 集計API

components/
  cases/
    CaseForm.tsx         ← 新規・編集共通フォーム
    StatusBadge.tsx
    CaseDetail/          ← 詳細セクション
  layout/
    Sidebar.tsx
    PageHeader.tsx
  dashboard/
    KpiCard.tsx

lib/
  supabase/              ← Supabaseクライアント
  auth/helpers.ts        ← 認証ガード
  constants/status.ts    ← ステータス定数
  validations/case.ts    ← Zodスキーマ
  utils/                 ← format, cn

supabase/
  migrations/            ← DDL
  seed/                  ← 初期データ
```

---

## マスタデータの差し替え方法

イベント大分類・中分類、キャンセル理由、オプションは仮データです。
正式な初期値に変更する場合は以下のいずれかの方法で行ってください：

1. **アプリ画面から変更**（Phase 2 実装後）  
   `/master` 画面から追加・編集・並び替えが可能

2. **SQL で直接変更**  
   既存レコードを `UPDATE` するか、`is_active = false` で無効化して新規追加

3. **シードファイルを編集して再投入**  
   `supabase/seed/01_initial_master_data.sql` を編集後、  
   対象テーブルを `TRUNCATE` して再実行（データが消えるので開発環境のみ推奨）
