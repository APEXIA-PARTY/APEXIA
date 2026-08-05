-- ============================================================
-- 99_speed_test_dummy_cases.sql
-- 保存後速度改善の実機テスト専用・架空データのみのシード
--
-- 【重要】
-- ・実在の個人・会社・電話番号・メールアドレスは一切含みません
-- ・本番環境や顧客データベースには絶対に実行しないでください
-- ・本番と完全に分離されたテスト専用Supabaseプロジェクトの
--   SQL Editorでのみ実行してください
-- ・INSERT のみ。CREATE / ALTER / DROP / RLS変更は含みません
-- ・マスタテーブル（floor_master 等）への依存を避けるため、
--   FK列（media_id / floor_id / contact_method_id 等）は
--   すべて NULL のままにしています
-- ============================================================

-- テストケース1: 更新テスト用（テストA・C・D・Gで使用）
INSERT INTO cases (
  company, contact, phone, email,
  inquiry_date, event_date, event_name, guest_count, notes,
  status
) VALUES (
  'テスト株式会社Alpha', 'テスト 花子', '000-0000-0001', 'speed-test-alpha@example.test',
  CURRENT_DATE, CURRENT_DATE + INTERVAL '30 day', '速度検証用ダミーイベントA', 10, 'これは架空のテストデータです（保存後速度改善の検証専用）',
  'tentative'
);

-- テストケース2: 新規作成テストの雛形確認用（テストBの比較対象として使用、実際の新規作成は画面操作で行う）
INSERT INTO cases (
  company, contact, phone, email,
  inquiry_date, event_date, event_name, guest_count, notes,
  status
) VALUES (
  'テスト株式会社Beta', 'テスト 次郎', '000-0000-0002', 'speed-test-beta@example.test',
  CURRENT_DATE, CURRENT_DATE + INTERVAL '45 day', '速度検証用ダミーイベントB', 25, 'これは架空のテストデータです（保存後速度改善の検証専用）',
  'confirmed'
);

-- テストケース3: 予備（複数回の連続保存テストで使い分ける用）
INSERT INTO cases (
  company, contact, phone, email,
  inquiry_date, event_date, event_name, guest_count, notes,
  status
) VALUES (
  'テスト株式会社Gamma', 'テスト 三郎', '000-0000-0003', 'speed-test-gamma@example.test',
  CURRENT_DATE, CURRENT_DATE + INTERVAL '60 day', '速度検証用ダミーイベントC', 5, 'これは架空のテストデータです（保存後速度改善の検証専用）',
  'inquiry'
);

-- 確認クエリ（実行後、3件のテストケースが登録されていることを確認）
SELECT id, company, contact, event_name, status, created_at
FROM cases
WHERE company LIKE 'テスト株式会社%'
ORDER BY created_at DESC;
