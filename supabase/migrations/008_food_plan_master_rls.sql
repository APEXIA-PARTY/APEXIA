-- ============================================================
-- 008_food_plan_master_rls.sql
-- food_plan_master テーブルに RLS + ポリシーを追加
-- 006 で CREATE TABLE したが 004 の RLS 設定ループに含まれていなかった
-- ============================================================

ALTER TABLE food_plan_master ENABLE ROW LEVEL SECURITY;

-- 読み取り: 認証済みユーザー全員（staff/viewer 含む）
CREATE POLICY "authenticated_can_read_food_plan_master"
  ON food_plan_master FOR SELECT TO authenticated USING (true);

-- 追加: admin のみ
CREATE POLICY "admin_can_write_food_plan_master"
  ON food_plan_master FOR INSERT TO authenticated WITH CHECK (is_admin());

-- 更新: admin のみ
CREATE POLICY "admin_can_update_food_plan_master"
  ON food_plan_master FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- 削除（論理削除）: admin のみ
CREATE POLICY "admin_can_delete_food_plan_master"
  ON food_plan_master FOR DELETE TO authenticated USING (is_admin());
