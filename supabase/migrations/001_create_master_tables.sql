-- ============================================================
-- 001_create_master_tables.sql
-- マスタテーブル一式
-- ============================================================

-- updated_at 自動更新トリガー関数（共通）
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── 認知経路マスタ ────────────────────────────────────────────
CREATE TABLE media_master (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  monthly_cost  BIGINT,
  note          TEXT,
  display_order INT     NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_media_master_updated_at
  BEFORE UPDATE ON media_master
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── 連絡方法マスタ ────────────────────────────────────────────
CREATE TABLE contact_method_master (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  display_order INT     NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_contact_method_master_updated_at
  BEFORE UPDATE ON contact_method_master
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── イベント大分類マスタ ──────────────────────────────────────
CREATE TABLE event_category_master (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  display_order INT     NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_event_category_master_updated_at
  BEFORE UPDATE ON event_category_master
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── イベント中分類マスタ ──────────────────────────────────────
CREATE TABLE event_subcategory_master (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   UUID NOT NULL REFERENCES event_category_master(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  display_order INT     NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_event_subcategory_category_id ON event_subcategory_master(category_id);
CREATE TRIGGER trg_event_subcategory_master_updated_at
  BEFORE UPDATE ON event_subcategory_master
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── フロアマスタ ──────────────────────────────────────────────
CREATE TABLE floor_master (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  display_order INT     NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_floor_master_updated_at
  BEFORE UPDATE ON floor_master
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── キャンセル理由マスタ ──────────────────────────────────────
CREATE TABLE cancel_reason_master (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  is_auto_cancel BOOLEAN NOT NULL DEFAULT false,
  display_order  INT     NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_cancel_reason_master_updated_at
  BEFORE UPDATE ON cancel_reason_master
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── オプションマスタ（備品・機材共通）────────────────────────
CREATE TABLE option_master (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  category         TEXT NOT NULL CHECK (category IN ('equipment', 'machine')),
  machine_category TEXT         CHECK (machine_category IN ('音響', '照明', '映像')),
  default_price    BIGINT  NOT NULL DEFAULT 0,
  unit             TEXT    NOT NULL DEFAULT '式',
  display_order    INT     NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 機材の場合は machine_category 必須
  CONSTRAINT chk_machine_category
    CHECK (category != 'machine' OR machine_category IS NOT NULL)
);
CREATE TRIGGER trg_option_master_updated_at
  BEFORE UPDATE ON option_master
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
