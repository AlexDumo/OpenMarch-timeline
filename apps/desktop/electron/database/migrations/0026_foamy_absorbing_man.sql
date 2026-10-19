CREATE TABLE IF NOT EXISTS `item_artwork_slots` (
	`id` integer PRIMARY KEY NOT NULL,
	`item_id` integer NOT NULL,
	`beat_id` integer NOT NULL,
	`slot` text NOT NULL,
	`library_item_id` text,
	`library_version_hash` text,
	`fit` text DEFAULT 'fill' NOT NULL,
	`pan_x` real DEFAULT 0 NOT NULL,
	`pan_y` real DEFAULT 0 NOT NULL,
	`pad_color` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`beat_id`) REFERENCES `beats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "item_artwork_slots_slot_check" CHECK(slot IS NOT NULL AND length(slot) BETWEEN 1 AND 64 AND slot NOT GLOB '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "item_artwork_slots_library_check" CHECK((library_item_id IS NULL AND library_version_hash IS NULL) OR (library_item_id IS NOT NULL AND library_version_hash IS NOT NULL AND length(library_item_id) = 36 AND length(library_version_hash) = 64)),
	CONSTRAINT "item_artwork_slots_fit_check" CHECK(fit IS NOT NULL AND fit IN ('fill', 'fit')),
	CONSTRAINT "item_artwork_slots_pan_check" CHECK(pan_x IS NOT NULL AND pan_y IS NOT NULL AND typeof(pan_x) IN ('real', 'integer') AND typeof(pan_y) IN ('real', 'integer') AND pan_x BETWEEN -1 AND 1 AND pan_y BETWEEN -1 AND 1),
	CONSTRAINT "item_artwork_slots_pad_color_check" CHECK(pad_color IS NULL OR (length(pad_color) = 7 AND pad_color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `item_artwork_slots_beat_id_idx` ON `item_artwork_slots` (`beat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `item_artwork_slots_item_slot_beat_unique` ON `item_artwork_slots` (`item_id`,`slot`,`beat_id`);