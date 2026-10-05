-- ============================================================
-- 20261005_cases_status_change_trigger.sql
-- status が変わったとき、cancelled_at の打刻と case_history への履歴を DB トリガーで行う
--
-- 【適用状況】未適用です。
--   このファイルは作成・検証のみで、本番DB（Alexia）にも検証用DB（APEXIA-test）にも
--   適用していません。適用は、内容を確認した人間の承認後に行うこと。
--   前提: 20261005_add_cases_cancelled_at.sql を先に適用していること（未適用なら下の DO ブロックで中断する）。
--   アプリのデプロイはこの migration の適用後に行う。
--
-- 【なぜ DB トリガーか】
--   status を変える経路は複数ある（案件詳細のステータス変更・編集フォーム・GCal ボタンの全項目 PUT・
--   自動キャンセル・自動完了・今後追加される API・直接 SQL）。アプリ側で経路ごとに書くと漏れる／二重になる。
--   トリガーなら、status の変更・cancelled_at の打刻・履歴の記録が同一トランザクションになり、
--   履歴の INSERT に失敗すれば status の変更ごとロールバックされる（status だけ変わって履歴が無い状態を作らない）。
--
-- 【内容】（関数 2 つ、トリガー 2 つ。データの INSERT / UPDATE / DELETE は一切しない）
--   1. cases_stamp_cancelled_at()  BEFORE UPDATE OF status
--        OLD.status <> 'cancelled' かつ NEW.status = 'cancelled' のときだけ NEW.cancelled_at := now()。
--        ・cancelled のまま通常編集（cancelled → cancelled）では発火しない（WHEN で status が変わった行だけ）。
--        ・cancelled から別 status に戻しても cancelled_at は消さない（何もしない）。
--        ・再び cancelled になれば最新の now() で上書きする。
--        ・INSERT では発火しない（Excel 取込・新規作成で最初から cancelled の案件は cancelled_at = NULL のまま）。
--        ・クライアントが同じ UPDATE で cancelled_at を指定しても、cancelled への遷移ではトリガーが now() で上書きする。
--   2. cases_record_status_history()  AFTER UPDATE OF status（SECURITY DEFINER、search_path = ''）
--        status が変わった行ごとに case_history へ 1 行 INSERT する。
--        ・action_type : 自動キャンセル（NEW.status = cancelled かつ auto_cancel が false/NULL → true になった遷移）は 'auto_cancel'、
--                        それ以外は 'status_change'。どちらも case_history の既存 CHECK に含まれる（列・制約の追加なし）。
--        ・old_value   : {"status": 旧status}
--        ・new_value   : {"status": 新status, "auto_cancel": NEW.auto_cancel}。自動キャンセルのときだけ "source":"auto_cancel" を付ける。
--                        それ以外の遷移（手動か、自動完了か、取込後の編集か）は DB から正確に区別できないため source は入れない（偽の値を書かない）。
--        ・changed_by  : auth.uid()。cron（service role）など JWT が無い呼び出しでは NULL になる。
--        ・message     : 「ステータス変更: 新規問合せ → キャンセル」「自動キャンセル: 新規問合せ → キャンセル」
--        ・SECURITY DEFINER にする理由: case_history の INSERT ポリシーは staff 以上のみ。呼び出し元の権限に依らず、
--          status を変えた行の履歴を必ず残すため。search_path を空に固定し、参照はすべてスキーマ修飾している。
--          実行権限は PUBLIC / anon / authenticated から剥奪する（トリガー経由でしか動かない）。
--
-- 【既存トリガーとの関係】
--   cases の既存トリガーは trg_cases_updated_at（BEFORE UPDATE、updated_at = now()）のみ。
--   BEFORE トリガーは名前順に発火する（trg_cases_stamp_cancelled_at → trg_cases_updated_at）。
--   触る列が違う（cancelled_at と updated_at）ので互いに干渉しない。履歴用は AFTER なので順序の影響を受けない。
--
-- 【既存データには触れない】
--   この migration に backfill はなく、cases / case_history への INSERT / UPDATE / DELETE も無い。
--   過去 144 件の cancelled 案件の cancelled_at は NULL のまま。
--
-- 【適用後の注意】
--   ・status を変更する一回限りの SQL（データ修正）を流すと、このトリガーが発火して履歴が増え、cancelled なら cancelled_at が打刻される。
--     意図しない場合は、その SQL のトランザクション内で
--       ALTER TABLE public.cases DISABLE TRIGGER trg_cases_stamp_cancelled_at;
--       ALTER TABLE public.cases DISABLE TRIGGER trg_cases_record_status_history;
--     （終了時に ENABLE）としてから行うこと。
--   ・アプリ側の自動キャンセル／自動完了ランナーは、この migration が履歴を担当するため case_history に書かない。
--
-- 【rollback】（トリガー → 関数の順。cases / case_history のデータは変わらない。すでに打刻された cancelled_at と履歴は残る）
--   DROP TRIGGER IF EXISTS trg_cases_record_status_history ON public.cases;
--   DROP TRIGGER IF EXISTS trg_cases_stamp_cancelled_at ON public.cases;
--   DROP FUNCTION IF EXISTS public.cases_record_status_history();
--   DROP FUNCTION IF EXISTS public.cases_stamp_cancelled_at();
--   （列の削除は 20261005_add_cases_cancelled_at.sql の rollback を参照）
-- ============================================================

-- 前提チェック: cancelled_at 列が無ければ何も作らずに中断する
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cases' AND column_name = 'cancelled_at'
  ) THEN
    RAISE EXCEPTION 'cases.cancelled_at がありません。先に 20261005_add_cases_cancelled_at.sql を適用してください';
  END IF;
END $$;

-- ── 1. cancelled_at の打刻（BEFORE）────────────────────────────
CREATE OR REPLACE FUNCTION public.cases_stamp_cancelled_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'cancelled'
     AND OLD.status <> 'cancelled' THEN
    NEW.cancelled_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. 履歴の記録（AFTER）──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cases_record_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_auto_cancel boolean;
  v_old_label text;
  v_new_label text;
BEGIN
  v_is_auto_cancel := NEW.status = 'cancelled'
                      AND NEW.auto_cancel IS TRUE
                      AND OLD.auto_cancel IS NOT TRUE;

  v_old_label := CASE OLD.status
    WHEN 'inquiry' THEN '新規問合せ' WHEN 'preview_adj' THEN '下見調整中' WHEN 'previewed' THEN '下見済み'
    WHEN 'tentative' THEN '仮押さえ' WHEN 'confirmed' THEN '確定' WHEN 'cancelled' THEN 'キャンセル'
    WHEN 'done' THEN '開催終了' ELSE OLD.status END;
  v_new_label := CASE NEW.status
    WHEN 'inquiry' THEN '新規問合せ' WHEN 'preview_adj' THEN '下見調整中' WHEN 'previewed' THEN '下見済み'
    WHEN 'tentative' THEN '仮押さえ' WHEN 'confirmed' THEN '確定' WHEN 'cancelled' THEN 'キャンセル'
    WHEN 'done' THEN '開催終了' ELSE NEW.status END;

  INSERT INTO public.case_history (case_id, action_type, message, old_value, new_value, changed_by)
  VALUES (
    NEW.id,
    CASE WHEN v_is_auto_cancel THEN 'auto_cancel' ELSE 'status_change' END,
    CASE WHEN v_is_auto_cancel THEN '自動キャンセル: ' ELSE 'ステータス変更: ' END || v_old_label || ' → ' || v_new_label,
    jsonb_build_object('status', OLD.status),
    CASE WHEN v_is_auto_cancel
      THEN jsonb_build_object('status', NEW.status, 'auto_cancel', NEW.auto_cancel, 'source', 'auto_cancel')
      ELSE jsonb_build_object('status', NEW.status, 'auto_cancel', NEW.auto_cancel)
    END,
    auth.uid()
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.cases_stamp_cancelled_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cases_record_status_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cases_record_status_history() FROM anon, authenticated;

-- ── 3. トリガー（status が実際に変わった行だけ。INSERT では発火しない）──
CREATE OR REPLACE TRIGGER trg_cases_stamp_cancelled_at
  BEFORE UPDATE OF status ON public.cases
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.cases_stamp_cancelled_at();

CREATE OR REPLACE TRIGGER trg_cases_record_status_history
  AFTER UPDATE OF status ON public.cases
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.cases_record_status_history();
