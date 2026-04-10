-- ============================================================
-- 003_create_case_related_tables.sql
-- 案件関連テーブル一式
-- ============================================================

-- ─── 案件オプション明細（備品・機材）─────────────────────────
CREATE TABLE case_options (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  option_id        UUID REFERENCES option_master(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL CHECK (category IN ('equipment', 'machine')),
  machine_category TEXT CHECK (machine_category IN ('音響', '照明', '映像')),
  qty              INT    NOT NULL DEFAULT 1,
  unit_price       BIGINT NOT NULL DEFAULT 0,
  -- qty × unit_price を自動計算（変更しても既存案件に影響しない）
  amount           BIGINT GENERATED ALWAYS AS (qty * unit_price) STORED,
  unit             TEXT NOT NULL DEFAULT '式',
  state            TEXT NOT NULL DEFAULT '未確認'
                   CHECK (state IN ('未確認', '質問中', '検討中', '確定', '不要')),
  note             TEXT,
  sort_order       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_case_options_case_id ON case_options(case_id);
CREATE TRIGGER trg_case_options_updated_at
  BEFORE UPDATE ON case_options
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── 確認事項 ─────────────────────────────────────────────────
CREATE TABLE case_checklist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  item       TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT '確認中'
             CHECK (state IN ('確認中', '確定')),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_case_checklist_case_id ON case_checklist(case_id);
CREATE TRIGGER trg_case_checklist_updated_at
  BEFORE UPDATE ON case_checklist
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── 添付ファイル（レイアウト図を file_type で統一管理）────────
CREATE TABLE case_files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  file_type    TEXT NOT NULL DEFAULT 'その他'
               CHECK (file_type IN ('見積書', '請求書', '進行表', 'レイアウト図', 'その他')),
  file_name    TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type    TEXT,
  file_size    BIGINT,
  -- レイアウト図の場合のラベル（例: "7F用", "8F用"）
  label        TEXT,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_case_files_case_id  ON case_files(case_id);
CREATE INDEX idx_case_files_type     ON case_files(file_type);
CREATE TRIGGER trg_case_files_updated_at
  BEFORE UPDATE ON case_files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── 仮押さえログ（1案件1レコード制約）───────────────────────
-- UNIQUE(case_id) で1:1を強制
-- 将来的に履歴対応が必要になった場合は UNIQUE を外し is_current カラムを追加する
CREATE TABLE case_hold_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  hold_date    DATE,
  release_date DATE,
  memo         TEXT,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_case_hold_logs_case_id UNIQUE (case_id)
);
CREATE TRIGGER trg_case_hold_logs_updated_at
  BEFORE UPDATE ON case_hold_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── 案件履歴・操作ログ ───────────────────────────────────────
CREATE TABLE case_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'create',
    'update',
    'status_change',
    'auto_cancel',
    'file_upload',
    'gcal_sync'
  )),
  message     TEXT NOT NULL,
  old_value   JSONB,
  new_value   JSONB,
  changed_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- 履歴は更新しないため updated_at なし
);
CREATE INDEX idx_case_history_case_id    ON case_history(case_id);
CREATE INDEX idx_case_history_created_at ON case_history(created_at DESC);
