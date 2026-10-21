CREATE TABLE `saved_shapes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`kind_version` integer NOT NULL,
	`intervals` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "saved_shapes_intervals_check" CHECK(json_valid(intervals))
);
