CREATE TABLE IF NOT EXISTS `item_placement_marchers` (
	`id` integer PRIMARY KEY NOT NULL,
	`placement_id` integer NOT NULL,
	`marcher_id` integer NOT NULL,
	`role` text NOT NULL,
	`hand` text,
	FOREIGN KEY (`placement_id`) REFERENCES `item_placements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`marcher_id`) REFERENCES `marchers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "item_placement_marchers_role_check" CHECK((role = 'holder' AND hand IS NOT NULL AND hand IN ('left', 'right', 'both')) OR (role = 'crew' AND hand IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `item_placement_marchers_marcher_id_idx` ON `item_placement_marchers` (`marcher_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `item_placement_marchers_placement_marcher_unique` ON `item_placement_marchers` (`placement_id`,`marcher_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `item_placements` (
	`id` integer PRIMARY KEY NOT NULL,
	`item_id` integer NOT NULL,
	`beat_id` integer NOT NULL,
	`state` text NOT NULL,
	`beat_rank` integer DEFAULT 0 NOT NULL,
	`group_id` integer,
	`ripple_json` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`beat_id`) REFERENCES `beats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "item_placements_state_check" CHECK(state IN ('held', 'placed', 'off_field')),
	CONSTRAINT "item_placements_beat_rank_check" CHECK(typeof(beat_rank) = 'integer'),
	CONSTRAINT "item_placements_group_check" CHECK((group_id IS NULL AND ripple_json IS NULL) OR (typeof(group_id) = 'integer' AND group_id >= 1 AND ripple_json IS NOT NULL AND json_valid(ripple_json) AND json_type(ripple_json) = 'object' AND json_extract(ripple_json, '$.version') = 1 AND json_type(ripple_json, '$.span') = 'integer' AND json_extract(ripple_json, '$.span') >= 1 AND json_extract(ripple_json, '$.order') IN ('drill', 'left_right', 'right_left', 'down_form')))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `item_placements_beat_id_idx` ON `item_placements` (`beat_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `item_placements_group_id_idx` ON `item_placements` (`group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `item_placements_item_beat_unique` ON `item_placements` (`item_id`,`beat_id`);