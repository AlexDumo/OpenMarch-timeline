# Collaboration spike: contract

<!-- cspell:words collab -->

The go/no-go spike decided on 2026-10-17 ([REPORT.md](../REPORT.md), "Decisions from the review").
It syncs **marchers and timeline moves** between two windows of the real app, against a local
Worker and Durable Object (`wrangler dev`, no Cloudflare account). This file is the interface
between the client work (WP-A, WP-C) and the server work (WP-B), so they can be built in
parallel. The prototypes in `prototypes/collaboration/` are the working reference for every
behavior here; port from them freely.

**The spike is measured, not shipped.** Its kill criterion: it must need **no per-feature sync
code** beyond registering tables, and touch **only a handful of files** outside `src/db-functions/`
(and the new sync code). Every file touched outside those is listed in the measurement (WP-E), with
the reason.

## Scope

- In: every table in `tablesWithHistory` (`src/db-functions/historyTriggers.ts`) syncs. That covers
  marchers, beats, pages, measures, the timeline tables and the rest, because capture is generic.
  The scenarios exercise marchers and timeline moves.
- Out:
  - `workspace_settings`, `view3d_cameras`, `audio_files` and the Library tables (MIGRATIONS.md);
  - accounts (dev names and a dev owner token);
  - R2, version history, view-only links;
  - beat ids and derived layers (MIGRATIONS.md; the spike keeps the grid-version rule and treats
    `layer` as an ordinary field).
- Web editor: the same renderer code, so it should work there too, but the spike's checks run in
  the browser scenario harness (`apps/desktop/e2e/browser`) and, once, in Electron.

## Solo stays untouched

Nothing about a solo show changes:

- no migration and no new persistent table, trigger or column;
- no extra statements per write.

Capture objects are `TEMP` (connection-local) and created only when a session starts. The renderer's
SQL all runs on the main process's one persistent connection (`getPersistentConnection` in
`electron/database/database.services.ts`), so temp triggers see every renderer write. The only
check on the solo path is a JS `if (session)` in `transactionWithHistory`.

## Capture (client)

On session start, create:

```sql
CREATE TEMP TABLE sync_change_log (seq INTEGER PRIMARY KEY, tbl TEXT NOT NULL, row_id INTEGER NOT NULL, before TEXT, after TEXT);
CREATE TEMP TABLE sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), recording INTEGER NOT NULL);
-- per table in tablesWithHistory, from pragma_table_info, the prototype's captureDdl() shape:
CREATE TEMP TRIGGER <t>_sync_ins AFTER INSERT ON main.<t> WHEN (SELECT recording FROM temp.sync_state) = 1 BEGIN ... json_object(...) ... END;
-- and _sync_upd, _sync_del
```

Rows are keyed by `rowid`. Every synced table's key is its rowid alias (`id`, or `assignment_id`
for `timeline_kept_assignments`). WP-A confirms this per table and lists any exception.

**Drain.** Inside `transactionWithHistory`, after `checkAndDrainTimelineChangesInTransaction` and
before commit:

1. Read `sync_change_log` in `seq` order, delete its rows, and coalesce them into `RowChange[]`
   (the prototype's `coalesceLog`).
2. After commit, hand the op to the session's sender.
3. A rolled-back edit sends nothing.

## Op (client to server)

```ts
type RowChange =
  | { kind: "insert"; table: string; id: number; row: Record<string, unknown> }
  | {
      kind: "update";
      table: string;
      id: number;
      set: Record<string, unknown>;
      prev: Record<string, unknown>;
    }
  | {
      kind: "delete";
      table: string;
      id: number;
      prev: Record<string, unknown>;
    };

interface Op {
  opId: string; // crypto.randomUUID()
  baseSeq: number; // last server seq applied to this client's file
  gridVersion: number; // the grid version the op was computed on (see below)
  label: string; // transactionWithHistory's funcName
  changes: RowChange[];
}
```

`table` is the real SQLite table name. Values are as SQLite returns them: numbers, text, null.
Blobs are out of scope.

**Grid version.** "Structural" means any change to `beats` or `pages` (insert, delete, or update of
`position` or `start_beat`), or to `measures`. Rules:

- An op containing a structural change, **or** one writing `start_beat`/`end_beat` of
  `timelines`, `timeline_transitions` or `timeline_assignments` (including their inserts and
  deletes), must carry the server's current `gridVersion`, or it is refused `STALE_GRID`.
- The server bumps `gridVersion` after applying a structural op.
- The grid version is session state held by the server and echoed in `welcome` and `applied`.
  It is not a table.

## IDs

On `welcome` the server gives each member `idBase = memberIndex * 2 ** 40`, with member index ≥ 1.
In a session, every insert in `src/db-functions` gets an explicit id: the next free id in
`[idBase, idBase + 2 ** 40)` for that table, through one helper (`withSessionIds` or similar).
Solo inserts are unchanged. The 25 insert sites are listed by
`grep -rn "\.insert(" apps/desktop/src --include=*.ts | grep -v __test__`.

## Protocol (WebSocket JSON, one socket per client)

Messages from the client:

- `hello { user: {id, name, color}, ownerToken?, lastSeq }`. `lastSeq = -1` asks for a snapshot.
- `op { op }`
- `presence { presence }`. Opaque; relayed and never stored.

Messages from the server:

- `welcome { you: {user, role: "owner" | "editor", idBase}, seq, gridVersion, snapshot? | ops? }`.
  `snapshot` is `{ [table]: row[] }` over the synced tables; `ops` are applied-op messages after
  `lastSeq`.
- `applied { seq, opId, by: user, label, changes, conflicts, gridVersion }`. `changes` are the
  effective changes, with `prev` as the server had them.
- `rejected { opId, code, message }`. `code` is one of `STALE_GRID`, `DELETED`, `CONSTRAINT`,
  `NOT_ALLOWED`, `MALFORMED`.
- `people { people: [{user, role, presence}] }`

HTTP endpoints:

- `POST /api/sessions` with body `{ snapshot }` returns `{ sessionId, ownerToken }`. This is "make
  collaborative".
- `GET /api/sessions/:id/snapshot` returns `{ seq, gridVersion, snapshot }`, or 404.
- `GET /api/sessions/:id/ws` is the WebSocket upgrade.

Conflicts use the prototype's shapes (`kind: "overwrite" | "deleted-edited"`, `loser`,
`lostValue`, …).

## Server rules

The server runs **the app's real schema**: a DDL dump of `electron/database/migrations/_blank.dots`
after migrations. That means its tables, indexes, views (including `timeline_commit_violations`)
and the invariant triggers from `migrations/triggers.ts`. It excludes the history triggers, the
change-log triggers and `history_*` tables, and is generated by a script.

Each op is applied atomically (`transactionSync`, deferred foreign keys) and checked in this order:

1. Allowlist: tables and columns come from the dump, minus excluded tables.
2. Grid version.
3. CHECK, UNIQUE, FK and trigger constraints.
4. `SELECT * FROM timeline_commit_violations` must be empty after the op.
5. Field-level LWW with `field_versions` and `tombstones`, exactly as in
   `prototypes/collaboration/server/session.js`.

The op log is kept for catch-up. Every connected member is an editor; the owner is identified by
`ownerToken`, with no extra powers in the spike.

### As built (WP-B, `apps/desktop/sync-server/`)

These pin down details the sections above leave open:

- Every WebSocket message has a `type` field naming it: `{ type: "hello", user, ownerToken,
lastSeq }`, `{ type: "op", op }`, `{ type: "applied", ... }` and so on.
- `welcome.ops` are full `applied` messages (with `type: "applied"` and `gridVersion`).
- Changes and conflicts use `id`, not the prototype's `key`. Conflicts are `{ kind: "overwrite",
table, id, col, loser, lostValue, value, marcherId }` and `{ kind: "deleted-edited", table, id,
col, loser, marcherId }`; `marcherId` is set for `marchers` and `timeline_assignments` rows.
- An op whose `opId` is already in the log is not applied again; its stored `applied` message is
  sent back to the sender only.
- An `insert` row may omit its key column; the server sets it to the change's `id`, and refuses a
  row whose key differs from `id`. An `update` can't change a row's key.
- Blob columns (`field_properties.image`) are not synced: an op writing one is `NOT_ALLOWED`, and
  `POST /api/sessions` drops them from the snapshot and lists them in its response as
  `droppedColumns`. Snapshots from the server never contain them.
- `POST /api/sessions` answers 400 `{ error }` for a snapshot that names an unsynced table or
  column, or that breaks a constraint or `timeline_commit_violations`.
- Snapshot rows must be inserted parent-first (the `order` in `generated/tables.json`): the
  timeline `BEFORE INSERT` triggers look up parent rows at once, whatever the FK deferral. This
  applies to the client's join (replace-all) too.
- The order of checks is: shape (`MALFORMED`), allowlist, grid version, then the apply with
  constraints, foreign keys and `timeline_commit_violations` (each refused as `CONSTRAINT`), with
  LWW conflicts recorded as rows are written. Timeline trigger messages pass through as they are
  (`E-A1/E-A2: assignment outside transition range or slot_count`); commit violations read
  `E-T6: shapeless transition has 1 of 2 destinations (transition 1)`.
- Deferred foreign keys are checked with `PRAGMA foreign_key_check` before the transaction ends,
  because a failing commit resets a Durable Object (see the server's README).

## Remote apply (client)

`applyRemoteChanges(changes, { skip })` sits beside `executeHistoryAction`, under the same write
lock. It must not touch undo history:

- Run the statements with `recording = 0`.
- Remove any `history_undo` rows they generated, and restore `history_stats.cur_undo_group`.
  Clearing the redo stack is acceptable, because in-session undo is per user.
- Defer foreign keys.
- Then drain `timeline_change_log`, call `notifyTimelineBatch`, bump the display version when needed,
  and invalidate `tableNamesToQueryKeys(tables)`, as undo does.

**Join** replaces the contents of every synced table with the snapshot (same mode), then emits a
timeline `reset` and invalidates every query. Pending local ops, shadowing and revert-on-refusal
follow `prototypes/collaboration/public/client/connection.js`.

## Session states

- `live`: edits allowed.
- `connecting` / `offline`: `transactionWithHistory` refuses with a typed error, and the UI shows
  read-only. Unacknowledged ops are reverted on disconnect.

Built-in undo/redo (`performHistoryAction`) is refused in a session until per-user undo (WP-D)
replaces it.
