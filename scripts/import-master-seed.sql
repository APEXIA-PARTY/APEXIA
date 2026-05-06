-- ============================================================
-- scripts/import-master-seed.sql
-- INSERT ONLY -- CREATE / ALTER / RLS / policy 禁止
-- 冪等: lower(trim(name)) が既存と一致する場合は WHERE NOT EXISTS でスキップ
-- 対象: media_master / contact_method_master / cancel_reason_master
-- ============================================================

-- ─── media_master (5件) ───────────────────────────────────────

INSERT INTO media_master (name, display_order, is_active, created_at, updated_at)
SELECT 'WEBで要件入力', (SELECT COALESCE(MAX(display_order), 0) + 1 FROM media_master), true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM media_master WHERE lower(trim(name)) = 'webで要件入力');

INSERT INTO media_master (name, display_order, is_active, created_at, updated_at)
SELECT 'ぐるなび（HP記載あり）', (SELECT COALESCE(MAX(display_order), 0) + 1 FROM media_master), true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM media_master WHERE lower(trim(name)) = 'ぐるなび（hp記載あり）');

INSERT INTO media_master (name, display_order, is_active, created_at, updated_at)
SELECT 'instagramのDM', (SELECT COALESCE(MAX(display_order), 0) + 1 FROM media_master), true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM media_master WHERE lower(trim(name)) = 'instagramのdm');

INSERT INTO media_master (name, display_order, is_active, created_at, updated_at)
SELECT 'どの媒体か不明', (SELECT COALESCE(MAX(display_order), 0) + 1 FROM media_master), true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM media_master WHERE lower(trim(name)) = 'どの媒体か不明');

INSERT INTO media_master (name, display_order, is_active, created_at, updated_at)
SELECT 'instagram DM営業', (SELECT COALESCE(MAX(display_order), 0) + 1 FROM media_master), true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM media_master WHERE lower(trim(name)) = 'instagram dm営業');

-- ─── contact_method_master (2件) ──────────────────────────────
-- 注: seed の 'mail' と Excel の 'メール' は別文字列のため別エントリとして追加

INSERT INTO contact_method_master (name, display_order, is_active, created_at, updated_at)
SELECT '媒体チャット', (SELECT COALESCE(MAX(display_order), 0) + 1 FROM contact_method_master), true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM contact_method_master WHERE lower(trim(name)) = '媒体チャット');

INSERT INTO contact_method_master (name, display_order, is_active, created_at, updated_at)
SELECT 'メール', (SELECT COALESCE(MAX(display_order), 0) + 1 FROM contact_method_master), true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM contact_method_master WHERE lower(trim(name)) = 'メール');

-- ─── cancel_reason_master (5件) ───────────────────────────────

INSERT INTO cancel_reason_master (name, is_auto_cancel, display_order, is_active, created_at, updated_at)
SELECT '時間', false, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM cancel_reason_master), true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM cancel_reason_master WHERE lower(trim(name)) = '時間');

INSERT INTO cancel_reason_master (name, is_auto_cancel, display_order, is_active, created_at, updated_at)
SELECT '先方都合', false, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM cancel_reason_master), true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM cancel_reason_master WHERE lower(trim(name)) = '先方都合');

INSERT INTO cancel_reason_master (name, is_auto_cancel, display_order, is_active, created_at, updated_at)
SELECT '他店舗で開催', false, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM cancel_reason_master), true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM cancel_reason_master WHERE lower(trim(name)) = '他店舗で開催');

INSERT INTO cancel_reason_master (name, is_auto_cancel, display_order, is_active, created_at, updated_at)
SELECT '空いてなかった', false, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM cancel_reason_master), true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM cancel_reason_master WHERE lower(trim(name)) = '空いてなかった');

INSERT INTO cancel_reason_master (name, is_auto_cancel, display_order, is_active, created_at, updated_at)
SELECT '内容により、お断り', false, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM cancel_reason_master), true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM cancel_reason_master WHERE lower(trim(name)) = '内容により、お断り');
