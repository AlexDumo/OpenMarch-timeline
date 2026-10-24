CREATE TABLE `saved_shapes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`kind_version` integer NOT NULL,
	`intervals` text NOT NULL,
	`description` text,
	`distribution` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	CONSTRAINT "saved_shapes_intervals_check" CHECK(json_valid(intervals)),
	CONSTRAINT "saved_shapes_distribution_check" CHECK(distribution IS NULL OR json_valid(distribution))
);
