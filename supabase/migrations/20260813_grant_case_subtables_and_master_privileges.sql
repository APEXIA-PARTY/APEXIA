-- ============================================================
-- 20260813_grant_case_subtables_and_master_privileges.sql
--
-- 目的:
--   テスト用Supabaseで、以下7テーブルに authenticated ロールへの
--   テーブルレベル権限（GRANT）が不足していることが判明したため、
--   コードで実際に使用されている操作に対応する権限のみを付与する。
--
--   RLSポリシー（is_staff_or_above() / is_admin() による行レベル制御）
--   および各APIルートの requireAuth/requireStaff/requireAdmin ガードは
--   一切変更しない。viewer/staff/admin の権限制御は、引き続き
--   RLSポリシーとAPIガードに委ねる。GRANTはその前提となる
--   テーブルレベルのアクセス許可のみを扱う。
--
--   APIでDELETEルートが未実装のテーブルには DELETE 権限を付与しない
--   （case_files, case_hold_logs, option_master, food_plan_master）。
-- ============================================================

-- 案件サブテーブル（GET/POST/PUT/DELETE すべて実装済み）
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.case_checklist TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.case_food_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.case_options TO authenticated;

-- 案件サブテーブル（DELETEルート未実装のため DELETE は付与しない）
GRANT SELECT, INSERT, UPDATE ON TABLE public.case_files TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.case_hold_logs TO authenticated;

-- マスタテーブル（GET/POST/PATCH実装、DELETEルート未実装のため DELETE は付与しない）
GRANT SELECT, INSERT, UPDATE ON TABLE public.option_master TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.food_plan_master TO authenticated;
