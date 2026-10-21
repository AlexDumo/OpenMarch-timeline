CREATE TABLE IF NOT EXISTS `tempo_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`audio_offset_seconds` real,
	CONSTRAINT "tempo_settings_id_check" CHECK(id = 0)
);
--> statement-breakpoint
ALTER TABLE `measures` ADD `meter` text;--> statement-breakpoint
ALTER TABLE `measures` ADD `grouping` text;