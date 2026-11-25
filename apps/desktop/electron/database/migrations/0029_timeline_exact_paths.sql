-- Exact paths, ADR 0018 step 3 (spec Appendix M): a route may hold an exact path, one marcher's
-- walk as fixed shapes plus timing keys, as JSON. Hand-written over drizzle-kit's output, which
-- rebuilt the table and copied a column that isn't there yet (`SELECT "exact_path" FROM
-- timeline_routes`): SQLite adds a nullable column with a CHECK in place, so no route is rewritten
-- and no other table is touched. Every existing route is a drawn path (NULL). The change-log and
-- history triggers name their columns and are rebuilt on open from this build's definitions
-- (`createAllTriggers`, `createTriggers`). The app writes file version 19 with a file's first exact
-- path (`fileVersion.ts`), so a build without this migration refuses such a file; a file without
-- one opens in older builds as before, which never read or write the column.
ALTER TABLE `timeline_routes` ADD COLUMN `exact_path` text CONSTRAINT "timeline_routes_exact_path_check" CHECK(exact_path IS NULL OR json_valid(exact_path));
