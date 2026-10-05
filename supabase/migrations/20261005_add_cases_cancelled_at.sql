-- ============================================================
-- 20261005_add_cases_cancelled_at.sql
-- cases.cancelled_at（最後に cancelled へ新規突入した正確な時刻）を追加する
--
-- 【適用状況】未適用です。
--   このファイルは作成・検証のみで、本番DB（Alexia）にも検証用DB（APEXIA-test）にも
--   適用していません。適用は、内容を確認した人間の承認後に行うこと。
--   適用順: この migration → 20261005_cases_status_change_trigger.sql → その後にアプリのデプロイ。
--   （アプリは cancelled_at を SELECT するため、列を追加する前にデプロイすると分析画面が取得に失敗する）
--
-- 【内容】
--   cases に cancelled_at timestamptz（NULL 可・default なし）を 1 列追加するだけ。
--   ・値は「正しい瞬間」の timestamptz（preview_datetime のような JST 壁時計の UTC 欄保存ではない）。
--   ・打刻は次の migration のトリガーだけが行う（OLD.status <> cancelled → NEW.status = cancelled の瞬間）。
--   ・cancelled から別 status へ戻しても消さない。再キャンセルで最新時刻に上書きされる（confirmed_at と同じ思想）。
--   ・NULL = 旧データ・Excel取込（キャンセル時刻が不明）。分析では従来ルール（下見日時の有無）で推定する。
--
-- 【データには触れない】
--   ・既存行への UPDATE / backfill は一切ない（過去の cancelled 案件の cancelled_at は NULL のまま）。
--   ・updated_at などから時刻を推測して埋めない。
--   ・index は追加しない（約500件規模・status の既存 index で足りる）。
--   ・ADD COLUMN（default なしの NULL 可）は、テーブルの書き換えを伴わないメタデータのみの変更で、
--     ACCESS EXCLUSIVE ロックは一瞬だけ。
--   ・RLS・ポリシー・GRANT は変更しない（cases の既存ポリシーがそのまま適用される。列単位の GRANT は無い）。
--
-- 【rollback】
--   ALTER TABLE public.cases DROP COLUMN IF EXISTS cancelled_at;
--   ※ 列と、その時点までに打刻された値が失われる。先に 20261005_cases_status_change_trigger.sql を
--     rollback（トリガーと関数の削除）してから実行すること（トリガーがこの列を参照しているため）。
-- ============================================================

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

COMMENT ON COLUMN public.cases.cancelled_at IS
  '最後に cancelled へ新規突入した正確な時刻（timestamptz の瞬間）。DB トリガーのみが打刻する。NULL = 旧データ・Excel取込（時刻不明）。cancelled から離れても消えない。';
