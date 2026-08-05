-- 既存カラムの変更・削除は一切行わない安全なADDのみのマイグレーション
-- 1. 申込み金ステータス（未対応/済み）
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS deposit_status TEXT NOT NULL DEFAULT '未対応'
    CHECK (deposit_status IN ('未対応', '済み'));

-- 2. 残額支払いステータス（未対応/済み）
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS remaining_payment_status TEXT NOT NULL DEFAULT '未対応'
    CHECK (remaining_payment_status IN ('未対応', '済み'));

-- 3. 開催日備考（スタッフ内部メモ、PDF非表示）
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS event_date_note TEXT DEFAULT NULL;
