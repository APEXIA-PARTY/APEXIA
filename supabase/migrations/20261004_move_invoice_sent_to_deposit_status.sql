-- ============================================================
-- 20261004_move_invoice_sent_to_deposit_status.sql
-- 「請求書送付済み」の追加先を訂正する（申込みフォーム → 申込み金）
--
-- 【適用状況】未適用です。
--   このファイルは作成・検証のみで、本番DB（Alexia）にも検証用DB（APEXIA-test）にも
--   適用していません。適用は、内容を確認した人間の承認後に行うこと。
--
-- 【背景】
--   20261004_add_application_form_invoice_sent.sql は、「請求書送付済み」を
--   cases.application_form_status（申込みフォーム）に追加してしまった（本番適用済み）。
--   正しい仕様は次のとおり:
--     申込みフォーム  application_form_status : 未対応 / 済み                （元の2値）
--     申込み金        deposit_status          : 未対応 / 請求書送付済み / 済み （3値）
--   適用済みの上記 migration は履歴として残すため、編集・削除しない。
--   この migration はその訂正を行う。
--
-- 【内容】
--   1. 安全チェック（1つでも該当すれば、何も変更せずに中断）
--      a) application_form_status が 未対応 / 済み 以外の行がある
--         （＝「請求書送付済み」が誤って使われている行が残っている）
--      b) deposit_status が 未対応 / 済み 以外の行がある
--   2. cases_application_form_status_check を 未対応 / 済み の2値で作り直す
--   3. cases_deposit_status_check を 未対応 / 請求書送付済み / 済み の3値で作り直す
--   制約名は固定で指定し、動的検索はしない（無関係な CHECK を巻き込んで削除しないため）。
--   名前が存在しない場合は DROP が失敗し、トランザクション全体がロールバックされる。
--
-- 【データには触れない】
--   この migration に INSERT / UPDATE / DELETE は一切ない。
--   誤って「請求書送付済み」になっている application_form_status の行を自動で直すことは、
--   意図的にしない。そのような行が1件でもあると、安全チェック 1-a) で中断する。
--   それらの行は、人間が元の値を確認したうえで別途直してから、この migration を適用すること。
--
-- 【適用前に確認すること（読み取りのみ）】
--   SELECT application_form_status, count(*) FROM cases GROUP BY 1;   -- 請求書送付済み が 0 件であること
--   SELECT deposit_status, count(*) FROM cases GROUP BY 1;            -- 未対応 / 済み のみであること
--
-- 【ロック・影響】
--   cases に対する ALTER TABLE は短時間 ACCESS EXCLUSIVE ロックを取る（行数は数百行規模）。
--   既存行は変更されない。
--
-- 【ロールバック】
--   deposit_status に「請求書送付済み」の行がまだ無い場合に限り、次で元に戻せる:
--     BEGIN;
--     ALTER TABLE cases DROP CONSTRAINT cases_deposit_status_check;
--     ALTER TABLE cases ADD CONSTRAINT cases_deposit_status_check
--       CHECK (deposit_status IN ('未対応', '済み'));
--     ALTER TABLE cases DROP CONSTRAINT cases_application_form_status_check;
--     ALTER TABLE cases ADD CONSTRAINT cases_application_form_status_check
--       CHECK (application_form_status IN ('未対応', '請求書送付済み', '済み'));
--     COMMIT;
--   deposit_status に「請求書送付済み」の行がある状態で戻そうとすると、制約追加が失敗する。
-- ============================================================

BEGIN;

-- ─── 1. 安全チェック（該当があれば中断。データは変更しない） ───
DO $$
DECLARE
  bad_app_form INTEGER;
  bad_deposit  INTEGER;
BEGIN
  SELECT count(*) INTO bad_app_form
  FROM cases
  WHERE application_form_status IS NULL
     OR application_form_status NOT IN ('未対応', '済み');

  IF bad_app_form > 0 THEN
    RAISE EXCEPTION
      '中断: application_form_status が 未対応/済み 以外の行が % 件あります（請求書送付済み が誤って使われている可能性）。データを確認・修正してから再実行してください。何も変更していません。',
      bad_app_form;
  END IF;

  SELECT count(*) INTO bad_deposit
  FROM cases
  WHERE deposit_status IS NULL
     OR deposit_status NOT IN ('未対応', '済み');

  IF bad_deposit > 0 THEN
    RAISE EXCEPTION
      '中断: deposit_status が 未対応/済み 以外の行が % 件あります。内容を確認してから再実行してください。何も変更していません。',
      bad_deposit;
  END IF;
END
$$;

-- ─── 2. 申込みフォーム: 元の2値に戻す ───────────────────────
ALTER TABLE cases DROP CONSTRAINT cases_application_form_status_check;

ALTER TABLE cases
  ADD CONSTRAINT cases_application_form_status_check
  CHECK (application_form_status IN ('未対応', '済み'));

-- ─── 3. 申込み金: 3値にする ─────────────────────────────────
ALTER TABLE cases DROP CONSTRAINT cases_deposit_status_check;

ALTER TABLE cases
  ADD CONSTRAINT cases_deposit_status_check
  CHECK (deposit_status IN ('未対応', '請求書送付済み', '済み'));

COMMIT;
