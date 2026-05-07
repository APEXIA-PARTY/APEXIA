-- ============================================================
-- 006_food_plan_master.sql
-- 飲食プランマスタテーブル作成 + 初期データ投入
-- ============================================================

CREATE TABLE IF NOT EXISTS food_plan_master (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  display_order INT     NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_food_plan_master_updated_at
  BEFORE UPDATE ON food_plan_master
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 初期データ（既存 FoodPlans.tsx のハードコード値を移行）
INSERT INTO food_plan_master (name, display_order) VALUES
  ('5,000ビュッフェ',    10),
  ('6,000ビュッフェ',    20),
  ('8,000ビュッフェ',    30),
  ('7F 飲み放題3,000',   40),
  ('8F飲み放題4,000',    50),
  ('4,500ビュッフェ',    60),
  ('4,200ビュッフェ',    70),
  ('4,000ビュッフェ',    80)
ON CONFLICT DO NOTHING;
