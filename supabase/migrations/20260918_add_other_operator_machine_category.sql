-- ============================================================
-- 20260918_add_other_operator_machine_category.sql
-- 「その他オペ」を machine_category の第4区分として追加する
--
-- 【適用状況】2026-09-21 に本番DBへ手動適用済みです。
--   このファイルは、本番で実施したスキーマ変更の履歴として
--   リポジトリに保存しているものです。
--   本番への再実行を目的としたmigrationではありません。
--   また、冪等（何度実行しても同じ結果になる）なmigrationとしては
--   扱わないでください。再実行しないこと。
--
-- 【内容】option_master_machine_category_check と
--   case_options_machine_category_check の2つのCHECK制約に、
--   machine_category の許可値として 'その他オペ' を追加します
--   （音響 / 照明 / 映像 / その他オペ の4値）。
--   制約名は本番DBの読み取り専用確認で判明した名前を固定で指定しており、
--   動的検索は行いません。
--
-- 【変更対象】この2制約のみです。option_master の chk_machine_category
--   （category='machine' の場合に machine_category が必須、という別の制約）
--   は変更・削除しません。
--
-- 【既存データへの影響】
--   既存レコードの INSERT / UPDATE / DELETE は行いません。
--   CHECK制約が許容する値のリストに 'その他オペ' を追加するのみで、
--   既存の 'case_options' / 'option_master' の行は変更されません。
--   （この migration では「その他オペ」のマスタ行も投入しません。）
-- ============================================================

BEGIN;

-- ─── option_master.machine_category のCHECK制約を拡張 ─────────
ALTER TABLE option_master
  DROP CONSTRAINT option_master_machine_category_check;

ALTER TABLE option_master
  ADD CONSTRAINT option_master_machine_category_check
  CHECK (machine_category IN ('音響', '照明', '映像', 'その他オペ'));

-- ─── case_options.machine_category のCHECK制約を拡張 ───────────
ALTER TABLE case_options
  DROP CONSTRAINT case_options_machine_category_check;

ALTER TABLE case_options
  ADD CONSTRAINT case_options_machine_category_check
  CHECK (machine_category IN ('音響', '照明', '映像', 'その他オペ'));

COMMIT;
