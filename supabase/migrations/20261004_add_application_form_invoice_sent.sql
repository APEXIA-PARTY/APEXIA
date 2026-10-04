-- ============================================================
-- 20261004_add_application_form_invoice_sent.sql
-- 確認手続き「申込みフォーム」に「請求書送付済み」を追加する
--
-- 【適用状況】未適用です。
--   このファイルは作成のみで、Claude Code は本番DB・Supabase に一切適用していません。
--   適用する場合は、必ず人間が内容を確認したうえで実施してください。
--
-- 【背景】
--   cases.application_form_status の CHECK 制約は ('未対応', '済み') のみを許可している。
--   アプリ側（型・Zod・選択肢・画面）は 3 値（未対応 / 請求書送付済み / 済み）に対応済みだが、
--   このmigrationを適用するまで「請求書送付済み」の保存は DB の CHECK 制約で失敗する
--   （既存の 未対応 / 済み は従来どおり動作する）。
--   保存値は表示ラベルと同じ文字列（他の確認手続き項目と同じ設計）。
--
-- 【内容】
--   cases.application_form_status の既存 CHECK 制約を削除し、
--   許可値に '請求書送付済み' を加えた制約を付け直す
--   （未対応 / 請求書送付済み / 済み）。
--   制約名は環境により異なる可能性があるため、application_form_status を
--   参照する CHECK 制約を pg_constraint から検索して削除する。
--
-- 【既存データへの影響】
--   既存行の INSERT / UPDATE / DELETE は行わない。
--   既存値（未対応 / 済み）は新しい制約でも引き続き許可されるため、データは変更されない。
--
-- 【ロールバック】
--   '請求書送付済み' の行が 1 件も無い場合に限り、制約を元の 2 値に戻せる。
--   行が存在する状態で戻そうとすると制約追加が失敗する
--   （先にそれらの行の値を人間が判断して変更する必要がある）。
-- ============================================================

BEGIN;

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'cases'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%application_form_status%'
  LOOP
    EXECUTE format('ALTER TABLE cases DROP CONSTRAINT %I', c.conname);
  END LOOP;
END
$$;

ALTER TABLE cases
  ADD CONSTRAINT cases_application_form_status_check
  CHECK (application_form_status IN ('未対応', '請求書送付済み', '済み'));

COMMIT;
