-- ============================================================
-- 20261004_case_options_qty_numeric.sql
-- 機材・オペレーターの数量を小数第1位まで（0.1, 1.2, 10.9 など）保存できるようにする
--
-- 【適用状況】未適用です。
--   このファイルは作成のみで、Claude Code は本番DB・Supabase に一切適用していません。
--   適用する場合は、必ず人間が内容を確認し、バックアップ取得後に
--   メンテナンス時間帯などの影響の小さいタイミングで実施してください。
--
-- 【背景】
--   case_options.qty は INT のため、1.5 のような小数は保存できません
--   （PostgREST が `invalid input syntax for type integer` で拒否する）。
--   アプリ側（Zod / 入力欄）は小数対応済みですが、このmigrationを適用するまで
--   小数数量の保存は DB で失敗します（整数数量は従来どおり動作します）。
--
-- 【内容】
--   1. case_options.amount（GENERATED ALWAYS AS (qty * unit_price) STORED）を削除
--      → 生成列が参照している qty の型は、生成列を残したままでは変更できないため
--   2. case_options.qty を INT → NUMERIC(10,2) に変更
--      （既存の整数値は 1 → 1.00 のように値そのものは変わらない）
--   3. qty に CHECK 制約を追加: 数量 > 0 かつ 小数第1位まで
--      CHECK (qty > 0 AND qty = ROUND(qty, 1))
--      → 0 以下、1.23 / 1.234 のような小数第2位以下は、アプリ経由でなくても DB が拒否する。
--      → 型を NUMERIC(10,1) にしなかった理由: NUMERIC(10,1) だと 1.23 は拒否されず
--        1.2 に暗黙に丸められて保存されてしまう。スケール2 + CHECK なら不正値を明示的に拒否できる。
--      → 備品・設備（equipment）の整数のみ、というルールはアプリ側（UI / API）で担保する。
--        DB の CHECK は category を問わず「> 0 かつ小数第1位まで」。
--   4. amount を GENERATED ALWAYS AS (ROUND(qty * unit_price)::BIGINT) STORED で再作成
--      → 既存行も再計算される。整数数量の行は qty * unit_price と同じ値になる
--      → 小数数量の場合は円未満を四捨五入（アプリの Math.round と同じ）
--
-- 【適用前に必ず確認すること（読み取りのみ）】
--   a) case_options.amount に依存する VIEW / 関数 / ポリシー等が無いこと。
--      依存があると DROP COLUMN が失敗し、トランザクション全体がロールバックされる
--      （壊れる前に止まる安全側の挙動。CASCADE は意図的に使っていない）。
--        SELECT d.classid::regclass, d.objid, d.deptype
--        FROM pg_depend d
--        JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
--        WHERE d.refobjid = 'case_options'::regclass AND a.attname = 'amount';
--   b) 既存行が新しい CHECK 制約に違反していないこと（違反行があると ADD CONSTRAINT が失敗し、
--      トランザクション全体がロールバックされる。データは変更されない）。
--        SELECT id, case_id, qty FROM case_options WHERE qty IS NULL OR qty <= 0;
--      旧アプリは qty >= 1 の整数のみ受け付けていたため通常は 0 件のはず。
--      1件でもあれば、人間が内容を確認して対処方針を決めてから適用すること（この migration は行を書き換えない）。
--   c) 適用前後で SUM(amount) と COUNT(*) が一致すること（整数データのみの場合）。
--
-- 【ロック・影響】
--   テーブル書き換えが発生し、実行中は case_options に ACCESS EXCLUSIVE ロックが掛かる。
--   行数が少なければ短時間で完了する想定だが、件数は適用前に確認すること。
--   カラム順が変わる（amount が末尾に移動）。アプリは列名指定／select('*') のため影響なし。
--   case_options 以外（case_food_plans など）は変更しない。
--
-- 【ロールバック】
--   小数数量がまだ保存されていない場合に限り、qty を INT に戻せる:
--     BEGIN;
--     ALTER TABLE case_options DROP COLUMN amount;
--     ALTER TABLE case_options DROP CONSTRAINT case_options_qty_positive_one_decimal_check;
--     ALTER TABLE case_options ALTER COLUMN qty TYPE INT USING qty::INT;
--     ALTER TABLE case_options ADD COLUMN amount BIGINT GENERATED ALWAYS AS (qty * unit_price) STORED;
--     COMMIT;
--   小数が保存された後に戻すと端数が丸められてしまうため、事前に必ずバックアップを取ること。
-- ============================================================

BEGIN;

ALTER TABLE case_options DROP COLUMN amount;

ALTER TABLE case_options
  ALTER COLUMN qty TYPE NUMERIC(10,2);

ALTER TABLE case_options
  ADD CONSTRAINT case_options_qty_positive_one_decimal_check
  CHECK (qty > 0 AND qty = ROUND(qty, 1));

ALTER TABLE case_options
  ADD COLUMN amount BIGINT GENERATED ALWAYS AS (ROUND(qty * unit_price)::BIGINT) STORED;

COMMIT;
