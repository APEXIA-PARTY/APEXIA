-- ============================================================
-- 20261004_unify_media_cancel_reason_event_category.sql
-- 分析・集計で使うマスタの表記統一とイベント分類の整理
--
-- 【適用状況】未適用です。
--   このファイルは作成・検証のみで、本番DB（Alexia）にも検証用DB（APEXIA-test）にも
--   適用していません。適用は、内容と事前の件数確認を人間が承認した後に行うこと。
--
-- 【最終仕様】
--   認知経路 (media_master / cases.media_id)
--     「WEBで要件入力」＋「web要件検索」                       → 「WEB要件検索」
--     「insragram営業」＋「instagram DM営業」＋「instagramのDM」 → 「instagram DM営業」
--   キャンセル理由 (cancel_reason_master / cases.cancel_reason_id)
--     「他会場に決定」＋「他店舗で開催」 → 「他会場で開催」
--     「空き枠なし」＋「空いてなかった」 → 「空き枠なし」
--   イベント分類 (event_category_master / event_subcategory_master)
--     旧大分類「企業飲食」(96件) → 大分類「企業イベント」。中分類は次のルールで移行する:
--       A. 中分類なし 87件                          → 中分類「企業飲食」（企業イベント配下に新設）
--       B. 中分類「表彰式」(親=企業イベント) 1件     → 「表彰式」を維持
--       C. 中分類「懇親会」(親=パーティー) 6件       → 「社内懇親会」（企業イベント配下の既存）
--       D. 中分類「立食パーティー」(親=パーティー) 1件 → 中分類「企業飲食」
--       E. 中分類「その他」(親=展示会) 1件           → 「その他」（企業イベント配下の既存）。自由入力メモは保持
--     移行後、この96件に「別の大分類を親に持つ中分類」を参照したままの案件は残らない
--     （移行後の中分類内訳: 企業飲食 88 / 社内懇親会 6 / 表彰式 1 / その他 1）
--
-- 【設計】案件（cases）は名称ではなくマスタ行の ID を保存している。統合は
--   「正規マスタを存続（必要なら改名）→ 案件の参照先を正規IDへ付け替え → 旧マスタを is_active=false」
--   で行う。マスタ行の DELETE はしない（cases の FK は ON DELETE SET NULL、中分類は大分類に
--   ON DELETE CASCADE のため、DELETE すると案件の参照が失われる）。
--   正規マスタは、案件数の多い方を存続させる（同数の場合は、すでに正規名称のもの）:
--     WEB要件検索        : 「WEBで要件入力」(44件) を改名して存続 / 「web要件検索」(37件) の案件を付け替え
--     instagram DM営業   : 「instagram DM営業」(2件) を存続（改名不要）/ 「insragram営業」(2件)・「instagramのDM」(1件) を付け替え
--     他会場で開催       : 「他会場に決定」(16件) を改名して存続 / 「他店舗で開催」(13件) を付け替え
--     空き枠なし         : 「空き枠なし」(12件) を存続 / 「空いてなかった」(8件) を付け替え
--     企業イベント       : 存続 / 「企業飲食」(96件) の案件を企業イベントへ付け替え、「企業飲食」大分類は無効化
--
-- 【変更するもの】
--   cases : media_id / cancel_reason_id / event_category_id / event_subcategory_id の4カラムだけ
--     （想定件数: media_id 40 / cancel_reason_id 21 / event_category_id 96 / event_subcategory_id 95）
--   media_master / cancel_reason_master / event_category_master : 改名と is_active=false のみ
--   event_subcategory_master : 中分類「企業飲食」を企業イベント配下に1行追加
--   新規テーブル2つ（rollback 用バックアップ。個人情報は保存しない）
--     master_unify_case_backup_20261004   : case_id / 対象カラム名 / 旧ID / 新ID のみ
--     master_unify_master_backup_20261004 : マスタID / 旧名称 / 新名称 / 旧・新 is_active のみ
--   cases の updated_at はトリガー（trg_cases_updated_at）をこのトランザクション内だけ一時停止して
--   書き換えない（案件の更新日時を変えないため）。トリガーは COMMIT 前に必ず元の状態へ戻す。
--
-- 【変更しないもの】
--   顧客名・会社名・電話番号・メール・開催日・見積金額・ステータス・オプション・飲食・機材・支払い・
--   下見日時・自由入力メモ（cancel_note / event_subcategory_note）など、上記4カラム以外のすべて。
--
-- 【中断条件（1つでも該当すれば何も変更せずロールバック）】
--   ・統合対象のマスタ（有効なもの）が名称で1行に特定できない / 改名先の名称がすでに存在する
--   ・旧マスタを指す案件数が、下記の想定件数と一致しない（本番調査 2026-10-04 時点）
--   ・企業飲食の案件の中分類の内訳が想定と一致しない
--   ・更新した行数が想定と一致しない
--   ・更新前後で「4カラム以外の cases 全体」のハッシュ・総件数・売上合計・ステータス別件数が変わる
--   ・統合後に旧マスタを指す案件が残る / 統合後の件数が想定と一致しない
--   想定件数は日々の運用で変わり得る。適用直前に事前確認 SQL で件数を確認し、変化があれば
--   このファイルの EXP_* を更新して再レビューすること（勝手に緩めない）。
--
-- 【注意】同じ中分類（懇親会 / 立食パーティー / その他@展示会）を持つ、旧「企業飲食」以外の案件
--   （例: 企業イベントや学生イベントの案件）には触れない。更新は「旧企業飲食の案件」に限定する。
--
-- 【適用前に確認すること（読み取りのみ）】
--   各マスタの案件数（media_id / cancel_reason_id / event_category_id ごと）と、
--   企業飲食の案件の中分類内訳が、上記の想定件数と一致すること。
--
-- 【適用後に確認すること（読み取りのみ）】
--   旧マスタを指す案件が 0 件 / 分析・集計画面の数値 / バックアップ表の行数。
--
-- 【ロック・影響】
--   cases に SHARE ROW EXCLUSIVE ロック（読み取りは可、書き込みは待たされる）。数百行規模で短時間。
--
-- 【ロールバック】（バックアップ表が残っている間のみ。以下を実行する）
--   -- ROLLBACK-BEGIN
--   -- BEGIN;
--   -- ALTER TABLE cases DISABLE TRIGGER trg_cases_updated_at;
--   -- UPDATE cases c SET media_id = b.old_id FROM master_unify_case_backup_20261004 b
--   --   WHERE b.case_id = c.id AND b.column_name = 'media_id';
--   -- UPDATE cases c SET cancel_reason_id = b.old_id FROM master_unify_case_backup_20261004 b
--   --   WHERE b.case_id = c.id AND b.column_name = 'cancel_reason_id';
--   -- UPDATE cases c SET event_category_id = b.old_id FROM master_unify_case_backup_20261004 b
--   --   WHERE b.case_id = c.id AND b.column_name = 'event_category_id';
--   -- UPDATE cases c SET event_subcategory_id = b.old_id FROM master_unify_case_backup_20261004 b
--   --   WHERE b.case_id = c.id AND b.column_name = 'event_subcategory_id';
--   -- UPDATE media_master m SET name = b.old_name, is_active = b.old_is_active
--   --   FROM master_unify_master_backup_20261004 b
--   --   WHERE b.table_name = 'media_master' AND b.master_id = m.id AND b.action IN ('rename', 'deactivate');
--   -- UPDATE cancel_reason_master m SET name = b.old_name, is_active = b.old_is_active
--   --   FROM master_unify_master_backup_20261004 b
--   --   WHERE b.table_name = 'cancel_reason_master' AND b.master_id = m.id AND b.action IN ('rename', 'deactivate');
--   -- UPDATE event_category_master m SET name = b.old_name, is_active = b.old_is_active
--   --   FROM master_unify_master_backup_20261004 b
--   --   WHERE b.table_name = 'event_category_master' AND b.master_id = m.id AND b.action IN ('rename', 'deactivate');
--   -- UPDATE event_subcategory_master s SET is_active = false FROM master_unify_master_backup_20261004 b
--   --   WHERE b.table_name = 'event_subcategory_master' AND b.master_id = s.id AND b.action = 'insert';
--   -- ALTER TABLE cases ENABLE TRIGGER trg_cases_updated_at;
--   -- COMMIT;
--   -- ROLLBACK-END
--   注意: ・統合後に新しく作成・編集された案件は、バックアップに無いため復元されない
--           （正規マスタの名称は旧名称に戻るため、それらの案件の表示名も変わる）。
--         ・追加した中分類「企業飲食」は削除せず is_active=false にする（案件が参照している可能性があるため）。
--         ・バックアップ表は、統合の結果を十分に確認してから、人間の判断で削除すること。
-- ============================================================

BEGIN;

-- ─── バックアップ表（rollback 用。個人情報は保存しない）──────────
CREATE TABLE public.master_unify_case_backup_20261004 (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id     UUID        NOT NULL,
  column_name TEXT        NOT NULL CHECK (column_name IN ('media_id', 'cancel_reason_id', 'event_category_id', 'event_subcategory_id')),
  old_id      UUID,
  new_id      UUID        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.master_unify_master_backup_20261004 (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name    TEXT        NOT NULL,
  master_id     UUID        NOT NULL,
  action        TEXT        NOT NULL CHECK (action IN ('rename', 'deactivate', 'insert')),
  old_name      TEXT,
  new_name      TEXT,
  old_is_active BOOLEAN,
  new_is_active BOOLEAN,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- アプリ（anon / authenticated）からは見えないようにする（RLS 有効・ポリシーなし）
ALTER TABLE public.master_unify_case_backup_20261004   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_unify_master_backup_20261004 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_unify_case_backup_20261004   FROM anon, authenticated;
REVOKE ALL ON public.master_unify_master_backup_20261004 FROM anon, authenticated;

-- ─── ヘルパー（この接続の間だけ存在する一時関数。永続オブジェクトは作らない）──────
-- 有効なマスタ行を名称で1行に特定する（0行・2行以上なら中断）
CREATE FUNCTION pg_temp.unify_one_id(p_table TEXT, p_name TEXT) RETURNS UUID AS $f$
DECLARE
  n INTEGER;
  v UUID;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I WHERE name = $1 AND is_active', p_table) INTO n USING p_name;
  IF n <> 1 THEN
    RAISE EXCEPTION '中断: %「%」（有効）が % 行あります（1行である必要があります）。', p_table, p_name, n;
  END IF;
  EXECUTE format('SELECT id FROM public.%I WHERE name = $1 AND is_active', p_table) INTO v USING p_name;
  RETURN v;
END
$f$ LANGUAGE plpgsql;

-- 指定名称のマスタ行が（有効・無効を問わず）1行も存在しないことを確認する（改名先の衝突防止）
CREATE FUNCTION pg_temp.unify_assert_name_free(p_table TEXT, p_name TEXT) RETURNS VOID AS $f$
DECLARE
  n INTEGER;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I WHERE name = $1', p_table) INTO n USING p_name;
  IF n <> 0 THEN
    RAISE EXCEPTION '中断: %「%」がすでに % 行存在するため、改名できません。', p_table, p_name, n;
  END IF;
END
$f$ LANGUAGE plpgsql;

-- cases の参照カラムの件数
CREATE FUNCTION pg_temp.unify_ref_count(p_col TEXT, p_id UUID) RETURNS INTEGER AS $f$
DECLARE
  n INTEGER;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.cases WHERE %I = $1', p_col) INTO n USING p_id;
  RETURN n;
END
$f$ LANGUAGE plpgsql;

-- 件数が想定と一致することを確認する
CREATE FUNCTION pg_temp.unify_assert_count(p_label TEXT, p_actual INTEGER, p_expected INTEGER) RETURNS VOID AS $f$
BEGIN
  IF p_actual <> p_expected THEN
    RAISE EXCEPTION '中断: % の件数が想定と違います（実際 %、想定 %）。何も変更していません。', p_label, p_actual, p_expected;
  END IF;
END
$f$ LANGUAGE plpgsql;

-- 案件の参照先を付け替える（バックアップ → UPDATE。行数が想定と一致しなければ中断）
CREATE FUNCTION pg_temp.unify_repoint(p_label TEXT, p_col TEXT, p_from UUID, p_to UUID, p_expected INTEGER) RETURNS VOID AS $f$
DECLARE
  n INTEGER;
BEGIN
  EXECUTE format(
    'INSERT INTO public.master_unify_case_backup_20261004 (case_id, column_name, old_id, new_id)
       SELECT id, %L, %I, %L::uuid FROM public.cases WHERE %I = %L::uuid',
    p_col, p_col, p_to, p_col, p_from);
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.unify_assert_count(p_label || '（バックアップ行）', n, p_expected);

  EXECUTE format('UPDATE public.cases SET %I = %L::uuid WHERE %I = %L::uuid', p_col, p_to, p_col, p_from);
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.unify_assert_count(p_label || '（UPDATE行）', n, p_expected);
END
$f$ LANGUAGE plpgsql;

-- 旧企業飲食の案件に限定して、中分類を付け替える
-- 同じ中分類を持つ他の大分類の案件（企業飲食でないもの）には触れない
CREATE FUNCTION pg_temp.unify_repoint_sub_within_category(p_label TEXT, p_cat UUID, p_from_sub UUID, p_to_sub UUID, p_expected INTEGER) RETURNS VOID AS $f$
DECLARE
  n INTEGER;
BEGIN
  INSERT INTO public.master_unify_case_backup_20261004 (case_id, column_name, old_id, new_id)
    SELECT id, 'event_subcategory_id', event_subcategory_id, p_to_sub
      FROM public.cases WHERE event_category_id = p_cat AND event_subcategory_id = p_from_sub;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.unify_assert_count(p_label || '（バックアップ行）', n, p_expected);

  UPDATE public.cases SET event_subcategory_id = p_to_sub
    WHERE event_category_id = p_cat AND event_subcategory_id = p_from_sub;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.unify_assert_count(p_label || '（UPDATE行）', n, p_expected);
END
$f$ LANGUAGE plpgsql;

-- ─── 本体 ─────────────────────────────────────────────────────
DO $$
DECLARE
  -- 想定件数（本番調査 2026-10-04）。適用直前の確認で変わっていたら更新して再レビューすること
  EXP_MEDIA_WEB_CANON     CONSTANT INTEGER := 44;  -- 「WEBで要件入力」
  EXP_MEDIA_WEB_SRC       CONSTANT INTEGER := 37;  -- 「web要件検索」
  EXP_MEDIA_IG_CANON      CONSTANT INTEGER := 2;   -- 「instagram DM営業」
  EXP_MEDIA_IG_SRC1       CONSTANT INTEGER := 2;   -- 「insragram営業」
  EXP_MEDIA_IG_SRC2       CONSTANT INTEGER := 1;   -- 「instagramのDM」
  EXP_CANCEL_VENUE_CANON  CONSTANT INTEGER := 16;  -- 「他会場に決定」
  EXP_CANCEL_VENUE_SRC    CONSTANT INTEGER := 13;  -- 「他店舗で開催」
  EXP_CANCEL_SLOT_CANON   CONSTANT INTEGER := 12;  -- 「空き枠なし」
  EXP_CANCEL_SLOT_SRC     CONSTANT INTEGER := 8;   -- 「空いてなかった」
  EXP_CAT_EVENT           CONSTANT INTEGER := 157; -- 「企業イベント」
  EXP_CAT_INSHOKU         CONSTANT INTEGER := 96;  -- 「企業飲食」
  EXP_INSHOKU_SUB_NULL    CONSTANT INTEGER := 87;  -- 企業飲食のうち中分類なし
  EXP_INSHOKU_HYOSHO      CONSTANT INTEGER := 1;   -- 企業飲食のうち中分類=表彰式（企業イベント配下）
  EXP_KONSHINKAI          CONSTANT INTEGER := 6;   -- 企業飲食のうち 懇親会（親=パーティー）→ 社内懇親会
  EXP_TACHISHOKU          CONSTANT INTEGER := 1;   -- 企業飲食のうち 立食パーティー（親=パーティー）→ 企業飲食
  EXP_SONOTA_TENJI        CONSTANT INTEGER := 1;   -- 企業飲食のうち その他（親=展示会）→ 企業イベントの「その他」
  EXP_SUB_INSHOKU_AFTER   CONSTANT INTEGER := 88;  -- 移行後の中分類「企業飲食」（87 + 1）

  v_web_canon UUID; v_web_src UUID;
  v_ig_canon  UUID; v_ig_src1 UUID; v_ig_src2 UUID;
  v_venue_canon UUID; v_venue_src UUID;
  v_slot_canon  UUID; v_slot_src  UUID;
  v_cat_event UUID; v_cat_inshoku UUID; v_cat_party UUID; v_cat_exhibit UUID;
  v_sub_inshoku UUID; v_sub_hyosho UUID; v_sub_konshinkai UUID; v_sub_tachishoku UUID; v_sub_sonota_tenji UUID;
  v_sub_shanai UUID; v_sub_ev_sonota UUID;
  v_sub_inshoku_before INTEGER;
  n INTEGER;
  v_sub_existing_n INTEGER;
  v_trg_state "char";
  v_fp_before TEXT; v_fp_after TEXT;
  v_total_before BIGINT; v_total_after BIGINT;
  v_rev_before NUMERIC; v_rev_after NUMERIC;
  v_status_before TEXT; v_status_after TEXT;
BEGIN
  -- 書き込みを止める（読み取りは可）。チェックから UPDATE までの間に件数が変わらないようにする
  LOCK TABLE public.cases IN SHARE ROW EXCLUSIVE MODE;

  -- ── マスタの特定 ──
  v_web_canon   := pg_temp.unify_one_id('media_master', 'WEBで要件入力');
  v_web_src     := pg_temp.unify_one_id('media_master', 'web要件検索');
  v_ig_canon    := pg_temp.unify_one_id('media_master', 'instagram DM営業');
  v_ig_src1     := pg_temp.unify_one_id('media_master', 'insragram営業');
  v_ig_src2     := pg_temp.unify_one_id('media_master', 'instagramのDM');
  v_venue_canon := pg_temp.unify_one_id('cancel_reason_master', '他会場に決定');
  v_venue_src   := pg_temp.unify_one_id('cancel_reason_master', '他店舗で開催');
  v_slot_canon  := pg_temp.unify_one_id('cancel_reason_master', '空き枠なし');
  v_slot_src    := pg_temp.unify_one_id('cancel_reason_master', '空いてなかった');
  v_cat_event   := pg_temp.unify_one_id('event_category_master', '企業イベント');
  v_cat_inshoku := pg_temp.unify_one_id('event_category_master', '企業飲食');

  -- 改名先の名称が未使用であること（有効・無効を問わない。大文字小文字は区別して判定）
  PERFORM pg_temp.unify_assert_name_free('media_master', 'WEB要件検索');
  PERFORM pg_temp.unify_assert_name_free('cancel_reason_master', '他会場で開催');

  -- 自動キャンセル専用の理由は統合対象に含めない
  IF EXISTS (SELECT 1 FROM public.cancel_reason_master WHERE id IN (v_venue_canon, v_venue_src, v_slot_canon, v_slot_src) AND is_auto_cancel) THEN
    RAISE EXCEPTION '中断: 統合対象のキャンセル理由に is_auto_cancel=true のものが含まれています。';
  END IF;

  -- ── 事前の件数確認 ──
  PERFORM pg_temp.unify_assert_count('認知経路「WEBで要件入力」',     pg_temp.unify_ref_count('media_id', v_web_canon), EXP_MEDIA_WEB_CANON);
  PERFORM pg_temp.unify_assert_count('認知経路「web要件検索」',       pg_temp.unify_ref_count('media_id', v_web_src),   EXP_MEDIA_WEB_SRC);
  PERFORM pg_temp.unify_assert_count('認知経路「instagram DM営業」', pg_temp.unify_ref_count('media_id', v_ig_canon),  EXP_MEDIA_IG_CANON);
  PERFORM pg_temp.unify_assert_count('認知経路「insragram営業」',     pg_temp.unify_ref_count('media_id', v_ig_src1),   EXP_MEDIA_IG_SRC1);
  PERFORM pg_temp.unify_assert_count('認知経路「instagramのDM」',     pg_temp.unify_ref_count('media_id', v_ig_src2),   EXP_MEDIA_IG_SRC2);
  PERFORM pg_temp.unify_assert_count('キャンセル理由「他会場に決定」', pg_temp.unify_ref_count('cancel_reason_id', v_venue_canon), EXP_CANCEL_VENUE_CANON);
  PERFORM pg_temp.unify_assert_count('キャンセル理由「他店舗で開催」', pg_temp.unify_ref_count('cancel_reason_id', v_venue_src),   EXP_CANCEL_VENUE_SRC);
  PERFORM pg_temp.unify_assert_count('キャンセル理由「空き枠なし」',   pg_temp.unify_ref_count('cancel_reason_id', v_slot_canon),  EXP_CANCEL_SLOT_CANON);
  PERFORM pg_temp.unify_assert_count('キャンセル理由「空いてなかった」', pg_temp.unify_ref_count('cancel_reason_id', v_slot_src),   EXP_CANCEL_SLOT_SRC);
  PERFORM pg_temp.unify_assert_count('大分類「企業イベント」', pg_temp.unify_ref_count('event_category_id', v_cat_event),   EXP_CAT_EVENT);
  PERFORM pg_temp.unify_assert_count('大分類「企業飲食」',     pg_temp.unify_ref_count('event_category_id', v_cat_inshoku), EXP_CAT_INSHOKU);

  -- ── 企業飲食の案件の中分類の内訳 ──
  SELECT count(*) INTO n FROM public.cases WHERE event_category_id = v_cat_inshoku AND event_subcategory_id IS NULL;
  PERFORM pg_temp.unify_assert_count('企業飲食（中分類なし）', n, EXP_INSHOKU_SUB_NULL);

  SELECT id INTO STRICT v_sub_hyosho FROM public.event_subcategory_master WHERE category_id = v_cat_event AND name = '表彰式' AND is_active;
  SELECT count(*) INTO n FROM public.cases WHERE event_category_id = v_cat_inshoku AND event_subcategory_id = v_sub_hyosho;
  PERFORM pg_temp.unify_assert_count('企業飲食（中分類=表彰式@企業イベント）', n, EXP_INSHOKU_HYOSHO);

  -- 他の大分類の子になっている中分類。親の名称で特定する
  SELECT id INTO STRICT v_cat_party   FROM public.event_category_master WHERE name = 'パーティー';
  SELECT id INTO STRICT v_cat_exhibit FROM public.event_category_master WHERE name = '展示会';
  SELECT id INTO STRICT v_sub_konshinkai   FROM public.event_subcategory_master WHERE category_id = v_cat_party   AND name = '懇親会';
  SELECT id INTO STRICT v_sub_tachishoku   FROM public.event_subcategory_master WHERE category_id = v_cat_party   AND name = '立食パーティー';
  SELECT id INTO STRICT v_sub_sonota_tenji FROM public.event_subcategory_master WHERE category_id = v_cat_exhibit AND name = 'その他';
  -- 移行先（企業イベント配下の既存の中分類）。有効な1行に特定できなければ中断（STRICT）
  SELECT id INTO STRICT v_sub_shanai    FROM public.event_subcategory_master WHERE category_id = v_cat_event AND name = '社内懇親会' AND is_active;
  SELECT id INTO STRICT v_sub_ev_sonota FROM public.event_subcategory_master WHERE category_id = v_cat_event AND name = 'その他' AND is_active;
  SELECT count(*) INTO n FROM public.cases WHERE event_category_id = v_cat_inshoku AND event_subcategory_id = v_sub_konshinkai;
  PERFORM pg_temp.unify_assert_count('企業飲食（中分類=懇親会@パーティー）', n, EXP_KONSHINKAI);
  SELECT count(*) INTO n FROM public.cases WHERE event_category_id = v_cat_inshoku AND event_subcategory_id = v_sub_tachishoku;
  PERFORM pg_temp.unify_assert_count('企業飲食（中分類=立食パーティー@パーティー）', n, EXP_TACHISHOKU);
  SELECT count(*) INTO n FROM public.cases WHERE event_category_id = v_cat_inshoku AND event_subcategory_id = v_sub_sonota_tenji;
  PERFORM pg_temp.unify_assert_count('企業飲食（中分類=その他@展示会）', n, EXP_SONOTA_TENJI);

  -- 内訳の合計が企業飲食の件数と一致する（想定外の中分類が混ざっていない）
  PERFORM pg_temp.unify_assert_count('企業飲食の中分類内訳の合計',
    EXP_INSHOKU_SUB_NULL + EXP_INSHOKU_HYOSHO + EXP_KONSHINKAI + EXP_TACHISHOKU + EXP_SONOTA_TENJI,
    EXP_CAT_INSHOKU);

  -- 中分類「企業飲食」: 企業イベント配下に無ければ新設、あれば再利用（有効な1行であること）
  SELECT count(*) INTO v_sub_existing_n FROM public.event_subcategory_master WHERE category_id = v_cat_event AND name = '企業飲食';
  IF v_sub_existing_n > 1 THEN
    RAISE EXCEPTION '中断: 企業イベント配下に中分類「企業飲食」がすでに % 行あります。', v_sub_existing_n;
  END IF;

  -- ── 更新前の不変条件を記録 ──
  SELECT tgenabled INTO v_trg_state FROM pg_trigger WHERE tgrelid = 'public.cases'::regclass AND tgname = 'trg_cases_updated_at';
  IF v_trg_state IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION '中断: trg_cases_updated_at が見つからないか、通常の有効状態ではありません（状態: %）。', v_trg_state;
  END IF;

  SELECT count(*), COALESCE(sum(estimate_amount), 0) INTO v_total_before, v_rev_before FROM public.cases;
  SELECT md5(string_agg(s.status || ':' || s.cnt::text, ',' ORDER BY s.status)) INTO v_status_before
    FROM (SELECT status, count(*) AS cnt FROM public.cases GROUP BY status) s;
  -- 対象4カラムと更新日時以外も含めた cases 全体のハッシュ（updated_at は触らないので含める）
  SELECT md5(string_agg((to_jsonb(c) - 'media_id' - 'cancel_reason_id' - 'event_category_id' - 'event_subcategory_id')::text, ',' ORDER BY c.id))
    INTO v_fp_before FROM public.cases c;

  -- 更新日時を書き換えないため、このトランザクション内だけトリガーを止める（COMMIT 前に必ず戻す）
  ALTER TABLE public.cases DISABLE TRIGGER trg_cases_updated_at;

  -- ── 認知経路の付け替え ──
  PERFORM pg_temp.unify_repoint('認知経路 web要件検索 → WEB要件検索', 'media_id', v_web_src, v_web_canon, EXP_MEDIA_WEB_SRC);
  PERFORM pg_temp.unify_repoint('認知経路 insragram営業 → instagram DM営業', 'media_id', v_ig_src1, v_ig_canon, EXP_MEDIA_IG_SRC1);
  PERFORM pg_temp.unify_repoint('認知経路 instagramのDM → instagram DM営業', 'media_id', v_ig_src2, v_ig_canon, EXP_MEDIA_IG_SRC2);

  -- ── キャンセル理由の付け替え ──
  PERFORM pg_temp.unify_repoint('キャンセル理由 他店舗で開催 → 他会場で開催', 'cancel_reason_id', v_venue_src, v_venue_canon, EXP_CANCEL_VENUE_SRC);
  PERFORM pg_temp.unify_repoint('キャンセル理由 空いてなかった → 空き枠なし', 'cancel_reason_id', v_slot_src, v_slot_canon, EXP_CANCEL_SLOT_SRC);

  -- ── イベント分類 ──
  v_sub_inshoku_before := 0;
  IF v_sub_existing_n = 0 THEN
    -- 中分類「企業飲食」を新設
    INSERT INTO public.event_subcategory_master (category_id, name, display_order, is_active)
    VALUES (v_cat_event, '企業飲食',
            (SELECT COALESCE(MAX(display_order), 0) + 1 FROM public.event_subcategory_master WHERE category_id = v_cat_event),
            true)
    RETURNING id INTO v_sub_inshoku;
    INSERT INTO public.master_unify_master_backup_20261004 (table_name, master_id, action, old_name, new_name, old_is_active, new_is_active)
    VALUES ('event_subcategory_master', v_sub_inshoku, 'insert', NULL, '企業飲食', NULL, true);
  ELSE
    SELECT id INTO v_sub_inshoku FROM public.event_subcategory_master WHERE category_id = v_cat_event AND name = '企業飲食' AND is_active;
    IF v_sub_inshoku IS NULL THEN
      RAISE EXCEPTION '中断: 企業イベント配下の中分類「企業飲食」が無効になっています。';
    END IF;
    v_sub_inshoku_before := pg_temp.unify_ref_count('event_subcategory_id', v_sub_inshoku);
  END IF;

  -- 既存の中分類を持つ旧企業飲食の案件（8件）: 中分類を企業イベント配下へ移す（企業飲食の案件に限定）
  --   C. 懇親会（親=パーティー） 6件 → 社内懇親会
  --   D. 立食パーティー（親=パーティー） 1件 → 企業飲食（新設）
  --   E. その他（親=展示会） 1件 → 企業イベントの「その他」（event_subcategory_note は触れない）
  PERFORM pg_temp.unify_repoint_sub_within_category('中分類 懇親会 → 社内懇親会', v_cat_inshoku, v_sub_konshinkai, v_sub_shanai, EXP_KONSHINKAI);
  PERFORM pg_temp.unify_repoint_sub_within_category('中分類 立食パーティー → 企業飲食', v_cat_inshoku, v_sub_tachishoku, v_sub_inshoku, EXP_TACHISHOKU);
  PERFORM pg_temp.unify_repoint_sub_within_category('中分類 その他（展示会） → その他（企業イベント）', v_cat_inshoku, v_sub_sonota_tenji, v_sub_ev_sonota, EXP_SONOTA_TENJI);

  -- 中分類なしの87件: 大分類=企業イベント + 中分類=企業飲食
  INSERT INTO public.master_unify_case_backup_20261004 (case_id, column_name, old_id, new_id)
    SELECT id, 'event_category_id', event_category_id, v_cat_event
      FROM public.cases WHERE event_category_id = v_cat_inshoku AND event_subcategory_id IS NULL;
  INSERT INTO public.master_unify_case_backup_20261004 (case_id, column_name, old_id, new_id)
    SELECT id, 'event_subcategory_id', NULL, v_sub_inshoku
      FROM public.cases WHERE event_category_id = v_cat_inshoku AND event_subcategory_id IS NULL;
  UPDATE public.cases SET event_category_id = v_cat_event, event_subcategory_id = v_sub_inshoku
    WHERE event_category_id = v_cat_inshoku AND event_subcategory_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.unify_assert_count('企業飲食（中分類なし）のUPDATE行', n, EXP_INSHOKU_SUB_NULL);

  -- 残り（既存の中分類を持っていた9件。中分類は上で移行済み、表彰式は維持）: 大分類を企業イベントへ
  PERFORM pg_temp.unify_repoint('大分類 企業飲食 → 企業イベント（既存の中分類あり）', 'event_category_id', v_cat_inshoku, v_cat_event,
                                EXP_CAT_INSHOKU - EXP_INSHOKU_SUB_NULL);

  ALTER TABLE public.cases ENABLE TRIGGER trg_cases_updated_at;

  -- ── マスタの改名と無効化（DELETE はしない）──
  INSERT INTO public.master_unify_master_backup_20261004 (table_name, master_id, action, old_name, new_name, old_is_active, new_is_active)
  VALUES
    ('media_master',          v_web_canon,   'rename',     'WEBで要件入力',  'WEB要件検索', true, true),
    ('media_master',          v_web_src,     'deactivate', 'web要件検索',    'web要件検索', true, false),
    ('media_master',          v_ig_src1,     'deactivate', 'insragram営業',  'insragram営業', true, false),
    ('media_master',          v_ig_src2,     'deactivate', 'instagramのDM',  'instagramのDM', true, false),
    ('cancel_reason_master',  v_venue_canon, 'rename',     '他会場に決定',   '他会場で開催', true, true),
    ('cancel_reason_master',  v_venue_src,   'deactivate', '他店舗で開催',   '他店舗で開催', true, false),
    ('cancel_reason_master',  v_slot_src,    'deactivate', '空いてなかった', '空いてなかった', true, false),
    ('event_category_master', v_cat_inshoku, 'deactivate', '企業飲食',       '企業飲食', true, false);

  UPDATE public.media_master SET name = 'WEB要件検索' WHERE id = v_web_canon;
  UPDATE public.media_master SET is_active = false WHERE id IN (v_web_src, v_ig_src1, v_ig_src2);
  UPDATE public.cancel_reason_master SET name = '他会場で開催' WHERE id = v_venue_canon;
  UPDATE public.cancel_reason_master SET is_active = false WHERE id IN (v_venue_src, v_slot_src);
  UPDATE public.event_category_master SET is_active = false WHERE id = v_cat_inshoku;

  -- ── 統合後の検証（1つでも違えば中断してロールバック）──
  PERFORM pg_temp.unify_assert_count('旧「web要件検索」を指す案件',     pg_temp.unify_ref_count('media_id', v_web_src), 0);
  PERFORM pg_temp.unify_assert_count('旧「insragram営業」を指す案件',   pg_temp.unify_ref_count('media_id', v_ig_src1), 0);
  PERFORM pg_temp.unify_assert_count('旧「instagramのDM」を指す案件',   pg_temp.unify_ref_count('media_id', v_ig_src2), 0);
  PERFORM pg_temp.unify_assert_count('旧「他店舗で開催」を指す案件',   pg_temp.unify_ref_count('cancel_reason_id', v_venue_src), 0);
  PERFORM pg_temp.unify_assert_count('旧「空いてなかった」を指す案件', pg_temp.unify_ref_count('cancel_reason_id', v_slot_src), 0);
  PERFORM pg_temp.unify_assert_count('旧大分類「企業飲食」を指す案件', pg_temp.unify_ref_count('event_category_id', v_cat_inshoku), 0);

  PERFORM pg_temp.unify_assert_count('統合後 WEB要件検索',      pg_temp.unify_ref_count('media_id', v_web_canon), EXP_MEDIA_WEB_CANON + EXP_MEDIA_WEB_SRC);
  PERFORM pg_temp.unify_assert_count('統合後 instagram DM営業', pg_temp.unify_ref_count('media_id', v_ig_canon),  EXP_MEDIA_IG_CANON + EXP_MEDIA_IG_SRC1 + EXP_MEDIA_IG_SRC2);
  PERFORM pg_temp.unify_assert_count('統合後 他会場で開催',     pg_temp.unify_ref_count('cancel_reason_id', v_venue_canon), EXP_CANCEL_VENUE_CANON + EXP_CANCEL_VENUE_SRC);
  PERFORM pg_temp.unify_assert_count('統合後 空き枠なし',       pg_temp.unify_ref_count('cancel_reason_id', v_slot_canon),  EXP_CANCEL_SLOT_CANON + EXP_CANCEL_SLOT_SRC);
  PERFORM pg_temp.unify_assert_count('統合後 企業イベント',     pg_temp.unify_ref_count('event_category_id', v_cat_event),  EXP_CAT_EVENT + EXP_CAT_INSHOKU);
  -- 旧企業飲食の96件の中分類内訳（バックアップに記録した対象案件で検証）
  PERFORM pg_temp.unify_assert_count('統合後 中分類 企業飲食',
    pg_temp.unify_ref_count('event_subcategory_id', v_sub_inshoku), v_sub_inshoku_before + EXP_SUB_INSHOKU_AFTER);
  PERFORM pg_temp.unify_assert_count('旧企業飲食 → 中分類=企業飲食', (SELECT count(*)::int FROM public.cases c JOIN public.master_unify_case_backup_20261004 b
    ON b.case_id = c.id AND b.column_name = 'event_category_id' AND b.old_id = v_cat_inshoku WHERE c.event_subcategory_id = v_sub_inshoku), EXP_SUB_INSHOKU_AFTER);
  PERFORM pg_temp.unify_assert_count('旧企業飲食 → 中分類=社内懇親会', (SELECT count(*)::int FROM public.cases c JOIN public.master_unify_case_backup_20261004 b
    ON b.case_id = c.id AND b.column_name = 'event_category_id' AND b.old_id = v_cat_inshoku WHERE c.event_subcategory_id = v_sub_shanai), EXP_KONSHINKAI);
  PERFORM pg_temp.unify_assert_count('旧企業飲食 → 中分類=表彰式', (SELECT count(*)::int FROM public.cases c JOIN public.master_unify_case_backup_20261004 b
    ON b.case_id = c.id AND b.column_name = 'event_category_id' AND b.old_id = v_cat_inshoku WHERE c.event_subcategory_id = v_sub_hyosho), EXP_INSHOKU_HYOSHO);
  PERFORM pg_temp.unify_assert_count('旧企業飲食 → 中分類=その他（企業イベント）', (SELECT count(*)::int FROM public.cases c JOIN public.master_unify_case_backup_20261004 b
    ON b.case_id = c.id AND b.column_name = 'event_category_id' AND b.old_id = v_cat_inshoku WHERE c.event_subcategory_id = v_sub_ev_sonota), EXP_SONOTA_TENJI);
  -- 旧企業飲食の案件に、別の大分類を親に持つ中分類を参照したままの案件が残っていないこと
  PERFORM pg_temp.unify_assert_count('旧企業飲食で親大分類が不一致の中分類参照', (SELECT count(*)::int FROM public.cases c
    JOIN public.master_unify_case_backup_20261004 b ON b.case_id = c.id AND b.column_name = 'event_category_id' AND b.old_id = v_cat_inshoku
    JOIN public.event_subcategory_master s ON s.id = c.event_subcategory_id WHERE s.category_id <> c.event_category_id), 0);
  PERFORM pg_temp.unify_assert_count('旧企業飲食で中分類が未設定の案件', (SELECT count(*)::int FROM public.cases c
    JOIN public.master_unify_case_backup_20261004 b ON b.case_id = c.id AND b.column_name = 'event_category_id' AND b.old_id = v_cat_inshoku
    WHERE c.event_subcategory_id IS NULL), 0);

  SELECT count(*), COALESCE(sum(estimate_amount), 0) INTO v_total_after, v_rev_after FROM public.cases;
  SELECT md5(string_agg(s.status || ':' || s.cnt::text, ',' ORDER BY s.status)) INTO v_status_after
    FROM (SELECT status, count(*) AS cnt FROM public.cases GROUP BY status) s;
  SELECT md5(string_agg((to_jsonb(c) - 'media_id' - 'cancel_reason_id' - 'event_category_id' - 'event_subcategory_id')::text, ',' ORDER BY c.id))
    INTO v_fp_after FROM public.cases c;

  IF v_total_after <> v_total_before THEN RAISE EXCEPTION '中断: cases の総件数が変わりました（% → %）。', v_total_before, v_total_after; END IF;
  IF v_rev_after <> v_rev_before THEN RAISE EXCEPTION '中断: 見積金額の合計が変わりました（% → %）。', v_rev_before, v_rev_after; END IF;
  IF v_status_after IS DISTINCT FROM v_status_before THEN RAISE EXCEPTION '中断: ステータス別件数が変わりました。'; END IF;
  IF v_fp_after IS DISTINCT FROM v_fp_before THEN RAISE EXCEPTION '中断: 対象4カラム以外の cases の内容が変わりました。'; END IF;

  SELECT tgenabled INTO v_trg_state FROM pg_trigger WHERE tgrelid = 'public.cases'::regclass AND tgname = 'trg_cases_updated_at';
  IF v_trg_state IS DISTINCT FROM 'O' THEN RAISE EXCEPTION '中断: trg_cases_updated_at を元の状態に戻せていません。'; END IF;
END
$$;

COMMIT;
