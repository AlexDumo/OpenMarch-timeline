-- Linked Adjusts, pathways step 26 (ADR 0015 §2, spec v0.10 J.1 and J.2): an Adjust profile shared by
-- a sub-group of a group path's lanes, each lane pointing at it by `group_adjust_id`, and a spot's
-- own Adjust added on top (R-14′ item 7). Hand-written over drizzle-kit's output, which rebuilt
-- `timeline_lanes` and copied a column that isn't there yet: a new table, then a nullable column with
-- its CHECK and foreign key added in place, so no lane is rewritten and a file without a sub-group is
-- unchanged. The change-log and history triggers are rebuilt on open from this build's definitions.
-- The app writes file version 16 with a file's first linked Adjust (`fileVersion.ts`). Like 0021 it
-- also runs, unrecorded, on a page-era file before its conversion (`CONVERTER_SCHEMA_MIGRATION_TAGS`),
-- because the resolver's cold build reads every column of `timeline_lanes`: `IF NOT EXISTS` and the
-- runners' skip of an ADD COLUMN whose column exists (`addColumnGuard.ts`) make a second run safe.
CREATE TABLE IF NOT EXISTS `timeline_route_adjusts` (
	`id` integer PRIMARY KEY NOT NULL,
	`route_id` integer NOT NULL,
	`profile` text NOT NULL,
	FOREIGN KEY (`route_id`) REFERENCES `timeline_routes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "timeline_route_adjusts_route_id_type_check" CHECK(typeof(route_id) = 'integer'),
	CONSTRAINT "timeline_route_adjusts_profile_check" CHECK(json_valid(profile))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `timeline_idx_route_adjusts_route` ON `timeline_route_adjusts` (`route_id`);--> statement-breakpoint
ALTER TABLE `timeline_lanes` ADD COLUMN `group_adjust_id` integer REFERENCES `timeline_route_adjusts`(`id`) ON UPDATE no action ON DELETE restrict CONSTRAINT "timeline_lanes_group_adjust_id_check" CHECK(group_adjust_id IS NULL OR (typeof(group_adjust_id) = 'integer' AND offset_x IS NOT NULL));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `timeline_idx_lane_adjust` ON `timeline_lanes` (`group_adjust_id`);
