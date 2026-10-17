# Sync server (collaboration spike)

<!-- cspell:words SAVEPOINT -->

The server half of the collaboration spike (WP-B in
[PLAN.md](../../../docs/collaboration/spike/PLAN.md)): a Worker plus one Durable Object per show,
speaking the protocol in [CONTRACT.md](../../../docs/collaboration/spike/CONTRACT.md). It runs
locally under `wrangler dev` only and is never deployed.

It is not a pnpm workspace package. It has no dependencies of its own: it uses the repository's
root `wrangler` (4.94.0) and `tsx`, and Node 24's built-in `node:sqlite` and `WebSocket`.

## Files

- `server/worker.js`: the HTTP endpoints, routing each session to its Durable Object.
- `server/session.js`: the Durable Object (`ShowSession`): schema, validation, LWW, op log.
- `server/schema.js`: the allowlist and the grid-version rules, read from `generated/`.
- `generated/schema.sql`, `generated/tables.json`: the app's schema, generated. Don't edit.
- `scripts/dump-schema.ts`: regenerates `generated/`.
- `scripts/smoke.mjs`: two scripted clients against a running server.

## Run

```sh
export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH   # Node 24
cd apps/desktop/sync-server
../../../node_modules/.bin/wrangler dev --port 8790 --ip 127.0.0.1
```

In another shell, with the server running:

```sh
cd apps/desktop/sync-server
node scripts/smoke.mjs        # BASE=http://127.0.0.1:8790 by default
```

It prints one `ok` or `FAIL` line per check and exits non-zero on a failure. Local Durable Object
state is kept in `.wrangler/` (git-ignored); delete it to start clean.

## Regenerate the schema

After a migration or a change to `electron/database/migrations/triggers.ts`:

```sh
cd apps/desktop
pnpm --filter @openmarch/core build    # once per checkout: the migration service imports it
pnpm exec tsx sync-server/scripts/dump-schema.ts
```

The script copies `_blank.dots`, runs the app's `DrizzleMigrationService.applyPendingMigrations`
on the copy (pending migrations, then every invariant trigger and view rebuilt by
`createAllTriggers`), and dumps `sqlite_master`. It leaves out the history triggers (`*_it`,
`*_ut`, `*_dt`), the timeline change-log triggers (`timeline_log_*`), the bookkeeping tables
(`history_*`, `timeline_change_log`, `__drizzle_migrations`) and the tables out of scope
(`workspace_settings`, `view3d_cameras`, `audio_files`, `library_blobs`, `library_items`). It fails
if a kept table, trigger or view refers to a left-out table, if the kept tables differ from
`tablesWithHistory`, or if a table's key isn't a rowid alias. `tables.json` lists the synced
tables parent-first (`order`), each table's key and columns, and what was left out.

## Durable Object SQLite notes

- `CREATE TABLE`, `CREATE INDEX`, `CREATE VIEW` (including the window function in
  `timing_objects`) and `CREATE TRIGGER` with `RAISE` all work, as do the JSON functions.
  `schema.sql` runs unchanged.
- Foreign keys are on and can't be turned off; `PRAGMA defer_foreign_keys = ON` works inside
  `transactionSync`.
- **A deferred foreign key that fails at commit resets the whole object**: the socket drops with
  1006 and no JavaScript error reaches the handler. So every op, and the snapshot upload, runs
  `PRAGMA foreign_key_check` on the tables it touched and the tables that reference them before
  the transaction ends, and refuses with `CONSTRAINT` instead.
- `BEGIN`/`SAVEPOINT`, `ATTACH`, `TEMP` tables, `PRAGMA journal_mode` and `sqlite_version()` are
  refused. None are needed here.
- `BEFORE INSERT` triggers check their parent rows immediately even with deferred foreign keys,
  so snapshot rows are inserted in `tables.json` `order` (parent first).
