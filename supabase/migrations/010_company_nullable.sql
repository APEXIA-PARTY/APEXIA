-- ============================================================
-- 010_company_nullable.sql
-- cases.company を任意入力（nullable）に変更
-- Supabase SQL Editor にそのまま貼り付けて実行してください
-- 既存データは一切変更しません
-- ============================================================

-- NOT NULL 制約を解除
ALTER TABLE cases ALTER COLUMN company DROP NOT NULL;

-- DEFAULT を明示（空文字より null を優先）
ALTER TABLE cases ALTER COLUMN company SET DEFAULT NULL;

-- 確認クエリ
SELECT
  column_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'cases' AND column_name = 'company';
