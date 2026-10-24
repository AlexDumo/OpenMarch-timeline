CREATE TABLE IF NOT EXISTS `sketch_files` (
	`sha256` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`data` blob NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "sketch_files_data_type_check" CHECK(typeof(data) = 'blob')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sketch_pins` (
	`id` integer PRIMARY KEY NOT NULL,
	`sketch_id` text NOT NULL,
	`page_id` text NOT NULL,
	`beat_id` integer,
	`opacity` real DEFAULT 0.5 NOT NULL,
	`position` text DEFAULT 'below' NOT NULL,
	FOREIGN KEY (`sketch_id`) REFERENCES `sketches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`beat_id`) REFERENCES `beats`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sketch_pins_opacity_check" CHECK(opacity > 0 AND opacity <= 1),
	CONSTRAINT "sketch_pins_position_check" CHECK(position IN ('below', 'above'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sketch_pins_sketch_id_idx` ON `sketch_pins` (`sketch_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sketches` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`field_json` text NOT NULL,
	`doc_json` text NOT NULL,
	`render_json` text,
	`thumbnail` blob,
	`sort_index` real NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "sketches_kind_check" CHECK(kind IN ('sketch', 'template'))
);
