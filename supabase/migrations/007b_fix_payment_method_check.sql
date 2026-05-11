-- ============================================================
-- 007b_fix_payment_method_check.sql
-- 007_update_payment_method.sql が未適用だった場合の補完 SQL
-- Supabase SQL Editor にそのまま貼り付けて実行してください
-- 二重実行安全（IF NOT EXISTS / ON CONFLICT 対応）
-- ============================================================

-- 1. 旧 CHECK 制約を削除（存在しない場合はエラーにならない）
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_payment_method_check;

-- 2. 既存データの旧値を新値へ移行
--    ※ 既に新値が入っている行は ELSE で据え置き（変更なし）
UPDATE cases
SET payment_method = CASE payment_method
  WHEN 'キャッシュレス'      THEN '当日キャッシュレス'
  WHEN '現金'                THEN '当日現金'
  WHEN '現金+キャッシュレス' THEN '当日キャッシュレス+現金'
  ELSE payment_method         -- 新値 or NULL はそのまま
END
WHERE payment_method IN ('キャッシュレス', '現金', '現金+キャッシュレス');

-- 3. 新しい CHECK 制約を追加
ALTER TABLE cases ADD CONSTRAINT cases_payment_method_check
  CHECK (payment_method IN (
    '当日キャッシュレス',
    '当日現金',
    '当日キャッシュレス+現金',
    '事前キャッシュレス',
    '事前現金',
    '事前キャッシュレス+現金',
    '半額事前+半額当日',
    '請求書'
  ));

-- 確認クエリ（実行後に結果を確認してください）
SELECT payment_method, COUNT(*) FROM cases GROUP BY payment_method ORDER BY payment_method;
