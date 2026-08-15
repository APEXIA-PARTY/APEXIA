-- ============================================================
-- 20260814_add_food_plan_master_default_price.sql
--
-- 目的:
--   飲食プランマスタ（food_plan_master）に「単価」（default_price）
--   を追加する。単位（unit）は今回追加しない。
--
--   既存データへの影響:
--     - food_plan_master: default_price 列を DEFAULT なし・NULL許容で
--       追加するため、既存行は自動的に NULL（未設定）になる。
--       0円として確定扱いにはしない。
--     - プラン名からの価格自動抽出は行わない。
--     - case_food_plans（案件側の飲食プラン明細）は一切変更しない。
--       既存案件の数量・単価・小計（amount）に影響なし。
-- ============================================================

ALTER TABLE food_plan_master
  ADD COLUMN IF NOT EXISTS default_price BIGINT;
