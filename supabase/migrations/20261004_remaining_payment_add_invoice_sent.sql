-- ============================================================
-- 20261004_remaining_payment_add_invoice_sent.sql
-- 確認手続き「残額支払い」に「請求書送付済み」を追加する
--
-- 【適用状況】未適用です。
--   このファイルは作成・検証のみで、本番DB（Alexia）にも検証用DB（APEXIA-test）にも
--   適用していません。適用は、内容を確認した人間の承認後に行うこと。
--
-- 【背景】
--   最終仕様:
--     申込みフォーム  application_form_status    : 未対応 / 済み                 （変更しない）
--     申込み金        deposit_status             : 未対応 / 請求書送付済み / 済み （変更しない）
--     残額支払い      remaining_payment_status   : 未対応 / 請求書送付済み / 済み （この migration で追加）
--   cases.remaining_payment_status の CHECK 制約は ('未対応', '済み') のみを許可している。
--   アプリ側（型・Zod・選択肢・画面）は 3 値に対応済みだが、この migration を適用するまで
--   「請求書送付済み」の保存は DB の CHECK 制約で失敗する（既存の 未対応 / 済み は従来どおり動作する）。
--   保存値は表示ラベルと同じ文字列（他の確認手続き項目と同じ設計）。
--
-- 【内容】
--   1. 安全チェック: remaining_payment_status が 未対応 / 済み 以外の行が1件でもあれば、
--      何も変更せずに中断する（想定外の値が入っている場合は人間が内容を確認する）。
--   2. cases_remaining_payment_status_check を 未対応 / 請求書送付済み / 済み の3値で作り直す。
--   変更対象は remaining_payment_status の CHECK 制約だけ。制約名は固定で指定し、動的検索はしない
--   （無関係な CHECK を巻き込んで削除しないため）。名前が存在しない場合は DROP が失敗し、
--   トランザクション全体がロールバックされる。
--
-- 【データには触れない】
--   この migration に INSERT / UPDATE / DELETE は一切ない。既存行は変更されない。
--   既存値（未対応 / 済み）は新しい CHECK でも引き続き許可される。
--
-- 【適用前に確認すること（読み取りのみ）】
--   SELECT remaining_payment_status, count(*) FROM cases GROUP BY 1;   -- 未対応 / 済み のみであること
--
-- 【ロック・影響】
--   cases に対する ALTER TABLE は短時間 ACCESS EXCLUSIVE ロックを取る（行数は数百行規模）。
--
-- 【ロールバック】
--   remaining_payment_status に「請求書送付済み」の行がまだ無い場合に限り、次で元に戻せる:
--     BEGIN;
--     ALTER TABLE cases DROP CONSTRAINT cases_remaining_payment_status_check;
--     ALTER TABLE cases ADD CONSTRAINT cases_remaining_payment_status_check
--       CHECK (remaining_payment_status IN ('未対応', '済み'));
--     COMMIT;
--   「請求書送付済み」の行がある状態で戻そうとすると、制約追加が失敗する
--   （先にそれらの行の値を人間が判断して変更する必要がある）。
-- ============================================================

BEGIN;

-- ─── 1. 安全チェック（該当があれば中断。データは変更しない） ───
DO $$
DECLARE
  bad_remaining INTEGER;
BEGIN
  SELECT count(*) INTO bad_remaining
  FROM cases
  WHERE remaining_payment_status IS NULL
     OR remaining_payment_status NOT IN ('未対応', '済み');

  IF bad_remaining > 0 THEN
    RAISE EXCEPTION
      '中断: remaining_payment_status が 未対応/済み 以外の行が % 件あります。内容を確認してから再実行してください。何も変更していません。',
      bad_remaining;
  END IF;
END
$$;

-- ─── 2. 残額支払い: 3値にする ───────────────────────────────
ALTER TABLE cases DROP CONSTRAINT cases_remaining_payment_status_check;

ALTER TABLE cases
  ADD CONSTRAINT cases_remaining_payment_status_check
  CHECK (remaining_payment_status IN ('未対応', '請求書送付済み', '済み'));

COMMIT;
