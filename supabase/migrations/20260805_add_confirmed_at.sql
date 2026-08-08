-- 既存カラムの変更・削除は一切行わない安全なADDのみのマイグレーション
-- 案件が収益ステータス（confirmed / done）へ新規に突入した日時を記録する列
-- ・アプリ側（app/api/cases/route.ts の POST、app/api/cases/[id]/route.ts の PUT）で
--   ステータス遷移を検知したときにのみセットする（このマイグレーション自体は列追加のみ）
-- ・過去に確定済みの案件はこの列追加時点では NULL のまま（遡及不可）
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ DEFAULT NULL;
