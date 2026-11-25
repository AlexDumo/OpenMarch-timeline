-- A shape is a formation at a count (ADR 0006 revision of 2026-11-22, §1): a placed recipe stands
-- at a count (`beat`) instead of hanging off a move (`timeline_id`), and every mark of one shape
-- carries one key (`shape_key`). SQLite can't drop a column that has a foreign key, so
-- `timeline_shape_recipes` is rebuilt (drizzle-kit's rebuild, checked and filled by hand). Ids are
-- kept, so member rows keep their recipe.
--
-- - `beat`: an order mark's own beat (`params.beat`, then taken out of its params: the column
--   holds it now); else the end of the recipe's move; else 0, the starting spots. A recipe whose
--   move is gone (only possible with foreign keys off) is dropped, as the cascade would have.
-- - `shape_key`: the recipe's own id. Older files never recorded which copies belong together.
-- - A marcher listed twice at one count (data from before rule 2, or a bug) stays in the newer
--   recipe (higher id); shapes and ungroup marks are one class, order marks another. Recipes left
--   with no member are deleted.
-- - Undo and redo are both cleared in a file whose history names `timeline_shape_recipes`: an old
--   step would write `timeline_id`. Other files keep their history (as the kept-spots drop did).
--
-- Safe to run twice (`addColumnGuard.ts` skips an `ADD COLUMN` the table has): the three
-- `ADD COLUMN`s give the old table whichever of `timeline_id`, `beat` and `shape_key` it lacks, so
-- the copy reads them all, and a `beat` or `shape_key` already there is kept. A page-era test file
-- gets `beat` and `shape_key` that way before it converts (`applyLaterTimelineMigrationsUnrecorded`).
--
-- The migration runner turns foreign keys off around each statement, so dropping the old table
-- deletes no member row (a converting v0.1.7 file runs this inside its transaction, with foreign
-- keys deferred, on an empty table). The members' history triggers are dropped first so the
-- clean-up below logs no undo step; the renderer recreates every history trigger on open
-- (`createAllUndoTriggers`), the old table's go with it. The app writes file version 19 once this
-- has run (`markShapeAtCountModel`, `fileVersion.ts`).
PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `timeline_shape_recipes` ADD COLUMN `timeline_id` integer;--> statement-breakpoint
ALTER TABLE `timeline_shape_recipes` ADD COLUMN `beat` real;--> statement-breakpoint
ALTER TABLE `timeline_shape_recipes` ADD COLUMN `shape_key` integer;--> statement-breakpoint
DROP TRIGGER IF EXISTS `timeline_shape_recipe_marchers_it`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `timeline_shape_recipe_marchers_ut`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `timeline_shape_recipe_marchers_dt`;--> statement-breakpoint
UPDATE `history_stats` SET `cur_undo_group` = 1, `cur_redo_group` = 1 WHERE EXISTS (SELECT 1 FROM `history_undo` WHERE instr(`sql`, 'timeline_shape_recipes') > 0) OR EXISTS (SELECT 1 FROM `history_redo` WHERE instr(`sql`, 'timeline_shape_recipes') > 0);--> statement-breakpoint
DELETE FROM `history_redo` WHERE EXISTS (SELECT 1 FROM `history_undo` WHERE instr(`sql`, 'timeline_shape_recipes') > 0);--> statement-breakpoint
DELETE FROM `history_undo` WHERE EXISTS (SELECT 1 FROM `history_undo` WHERE instr(`sql`, 'timeline_shape_recipes') > 0) OR EXISTS (SELECT 1 FROM `history_redo` WHERE instr(`sql`, 'timeline_shape_recipes') > 0);--> statement-breakpoint
DELETE FROM `history_redo` WHERE EXISTS (SELECT 1 FROM `history_redo` WHERE instr(`sql`, 'timeline_shape_recipes') > 0);--> statement-breakpoint
CREATE TABLE `__new_timeline_shape_recipes` (
	`id` integer PRIMARY KEY NOT NULL,
	`beat` real NOT NULL,
	`shape_key` integer NOT NULL,
	`kind` text NOT NULL,
	`kind_version` integer NOT NULL,
	`params` text NOT NULL,
	`order_mode` text NOT NULL,
	`reverse` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "timeline_shape_recipes_params_check" CHECK(json_valid(params)),
	CONSTRAINT "timeline_shape_recipes_beat_check" CHECK(typeof(beat) IN ('integer', 'real') AND beat >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_timeline_shape_recipes`("id", "beat", "shape_key", "kind", "kind_version", "params", "order_mode", "reverse", "created_at") SELECT r."id", CASE WHEN r."beat" IS NOT NULL THEN max(0.0, r."beat") WHEN r."kind" IN ('order', 'orderClear') AND json_type(r."params", '$.beat') IN ('integer', 'real') THEN max(0.0, json_extract(r."params", '$.beat')) WHEN r."timeline_id" IS NULL THEN 0.0 ELSE CAST(t."end_beat" AS REAL) END, coalesce(r."shape_key", r."id"), r."kind", r."kind_version", CASE WHEN r."kind" IN ('order', 'orderClear') AND json_type(r."params", '$.beat') IS NOT NULL THEN json_remove(r."params", '$.beat') ELSE r."params" END, r."order_mode", r."reverse", r."created_at" FROM `timeline_shape_recipes` r LEFT JOIN `timelines` t ON t."id" = r."timeline_id" WHERE r."timeline_id" IS NULL OR t."id" IS NOT NULL;--> statement-breakpoint
DROP TABLE `timeline_shape_recipes`;--> statement-breakpoint
ALTER TABLE `__new_timeline_shape_recipes` RENAME TO `timeline_shape_recipes`;--> statement-breakpoint
CREATE INDEX `timeline_shape_recipes_beat` ON `timeline_shape_recipes` (`beat`);--> statement-breakpoint
CREATE INDEX `timeline_shape_recipes_shape_key` ON `timeline_shape_recipes` (`shape_key`);--> statement-breakpoint
DELETE FROM `timeline_shape_recipe_marchers` WHERE `recipe_id` NOT IN (SELECT `id` FROM `timeline_shape_recipes`);--> statement-breakpoint
DELETE FROM `timeline_shape_recipe_marchers` WHERE `id` IN (SELECT m."id" FROM `timeline_shape_recipe_marchers` m JOIN `timeline_shape_recipes` r ON r."id" = m."recipe_id" WHERE EXISTS (SELECT 1 FROM `timeline_shape_recipe_marchers` m2 JOIN `timeline_shape_recipes` r2 ON r2."id" = m2."recipe_id" WHERE m2."marcher_id" = m."marcher_id" AND r2."id" > r."id" AND abs(r2."beat" - r."beat") < 1e-9 AND (r2."kind" IN ('order', 'orderClear')) = (r."kind" IN ('order', 'orderClear'))));--> statement-breakpoint
DELETE FROM `timeline_shape_recipes` WHERE NOT EXISTS (SELECT 1 FROM `timeline_shape_recipe_marchers` m WHERE m."recipe_id" = `timeline_shape_recipes`."id");--> statement-breakpoint
PRAGMA foreign_keys=ON;
