-- ============================================================
-- 005_add_food_plans.sql
-- cases テーブルに飲食プラン列を追加
-- ・後方互換: DEFAULT ARRAY[]::TEXT[] のため既存案件は空配列
-- ・nullable 相当（空配列 = 未設定）
-- ・INSERT ONLY / ALTER ADD COLUMN のみ（既存行破壊なし）
-- ============================================================

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS food_plans TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
