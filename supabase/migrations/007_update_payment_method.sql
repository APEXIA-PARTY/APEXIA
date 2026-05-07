-- ============================================================
-- 007_update_payment_method.sql
-- 支払い方法の選択肢拡張 + 既存データの後方互換移行
-- ============================================================

-- 1. 旧 CHECK 制約を削除（制約名は PostgreSQL 自動命名）
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_payment_method_check;

-- 2. 既存データを新選択肢へ移行（逆変換が起きないよう CASE 順に注意）
UPDATE cases
SET payment_method = CASE payment_method
  WHEN 'キャッシュレス'       THEN '当日キャッシュレス'
  WHEN '現金'                 THEN '当日現金'
  WHEN '現金+キャッシュレス'  THEN '当日キャッシュレス+現金'
  ELSE payment_method
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
