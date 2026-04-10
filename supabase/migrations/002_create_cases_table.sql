-- ============================================================
-- 002_create_cases_table.sql
-- 案件メインテーブル
-- ============================================================

CREATE TABLE cases (
  -- PK
  id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ─── 基本情報 ────────────────────────────────────────────
  company         TEXT NOT NULL,
  contact         TEXT,
  phone           TEXT,
  email           TEXT,
  inquiry_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  event_date      DATE,
  event_name      TEXT,
  guest_count     INT,
  notes           TEXT,
  estimate_amount BIGINT NOT NULL DEFAULT 0,

  -- ─── マスタFK ────────────────────────────────────────────
  media_id               UUID REFERENCES media_master(id)             ON DELETE SET NULL,
  contact_method_id      UUID REFERENCES contact_method_master(id)    ON DELETE SET NULL,
  floor_id               UUID REFERENCES floor_master(id)             ON DELETE SET NULL,
  event_category_id      UUID REFERENCES event_category_master(id)    ON DELETE SET NULL,
  event_subcategory_id   UUID REFERENCES event_subcategory_master(id) ON DELETE SET NULL,
  event_subcategory_note TEXT,

  -- ─── タイムスケジュール ───────────────────────────────────
  load_in_time    TIME,   -- 入り
  setup_time      TIME,   -- 搬入 / 準備
  rehearsal_time  TIME,   -- リハ
  start_time      TIME,   -- 開始
  end_time        TIME,   -- 終了
  strike_time     TIME,   -- 片付け / 撤収
  full_exit_time  TIME,   -- 完全撤収

  -- ─── 確認手続き ───────────────────────────────────────────
  preview_datetime        TIMESTAMPTZ,
  application_form_status TEXT NOT NULL DEFAULT '未対応'
                          CHECK (application_form_status IN ('未対応', '済み')),
  delivery_notice_status  TEXT NOT NULL DEFAULT '未対応'
                          CHECK (delivery_notice_status IN ('未対応', '済み')),
  invoice_status          TEXT NOT NULL DEFAULT '未対応'
                          CHECK (invoice_status IN ('未対応', '発行依頼', '送付済み', '振り込み済み')),
  payment_method          TEXT
                          CHECK (payment_method IN ('キャッシュレス', '現金', '現金+キャッシュレス')),

  -- ─── ステータス・キャンセル ───────────────────────────────
  status           TEXT NOT NULL DEFAULT 'inquiry'
                   CHECK (status IN (
                     'inquiry',      -- 新規問合せ
                     'preview_adj',  -- 下見調整中
                     'previewed',    -- 下見済み
                     'tentative',    -- 仮押さえ
                     'confirmed',    -- 確定
                     'cancelled',    -- キャンセル（手動・自動共通）
                     'done'          -- 開催終了
                   )),
  auto_cancel      BOOLEAN NOT NULL DEFAULT false,
  cancel_reason_id UUID REFERENCES cancel_reason_master(id) ON DELETE SET NULL,
  cancel_note      TEXT,

  -- ─── Googleカレンダー連携 ─────────────────────────────────
  gcal_event_id TEXT,

  -- ─── システム管理 ─────────────────────────────────────────
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_cases_status        ON cases(status);
CREATE INDEX idx_cases_inquiry_date  ON cases(inquiry_date);
CREATE INDEX idx_cases_event_date    ON cases(event_date);
CREATE INDEX idx_cases_media_id      ON cases(media_id);
CREATE INDEX idx_cases_floor_id      ON cases(floor_id);
CREATE INDEX idx_cases_created_by    ON cases(created_by);
CREATE INDEX idx_cases_auto_cancel   ON cases(auto_cancel) WHERE auto_cancel = true;

CREATE TRIGGER trg_cases_updated_at
  BEFORE UPDATE ON cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
