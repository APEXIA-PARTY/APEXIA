-- 既存データの変更・削除は一切行わない安全な変更のみのマイグレーション
-- 確認事項（case_checklist）の state に「キャンセル」を追加できるようにする
-- ・既存の CHECK 制約を一度外し、選択肢を追加した制約を付け直す
-- ・既存行の値（'確認中' / '確定'）はどちらも新しい制約でも引き続き許可されるため、
--   既存データは一切変更されない
ALTER TABLE case_checklist DROP CONSTRAINT IF EXISTS case_checklist_state_check;

ALTER TABLE case_checklist ADD CONSTRAINT case_checklist_state_check
  CHECK (state IN ('確認中', '確定', 'キャンセル'));
