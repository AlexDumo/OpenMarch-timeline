CREATE TABLE IF NOT EXISTS `item_geometry` (
	`id` integer PRIMARY KEY NOT NULL,
	`item_id` integer NOT NULL,
	`beat_id` integer NOT NULL,
	`outline_type` text NOT NULL,
	`width` real NOT NULL,
	`depth` real NOT NULL,
	`height` real DEFAULT 0 NOT NULL,
	`rotation` real DEFAULT 0 NOT NULL,
	`custom_outline` text,
	`transition_length` integer DEFAULT 1 NOT NULL,
	`rolls_out` integer DEFAULT 0 NOT NULL,
	`leading_edge` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`beat_id`) REFERENCES `beats`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "item_geometry_outline_type_check" CHECK(outline_type IN ('rectangle', 'circle', 'arc', 'polygon', 'freehand')),
	CONSTRAINT "item_geometry_size_check" CHECK(width > 0 AND depth > 0 AND height >= 0),
	CONSTRAINT "item_geometry_transition_check" CHECK(typeof(transition_length) = 'integer' AND transition_length >= 1),
	CONSTRAINT "item_geometry_custom_outline_check" CHECK(custom_outline IS NULL OR json_valid(custom_outline)),
	CONSTRAINT "item_geometry_rolls_out_check" CHECK((rolls_out = 0 AND leading_edge IS NULL) OR (rolls_out = 1 AND leading_edge IS NOT NULL AND leading_edge IN ('front', 'back', 'left', 'right')))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `item_geometry_beat_id_idx` ON `item_geometry` (`beat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `item_geometry_item_beat_unique` ON `item_geometry` (`item_id`,`beat_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `items` (
	`id` integer PRIMARY KEY NOT NULL,
	`marcher_id` integer NOT NULL,
	`kind` text NOT NULL,
	`surface_type` text,
	`library_item_id` text,
	`library_version_hash` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`marcher_id`) REFERENCES `marchers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "items_kind_check" CHECK(kind IN ('prop', 'equipment')),
	CONSTRAINT "items_surface_type_check" CHECK((kind = 'prop' AND surface_type IS NOT NULL AND surface_type IN ('floor', 'platform', 'obstacle')) OR (kind = 'equipment' AND surface_type IS NULL)),
	CONSTRAINT "items_library_check" CHECK((library_item_id IS NULL AND library_version_hash IS NULL) OR (library_item_id IS NOT NULL AND library_version_hash IS NOT NULL AND length(library_item_id) = 36 AND length(library_version_hash) = 64))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `items_marcher_id_unique` ON `items` (`marcher_id`);--> statement-breakpoint
-- Marcher type (props-spec section 4). Hand-edited from drizzle-kit's `__new_marchers` rebuild,
-- whose INSERT ... SELECT copied `type` from a table that doesn't have it yet. ADD COLUMN leaves
-- `marchers` and every row that references it untouched; the named CHECK matches the snapshot,
-- so `drizzle-kit generate` stays a no-op. Existing rows are performers.
-- Safe to run twice: the tables and indexes above are IF NOT EXISTS, and the migration runners
-- skip an ADD COLUMN the table already has (`addColumnGuard.ts`). It is dated after the Shape
-- tool's lab migration, so a lab file that took that one still takes this, and a file a fork
-- build gave this migration under its earlier date takes it again unharmed.
ALTER TABLE `marchers` ADD COLUMN `type` text DEFAULT 'marcher' NOT NULL CONSTRAINT "marchers_type_check" CHECK(type IN ('marcher', 'item'));