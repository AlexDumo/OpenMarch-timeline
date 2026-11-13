-- Pins, pathways step 5 (spec v0.10 J.1 K1, J.2, Appendix M): a route's points pinned to counts, as
-- JSON `{v, pins: [{point, at}]}`. Hand-written over drizzle-kit's output, which rebuilt the table
-- and copied a column that isn't there yet (`SELECT "timing" FROM timeline_routes`): SQLite adds a
-- nullable column with a CHECK in place, so no route is rewritten and no other table is touched
-- (ADR 0015, Consequences). The change-log and history triggers name their columns and are rebuilt on
-- open from this build's definitions. The app writes file version 15 with a file's first pin
-- (`fileVersion.ts`). Like 0021 it also runs, unrecorded, on a page-era file before its conversion
-- (`CONVERTER_SCHEMA_MIGRATION_TAGS`), because the resolver's cold build reads every column of
-- `timeline_routes`; the migration runners skip an ADD COLUMN whose column exists (`addColumnGuard.ts`).
ALTER TABLE `timeline_routes` ADD COLUMN `timing` text CONSTRAINT "timeline_routes_timing_check" CHECK(timing IS NULL OR json_valid(timing));
