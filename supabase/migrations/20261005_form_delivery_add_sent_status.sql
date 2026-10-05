-- ============================================================
-- 20261005_form_delivery_add_sent_status.sql
-- 確認手続き「申込みフォーム」「搬入出届」に「送付済み」を追加する（CHECK 制約の拡張のみ）
--
-- 【適用状況】未適用です。
--   このファイルは作成・ローカル検証のみで、本番DB（Alexia）にも検証用DB（APEXIA-test）にも
--   適用していません。適用は、内容を確認した人間の承認後に行うこと。
--
-- 【適用順】この migration を先に適用 → その後にアプリ（「送付済み」を選べる画面）をデプロイする。
--   PUT /api/cases/[id] には Zod 検証がなく、サーバー側の唯一の防御が DB の CHECK 制約のため、
--   画面を先にデプロイすると「送付済み」の保存が CHECK 違反（500）になる。
--   逆に migration を先に適用しても、旧アプリは従来の 未対応 / 済み だけを送るので影響しない。
--
-- 【背景】
--   最終仕様:
--     申込みフォーム  application_form_status : 未対応 / 送付済み / 済み   （この migration で拡張）
--     搬入出届        delivery_notice_status  : 未対応 / 送付済み / 済み   （この migration で拡張）
--   どちらも現在は CHECK (… IN ('未対応', '済み')) の 2 値。保存値は表示ラベルと同じ文字列。
--   状態遷移（未対応 → 送付済み → 済み）の強制はしない。3 値のどれにでも変更できる。
--
-- 【内容】
--   1. 安全チェック: 2 列のどちらかに 未対応 / 送付済み / 済み 以外の値（NULL 含む）が 1 件でもあれば、
--      何も変更せずに中断する（想定外の値は人間が確認する）。新しい 3 値は許可するので、再実行しても成功する。
--   2. cases_application_form_status_check と cases_delivery_notice_status_check を、
--      未対応 / 送付済み / 済み の 3 値で作り直す（BEGIN〜COMMIT の 1 トランザクション）。
--   制約名は固定で指定し、動的検索はしない（無関係な CHECK を巻き込んで削除しないため）。
--   名前が存在しない場合は DROP が失敗し、トランザクション全体がロールバックされる。
--
-- 【データには触れない】
--   ・この migration に INSERT / UPDATE / DELETE / backfill は一切ない。既存行は変更されない（updated_at も動かない）。
--   ・既存値（未対応 / 済み）は新しい CHECK でもそのまま許可される。
--   ・カラム型・default・NOT NULL・他カラム（invoice_status を含む）・トリガー・関数・RLS・ポリシーは変更しない。
--   ・CHECK の追加時に全行が検査される（約 540 行規模。ロックは一瞬）。
--
-- 【rollback】
--   「送付済み」を使っている行が 0 件の場合に限り、旧 2 値の CHECK に戻せる:
--     BEGIN;
--     ALTER TABLE cases DROP CONSTRAINT cases_application_form_status_check;
--     ALTER TABLE cases ADD  CONSTRAINT cases_application_form_status_check
--       CHECK (application_form_status IN ('未対応', '済み'));
--     ALTER TABLE cases DROP CONSTRAINT cases_delivery_notice_status_check;
--     ALTER TABLE cases ADD  CONSTRAINT cases_delivery_notice_status_check
--       CHECK (delivery_notice_status IN ('未対応', '済み'));
--     COMMIT;
--   「送付済み」の行が 1 件でもあると ADD CONSTRAINT が失敗してロールバックされる。その場合は、
--   該当案件を人間が確認して別の値へ変更してから実行すること（この migration はデータを自動変換しない）。
-- ============================================================

BEGIN;

-- 安全チェック: 想定外の値（NULL 含む）があれば、何も変更せずに中断する
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cases
    WHERE application_form_status IS NULL OR application_form_status NOT IN ('未対応', '送付済み', '済み')
  ) THEN
    RAISE EXCEPTION 'application_form_status に 未対応/送付済み/済み 以外の値（NULL含む）があります。確認してください';
  END IF;
  IF EXISTS (
    SELECT 1 FROM cases
    WHERE delivery_notice_status IS NULL OR delivery_notice_status NOT IN ('未対応', '送付済み', '済み')
  ) THEN
    RAISE EXCEPTION 'delivery_notice_status に 未対応/送付済み/済み 以外の値（NULL含む）があります。確認してください';
  END IF;
END $$;

-- 申込みフォーム: 未対応 / 送付済み / 済み
ALTER TABLE cases DROP CONSTRAINT cases_application_form_status_check;
ALTER TABLE cases ADD  CONSTRAINT cases_application_form_status_check
  CHECK (application_form_status IN ('未対応', '送付済み', '済み'));

-- 搬入出届: 未対応 / 送付済み / 済み
ALTER TABLE cases DROP CONSTRAINT cases_delivery_notice_status_check;
ALTER TABLE cases ADD  CONSTRAINT cases_delivery_notice_status_check
  CHECK (delivery_notice_status IN ('未対応', '送付済み', '済み'));

COMMIT;
