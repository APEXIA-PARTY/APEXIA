-- =============================================================================
-- APEXIA Import System Migration
-- 作成日: 2026-04-29
-- 目的: Excelインポート機能のための専用テーブル群
--
-- 【重要：既存テーブルへの影響】
--   このSQLは cases / media_master / floor_master 等、
--   既存テーブルを一切変更しません。
--   新規テーブルの追加のみです。
--
-- 【RLS設計方針】
--   インポートデータには会社名・担当者・電話・メール・金額が含まれるため、
--   「認証済みなら全員見られる」設計は採用しない。
--   全テーブルで created_by = auth.uid() を基本とし、
--   自分が作成したインポートデータのみアクセス可能にする。
--   apply / rollback の admin 権限チェックは API 側（requireAdmin）で実施する。
--
-- 【実行手順】
--   1. Supabase ダッシュボード → SQL Editor を開く
--   2. このファイルの内容を全て貼り付ける
--   3. 「Run」を押して実行する
--   4. 「Success」が表示されれば完了
--   5. 末尾の「動作確認クエリ」で4テーブルの作成を確認する
--
-- 【ロールバック手順（テーブルを削除したい場合）】
--   ファイル末尾の ROLLBACK SECTION を実行してください
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. cases_import_session
--    アップロード直後の一時保存テーブル
--    リロードしても消えない。expires_at で自動失効管理。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cases_import_session (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ファイル情報
  filename        text        NOT NULL,
  file_size_bytes bigint,

  -- シート情報
  available_sheets  jsonb     NOT NULL DEFAULT '[]',
  -- 例: ["01月問合せ", "01月予約", "02月問合せ", ...]

  suggested_sheets  jsonb     NOT NULL DEFAULT '[]',
  -- 自動提案シート名（"問合せ" "1月" "01月" を含むもの）

  selected_sheet    text,
  -- 管理者が選択したシート名

  -- 解析結果（シート選択・解析後に格納）
  parsed_rows       jsonb,
  -- 解析済み行データ。staging保存前の仮保持。

  total_rows        integer,
  error_rows        jsonb     NOT NULL DEFAULT '[]',
  -- 解析エラー行: [{row: 2, reason: "..."}]

  -- セッション状態
  -- 'uploaded' : ファイルアップロード済み、シート未選択
  -- 'parsed'   : シート選択・解析済み、staging未保存
  -- 'staged'   : staging保存済み
  status          text        NOT NULL DEFAULT 'uploaded'
                  CHECK (status IN ('uploaded', 'parsed', 'staged')),

  -- 【RLS用】作成者（ログインユーザー）
  created_by      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  cases_import_session IS
  'Excelアップロード後の一時保存。casesテーブルは一切変更しない。expires_atで自動失効。';
COMMENT ON COLUMN cases_import_session.created_by IS
  'RLS用。自分のセッションのみ参照・操作可能にするためのユーザーID。';
COMMENT ON COLUMN cases_import_session.available_sheets IS
  'アップロードされたExcelの全シート名一覧（JSON配列）';
COMMENT ON COLUMN cases_import_session.suggested_sheets IS
  '「問合せ」「1月」「01月」等を含む自動提案シート名一覧';
COMMENT ON COLUMN cases_import_session.parsed_rows IS
  'シート解析後の行データ。staging保存前の仮保持用。';
COMMENT ON COLUMN cases_import_session.error_rows IS
  '解析エラーが発生した行の情報: [{row: 番号, reason: 理由}]';


-- -----------------------------------------------------------------------------
-- 2. cases_import_batch
--    staging保存確定後のバッチ管理テーブル
--    1回のstagingインポート = 1バッチ
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cases_import_batch (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- セッション参照
  session_id      uuid        REFERENCES cases_import_session(id) ON DELETE SET NULL,

  -- ファイル・シート情報
  filename        text        NOT NULL,
  sheet_name      text        NOT NULL,

  -- 件数サマリー
  total_rows      integer     NOT NULL DEFAULT 0,
  new_count       integer     NOT NULL DEFAULT 0,
  duplicate_count integer     NOT NULL DEFAULT 0,
  review_count    integer     NOT NULL DEFAULT 0,
  skip_count      integer     NOT NULL DEFAULT 0,

  -- バージョン管理
  import_version  text        NOT NULL DEFAULT '1.0.0',
  parser_version  text        NOT NULL DEFAULT '1.0.0',

  -- 反映状態
  applied         boolean     NOT NULL DEFAULT false,
  applied_at      timestamptz,
  applied_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- ロールバック状態
  -- null          : 未反映
  -- 'completed'   : ロールバック完了
  -- 'partial'     : 一部手動確認が必要
  -- 'not_applied' : 反映前のためロールバック不要
  rollback_status text        CHECK (rollback_status IN (
    'completed', 'partial', 'not_applied'
  )),
  rollback_at     timestamptz,

  -- 【RLS用】作成者（ログインユーザー）
  created_by      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  cases_import_batch IS
  'staging保存ごとのバッチ管理。1バッチ = 1回のstagingインポート。';
COMMENT ON COLUMN cases_import_batch.created_by IS
  'RLS用。自分のバッチのみ参照・操作可能にするためのユーザーID。';
COMMENT ON COLUMN cases_import_batch.import_version IS
  'インポート機能のバージョン番号（機能変更時にインクリメント）';
COMMENT ON COLUMN cases_import_batch.parser_version IS
  'Excelパーサーのバージョン番号（列マッピング変更時にインクリメント）';
COMMENT ON COLUMN cases_import_batch.applied_by IS
  '本番反映を実行したユーザーのID';


-- -----------------------------------------------------------------------------
-- 3. cases_import_staging
--    Excelから読み込んだ行データの一時格納テーブル
--    casesテーブルへの反映前の「待機場所」
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cases_import_staging (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        uuid        NOT NULL REFERENCES cases_import_batch(id) ON DELETE CASCADE,
  row_number      integer     NOT NULL,

  -- ----------------------------------------
  -- Excel元データ（生の値をそのまま保持）
  -- ----------------------------------------
  raw_payload     jsonb       NOT NULL DEFAULT '{}',
  -- Excel元行を丸ごと保持。例:
  -- {
  --   "row": 2,
  --   "会社名・団体名": "Sherpa akihiro合同会社",
  --   "担当者名": "スバス様",
  --   "問い合わせ日": "2026-01-05",
  --   "開催日": "2026-05-03",
  --   "開始時(h)": 14, "開始分(m)": 0,
  --   "終了時(h)": 21, "終了分(m)": 0,
  --   "連絡方法": "小野寺",
  --   "認知経路": "リピート",
  --   "階数": "8F",
  --   "イベント内容": "音楽ライブ",
  --   "備考メモ": "楽器ありLIVE",
  --   "見込み金額(税込)": 577500
  -- }

  -- ----------------------------------------
  -- 解析済みフィールド
  -- ----------------------------------------

  company                 text,
  contact                 text,
  phone                   text,
  email                   text,
  inquiry_date            date,
  event_date              date,
  event_name              text,
  guest_count             integer,
  notes                   text,
  estimate_amount         numeric(12, 0),

  -- Excelの「開始時(h)」「開始分(m)」を結合
  start_time              time,
  end_time                time,

  preview_date            date,
  has_previewed           boolean  DEFAULT false,
  application_form_done   boolean  DEFAULT false,
  invoice_done            boolean  DEFAULT false,
  payment_cash            boolean  DEFAULT false,
  payment_prepaid         boolean  DEFAULT false,

  -- ----------------------------------------
  -- マスター照合前の生の値
  -- ----------------------------------------
  floor_raw               text,   -- 例: "8F", "7,8F"
  media_raw               text,   -- 例: "リピート"
  event_category_raw      text,   -- 例: "音楽ライブ"
  contact_method_raw      text,   -- 例: "公式LINE", "小野寺"
  cancel_reason_raw       text,   -- 例: "先方都合"
  status_raw              text,   -- チェック列から導出したステータス

  -- ----------------------------------------
  -- マスター照合後のID
  -- ----------------------------------------
  floor_id                uuid,
  media_id                uuid,
  event_category_id       uuid,
  contact_method_id       uuid,
  cancel_reason_id        uuid,

  -- ----------------------------------------
  -- 分類結果
  -- ----------------------------------------
  -- '新規追加'  : casesに存在しない案件
  -- '重複候補'  : 類似案件が存在
  -- '要確認'    : マスター不一致などの問題あり
  -- 'スキップ'  : 完全重複 or 管理者指定
  classification          text    NOT NULL DEFAULT '要確認'
                          CHECK (classification IN (
                            '新規追加', '重複候補', '要確認', 'スキップ'
                          )),

  matched_case_id         uuid,
  match_score             integer,
  -- 一致スコア（0〜100）。70以上を重複候補として扱う。

  review_notes            text,
  -- 要確認の理由（例: "認知経路「スペースマーケット」がマスターに未登録"）

  -- ----------------------------------------
  -- 管理者の判断
  -- ----------------------------------------
  -- null      : 未判断
  -- 'approve' : 承認（本番反映対象）
  -- 'skip'    : スキップ（反映しない）
  admin_decision          text    CHECK (admin_decision IN ('approve', 'skip')),

  -- ----------------------------------------
  -- 【RLS用】作成者
  -- batch経由でも直接でも、自分のデータのみ参照可能にする
  -- ----------------------------------------
  created_by              uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (batch_id, row_number)
);

COMMENT ON TABLE  cases_import_staging IS
  'Excelから読み込んだ行データの一時格納。casesへの反映前の待機場所。顧客情報を含むためRLS厳格管理。';
COMMENT ON COLUMN cases_import_staging.created_by IS
  'RLS用。自分のstagingデータのみ参照・操作可能にするためのユーザーID。';
COMMENT ON COLUMN cases_import_staging.raw_payload IS
  'Excel元行を丸ごとJSONで保持。復元・デバッグ・再解析に使用。';
COMMENT ON COLUMN cases_import_staging.floor_raw IS
  'Excelの「階数」列の生の値。マスター照合前。例: "8F", "7,8F"';
COMMENT ON COLUMN cases_import_staging.contact_method_raw IS
  'Excelの「連絡方法」列の生の値。スタッフ名が混在している場合があるため生値を保持。';
COMMENT ON COLUMN cases_import_staging.classification IS
  '既存casesとの照合結果。新規追加/重複候補/要確認/スキップ の4分類。';
COMMENT ON COLUMN cases_import_staging.match_score IS
  '既存案件との一致スコア（0〜100）。70以上を重複候補として扱う。';
COMMENT ON COLUMN cases_import_staging.admin_decision IS
  '管理者の判断。approve=本番反映対象、skip=反映しない、null=未判断。';


-- -----------------------------------------------------------------------------
-- 4. cases_import_log
--    本番反映の操作ログ＋ロールバック用snapshot
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cases_import_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        uuid        NOT NULL REFERENCES cases_import_batch(id) ON DELETE CASCADE,
  staging_id      uuid        REFERENCES cases_import_staging(id) ON DELETE SET NULL,

  -- 操作種別
  -- 'insert' : cases への新規INSERT
  -- 'update' : cases への既存UPDATE（今回のテストでは原則なし）
  action          text        NOT NULL CHECK (action IN ('insert', 'update')),

  -- 対象案件
  case_id         uuid        NOT NULL,

  -- 反映前のスナップショット（ロールバック用）
  -- INSERT の場合: null
  -- UPDATE の場合: 変更前の cases レコード全体を JSON 保存
  snapshot_before jsonb,

  -- ----------------------------------------
  -- スマートrollback用
  -- ----------------------------------------

  -- rollback状態
  -- null               : 未ロールバック
  -- 'completed'        : ロールバック完了
  -- 'manual_required'  : 反映後に手動更新あり → 自動削除せず要確認
  -- 'skipped'          : スキップ
  rollback_status         text    CHECK (rollback_status IN (
    'completed', 'manual_required', 'skipped'
  )),

  -- 反映後に手動更新があったか（rollback時に検知）
  post_import_updated     boolean NOT NULL DEFAULT false,

  -- rollback_status = 'manual_required' の場合の理由
  rollback_skipped_reason text,
  -- 例: "反映後（2026-04-30 14:32）に手動更新されています。削除前に内容を確認してください。"

  rollback_at     timestamptz,
  rollback_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  -- ----------------------------------------
  -- 【RLS用】元バッチ作成者
  -- apply実行者ではなく、元のbatch作成者を格納する。
  -- アップロード者と反映者が異なる場合でも、
  -- バッチ作成者が自分のログを参照できるようにするため。
  -- ----------------------------------------
  created_by      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 本番反映を実行したユーザー（created_by と異なる場合がある）
  applied_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now()
  -- ※ updated_at なし。ログは追記のみ。rollback_status等の更新はUPDATE許可。
);

COMMENT ON TABLE  cases_import_log IS
  '本番反映の操作ログ。snapshot_beforeを使ってrollback可能。顧客情報を含むためRLS厳格管理。';
COMMENT ON COLUMN cases_import_log.created_by IS
  '元バッチ作成者のUID / RLS用。アップロード者が自分のlogを参照できるよう、batch作成者を格納する。';
COMMENT ON COLUMN cases_import_log.applied_by IS
  '本番反映を実行したユーザーのUID。created_by（バッチ作成者）と異なる場合がある。';
COMMENT ON COLUMN cases_import_log.snapshot_before IS
  '反映前のcasesレコードをJSONで丸ごと保存。UPDATEのrollbackに使用。';
COMMENT ON COLUMN cases_import_log.post_import_updated IS
  'rollback実行時に、反映後に手動更新があったか検知した結果。';
COMMENT ON COLUMN cases_import_log.rollback_skipped_reason IS
  'rollbackをスキップした理由。手動更新検知の場合は更新日時を含む説明文を格納。';


-- =============================================================================
-- インデックス
-- =============================================================================

-- session
CREATE INDEX IF NOT EXISTS idx_import_session_created_by
  ON cases_import_session(created_by);
CREATE INDEX IF NOT EXISTS idx_import_session_status
  ON cases_import_session(status);
CREATE INDEX IF NOT EXISTS idx_import_session_expires_at
  ON cases_import_session(expires_at);

-- batch
CREATE INDEX IF NOT EXISTS idx_import_batch_session_id
  ON cases_import_batch(session_id);
CREATE INDEX IF NOT EXISTS idx_import_batch_created_by
  ON cases_import_batch(created_by);
CREATE INDEX IF NOT EXISTS idx_import_batch_applied
  ON cases_import_batch(applied);

-- staging
CREATE INDEX IF NOT EXISTS idx_import_staging_batch_id
  ON cases_import_staging(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_staging_created_by
  ON cases_import_staging(created_by);
CREATE INDEX IF NOT EXISTS idx_import_staging_classification
  ON cases_import_staging(classification);
CREATE INDEX IF NOT EXISTS idx_import_staging_admin_decision
  ON cases_import_staging(admin_decision);

-- log
CREATE INDEX IF NOT EXISTS idx_import_log_batch_id
  ON cases_import_log(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_log_created_by
  ON cases_import_log(created_by);
CREATE INDEX IF NOT EXISTS idx_import_log_case_id
  ON cases_import_log(case_id);
CREATE INDEX IF NOT EXISTS idx_import_log_rollback_status
  ON cases_import_log(rollback_status);


-- =============================================================================
-- RLS（Row Level Security）
--
-- 【設計方針】
--   インポートデータには会社名・担当者・電話・メール・金額が含まれる。
--   「認証済みなら全員見られる」設計は採用しない。
--   全テーブルで created_by = auth.uid() を基本とする。
--
--   ・SELECT  : 自分が作成したレコードのみ参照可能
--   ・INSERT  : created_by = auth.uid() を強制（他人IDでのINSERT不可）
--   ・UPDATE  : 自分が作成したレコードのみ更新可能
--   ・DELETE  : 自分が作成したレコードのみ（logは削除禁止）
--
--   apply / rollback の admin 権限チェックは API 側（requireAdmin）で実施。
--   RLS は「本人以外のデータへのアクセス遮断」に集中する。
-- =============================================================================

ALTER TABLE cases_import_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases_import_batch   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases_import_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases_import_log     ENABLE ROW LEVEL SECURITY;


-- ─── cases_import_session ────────────────────────────────────────────────────

CREATE POLICY "import_session: 自分のみSELECT"
  ON cases_import_session FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "import_session: 自分のUIDでINSERT"
  ON cases_import_session FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "import_session: 自分のみUPDATE"
  ON cases_import_session FOR UPDATE
  TO authenticated
  USING    (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "import_session: 自分のみDELETE"
  ON cases_import_session FOR DELETE
  TO authenticated
  USING (created_by = auth.uid());


-- ─── cases_import_batch ──────────────────────────────────────────────────────

CREATE POLICY "import_batch: 自分のみSELECT"
  ON cases_import_batch FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "import_batch: 自分のUIDでINSERT"
  ON cases_import_batch FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "import_batch: 自分のみUPDATE"
  ON cases_import_batch FOR UPDATE
  TO authenticated
  USING    (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- ※ batchの直接DELETEは禁止（CASCADE削除のみ許可）
-- DELETE ポリシーを作成しないことでDELETEを遮断する


-- ─── cases_import_staging ────────────────────────────────────────────────────
-- 顧客情報（会社名・担当者・電話・メール・金額）を含むため最も厳格に管理

CREATE POLICY "import_staging: 自分のみSELECT"
  ON cases_import_staging FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "import_staging: 自分のUIDでINSERT"
  ON cases_import_staging FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "import_staging: 自分のみUPDATE（admin_decision更新等）"
  ON cases_import_staging FOR UPDATE
  TO authenticated
  USING    (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- ※ stagingの直接DELETEは禁止（batch削除時のCascadeのみ）
-- DELETE ポリシーを作成しないことでDELETEを遮断する


-- ─── cases_import_log ────────────────────────────────────────────────────────
-- 操作ログ。改ざん防止のためDELETEは禁止。

CREATE POLICY "import_log: 自分のみSELECT"
  ON cases_import_log FOR SELECT
  TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "import_log: 自分のUIDでINSERT"
  ON cases_import_log FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "import_log: 自分のみUPDATE（rollback_status更新等）"
  ON cases_import_log FOR UPDATE
  TO authenticated
  USING    (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- ※ logのDELETEは禁止（rollbackの証跡を保護するため）
-- DELETE ポリシーを作成しないことでDELETEを遮断する


-- =============================================================================
-- 既存テーブルへの影響確認
-- =============================================================================
-- 【明記】
--   このSQLは以下を一切変更しません：
--   ・cases テーブル
--   ・media_master テーブル
--   ・floor_master テーブル
--   ・contact_method_master テーブル
--   ・event_category_master テーブル
--   ・event_subcategory_master テーブル
--   ・cancel_reason_master テーブル
--   ・option_master テーブル
--   ・case_option テーブル
--   ・case_checklist テーブル
--   ・case_file テーブル
--   ・case_hold_log テーブル
--   ・case_history テーブル
--   ・auth.users テーブル（参照のみ）
--
--   新規テーブルの追加のみです。
--   既存の RLS ポリシー・インデックス・トリガーは変更しません。
-- =============================================================================


-- =============================================================================
-- 動作確認用クエリ（実行後にSQL Editorで実行して確認してください）
-- =============================================================================
--
-- ① テーブルが4つ作成されているか確認
-- SELECT table_name
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name LIKE 'cases_import_%'
-- ORDER BY table_name;
--
-- 期待結果：
--   cases_import_batch
--   cases_import_log
--   cases_import_session
--   cases_import_staging
--
-- ② RLSが有効になっているか確認
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename LIKE 'cases_import_%';
--
-- 期待結果：全テーブルで rowsecurity = true
--
-- ③ RLSポリシーが設定されているか確認
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename LIKE 'cases_import_%'
-- ORDER BY tablename, cmd;
--
-- ④ 既存 cases テーブルが変更されていないか確認
-- SELECT COUNT(*) FROM cases;
-- （件数が変わっていなければOK）


-- =============================================================================
-- ROLLBACK SECTION
-- このインポートテーブル群を削除したい場合はここから下を実行。
-- ※ cases テーブルには一切影響しません。
-- =============================================================================
/*

DROP TABLE IF EXISTS cases_import_log      CASCADE;
DROP TABLE IF EXISTS cases_import_staging  CASCADE;
DROP TABLE IF EXISTS cases_import_batch    CASCADE;
DROP TABLE IF EXISTS cases_import_session  CASCADE;

*/
