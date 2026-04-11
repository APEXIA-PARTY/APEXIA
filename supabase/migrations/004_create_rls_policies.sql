-- ============================================================
-- 004_create_rls_policies.sql
-- RLS ポリシー（ロールベース）
--
-- ロール設計:
--   admin  → 全操作（マスタ書き込み含む）
--   staff  → 案件CRUD + マスタ読み取り
--   viewer → 全テーブル読み取りのみ
--
-- ロールは auth.users の user_metadata->>'role' で判定する
-- ============================================================

-- ─── ヘルパー関数 ─────────────────────────────────────────────

-- 現在ユーザーのロールを取得
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT COALESCE(
    auth.jwt() -> 'user_metadata' ->> 'role',
    'viewer'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- admin かどうかを返す
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT get_user_role() = 'admin';
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- staff 以上（admin または staff）かどうかを返す
CREATE OR REPLACE FUNCTION is_staff_or_above()
RETURNS BOOLEAN AS $$
  SELECT get_user_role() IN ('admin', 'staff');
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ─── RLS 有効化 ───────────────────────────────────────────────
ALTER TABLE media_master             ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_method_master    ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_category_master    ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_subcategory_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE floor_master             ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancel_reason_master     ENABLE ROW LEVEL SECURITY;
ALTER TABLE option_master            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_options             ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_checklist           ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_files               ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_hold_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_history             ENABLE ROW LEVEL SECURITY;

-- ─── マスタテーブルのポリシー ─────────────────────────────────
-- 読み取り: 認証済みユーザー全員
-- 書き込み: admin のみ

DO $$
DECLARE
  t TEXT;
  master_tables TEXT[] := ARRAY[
    'media_master',
    'contact_method_master',
    'event_category_master',
    'event_subcategory_master',
    'floor_master',
    'cancel_reason_master',
    'option_master'
  ];
BEGIN
  FOREACH t IN ARRAY master_tables LOOP
    EXECUTE format(
      'CREATE POLICY "authenticated_can_read_%I" ON %I
       FOR SELECT TO authenticated USING (true)',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "admin_can_write_%I" ON %I
       FOR INSERT TO authenticated WITH CHECK (is_admin())',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "admin_can_update_%I" ON %I
       FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin())',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "admin_can_delete_%I" ON %I
       FOR DELETE TO authenticated USING (is_admin())',
      t, t
    );
  END LOOP;
END;
$$;

-- ─── cases テーブルのポリシー ─────────────────────────────────
-- 読み取り: 認証済みユーザー全員
-- 書き込み: staff 以上
-- 削除:     staff 以上

CREATE POLICY "anyone_can_insert_cases" ON cases
FOR INSERT
TO authenticated
WITH CHECK (true);
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "staff_can_insert_cases" ON cases
  FOR INSERT TO authenticated WITH CHECK (is_staff_or_above());

CREATE POLICY "staff_can_update_cases" ON cases
  FOR UPDATE TO authenticated
  USING (is_staff_or_above())
  WITH CHECK (is_staff_or_above());

CREATE POLICY "staff_can_delete_cases" ON cases
  FOR DELETE TO authenticated USING (is_staff_or_above());

-- ─── 案件関連テーブルのポリシー ───────────────────────────────
-- cases と同じポリシーを適用

DO $$
DECLARE
  t TEXT;
  case_related_tables TEXT[] := ARRAY[
    'case_options',
    'case_checklist',
    'case_files',
    'case_hold_logs',
    'case_history'
  ];
BEGIN
  FOREACH t IN ARRAY case_related_tables LOOP
    EXECUTE format(
      'CREATE POLICY "authenticated_can_read_%I" ON %I
       FOR SELECT TO authenticated USING (true)',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "staff_can_insert_%I" ON %I
       FOR INSERT TO authenticated WITH CHECK (is_staff_or_above())',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "staff_can_update_%I" ON %I
       FOR UPDATE TO authenticated
       USING (is_staff_or_above()) WITH CHECK (is_staff_or_above())',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "staff_can_delete_%I" ON %I
       FOR DELETE TO authenticated USING (is_staff_or_above())',
      t, t
    );
  END LOOP;
END;
$$;

-- ─── Supabase Storage バケットのポリシー ─────────────────────
-- case-files バケットを作成し、認証済みユーザーが読み書きできるようにする
-- ※ Supabase Dashboard から手動で作成するか、以下の SQL を実行する

INSERT INTO storage.buckets (id, name, public)
VALUES ('case-files', 'case-files', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "authenticated_can_read_case_files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'case-files');

CREATE POLICY "staff_can_upload_case_files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'case-files' AND is_staff_or_above());

CREATE POLICY "staff_can_update_case_files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'case-files' AND is_staff_or_above());

CREATE POLICY "staff_can_delete_case_files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'case-files' AND is_staff_or_above());
