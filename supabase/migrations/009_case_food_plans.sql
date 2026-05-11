-- ============================================================
-- 009_case_food_plans.sql
-- 飲食プラン 中間テーブル方式への移行
-- 方針:
--   ① case_food_plans テーブルを新規作成
--   ② cases.food_plans TEXT[] は削除しない（ロールバック用に保持）
--   ③ 既存データを unnest して移行（重複実行安全）
-- ============================================================

-- ─── 1. テーブル作成 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_food_plans (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       UUID        NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  food_plan_id  UUID        REFERENCES food_plan_master(id) ON DELETE SET NULL,
  name          TEXT        NOT NULL,
  qty           INT         NOT NULL DEFAULT 1,
  unit_price    BIGINT      NOT NULL DEFAULT 0,
  amount        BIGINT      GENERATED ALWAYS AS (qty * unit_price) STORED,
  state         TEXT        NOT NULL DEFAULT '未確認'
                            CHECK (state IN ('未確認', '質問中', '検討中', '確定', '不要')),
  sort_order    INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_food_plans_case_id ON case_food_plans(case_id);

-- ─── 2. updated_at トリガー ───────────────────────────────────
DROP TRIGGER IF EXISTS trg_case_food_plans_updated_at ON case_food_plans;
CREATE TRIGGER trg_case_food_plans_updated_at
  BEFORE UPDATE ON case_food_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── 3. RLS ──────────────────────────────────────────────────
ALTER TABLE case_food_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_can_read_case_food_plans"  ON case_food_plans;
DROP POLICY IF EXISTS "staff_can_insert_case_food_plans"        ON case_food_plans;
DROP POLICY IF EXISTS "staff_can_update_case_food_plans"        ON case_food_plans;
DROP POLICY IF EXISTS "staff_can_delete_case_food_plans"        ON case_food_plans;

CREATE POLICY "authenticated_can_read_case_food_plans"
  ON case_food_plans FOR SELECT TO authenticated USING (true);

CREATE POLICY "staff_can_insert_case_food_plans"
  ON case_food_plans FOR INSERT TO authenticated WITH CHECK (is_staff_or_above());

CREATE POLICY "staff_can_update_case_food_plans"
  ON case_food_plans FOR UPDATE TO authenticated
  USING (is_staff_or_above()) WITH CHECK (is_staff_or_above());

CREATE POLICY "staff_can_delete_case_food_plans"
  ON case_food_plans FOR DELETE TO authenticated USING (is_staff_or_above());

-- ─── 4. 既存データ移行 ────────────────────────────────────────
-- cases.food_plans TEXT[] を unnest して case_food_plans へコピー
-- 重複実行安全: 既に case_id の行が存在する case はスキップ
INSERT INTO case_food_plans (case_id, food_plan_id, name, qty, unit_price, state, sort_order)
SELECT
  c.id                                                              AS case_id,
  fpm.id                                                            AS food_plan_id,
  t.plan_name                                                       AS name,
  1                                                                 AS qty,
  0                                                                 AS unit_price,
  '未確認'                                                          AS state,
  (CAST(t.ordinality AS INT) - 1) * 10                             AS sort_order
FROM cases c
CROSS JOIN LATERAL unnest(c.food_plans) WITH ORDINALITY AS t(plan_name, ordinality)
LEFT JOIN food_plan_master fpm ON fpm.name = t.plan_name
WHERE array_length(c.food_plans, 1) > 0
  AND NOT EXISTS (
    SELECT 1 FROM case_food_plans cfp WHERE cfp.case_id = c.id
  );

-- ─── 5. ロールバック手順（必要な場合のみ手動実行） ────────────
-- cases.food_plans は保持してあるので以下で戻せる:
--   DROP TABLE IF EXISTS case_food_plans;
-- ============================================================
