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

### As built (WP-A, `apps/desktop/src/sync/`)

- Capture: `startCapture(db)` / `stopCapture(db)` in `capture.ts`, run under the write lock. The
  triggers are `<t>_sync_ins|upd|del`. REAL values are printed with 17 significant digits (as
  the timeline change log does), so they round-trip exactly. BLOB columns
  (`field_properties.image`) are left out of every image, snapshot and apply.
- Keys: every synced table has an `INTEGER PRIMARY KEY`, so `RowChange.id` is the rowid and the
  key column is also in `row` / `prev`: `id` everywhere except `timeline_kept_assignments`
  (`assignment_id`) and `page_performer_settings` (`page_id`). `marcher_tags`, `cue_marchers`
  have their own `id`. `readSyncedTables` refuses a table without one.
- Session: `setSyncSession({ isLive, onLocalOp, idBase })` in `session.ts`. `onLocalOp({ label,
changes })` runs after commit, inside the write lock, so ops are handed over in commit order.
  Refusals are `SyncReadOnlyError` (edit while not live) and `SyncUndoUnavailableError`
  (`performUndo`, `performRedo`, `performHistoryAction` in a session).
- IDs: `withSessionIds(tx, table, values)` in `ids.ts`, at every insert site of a table with an
  `id` key. The first id in a block is `idBase` itself. Tables keyed by another table's id
  (`timeline_kept_assignments`, `page_performer_settings`) and fixed-id rows (`utility`,
  `view3d_venue`) keep their explicit keys.
- **Deviation:** remote apply runs with `PRAGMA foreign_keys = OFF` (as undo does), not deferred
  foreign keys. The changes already hold every cascade the sender's database ran, so cascading
  again on the receiver would be wrong, and the server has already checked the result.
- Join (`replaceAllSyncedTables`) diffs the snapshot against the rows: changed rows are deleted
  and inserted again (not updated), all deletes children-first, then inserts parents-first,
  because the timeline invariant triggers check every statement. Beat 0, page 0 and the utility
  row are updated in place, because their triggers refuse a delete. Parent-first order is
  computed from `pragma_foreign_key_list`; it is the same rule as the server's `tables.json`.

## Session states

- `live`: edits allowed.
- `connecting` / `offline`: `transactionWithHistory` refuses with a typed error, and the UI shows
  read-only. Unacknowledged ops are reverted on disconnect.

In a session, `performHistoryAction` hands undo and redo to the session's per-user undo (WP-D);
the raw `history_undo` replay (`performUndo`, `performRedo`) is still refused there.

### As built (WP-D, `src/sync/undo.ts`, `presence.tsx`)

- **Delegation.** `SyncSession` has optional `historyAction(type, { currentPageId })`,
  `historyStackLength(type)` and `onRefused(label)`. `performHistoryAction` returns
  `historyAction`'s result (the same response shape), and `getUndoStackLength` /
  `getRedoStackLength` read the per-user stacks, so the shortcut, buttons and focus code are
  unchanged. A session without `historyAction` still throws `SyncUndoUnavailableError`.
- **Stacks.** An entry is the server's effective `changes` of one of my ops, pushed on its
  `applied`; local ops are tagged edit, undo or redo when sent (an undo tags its own op from inside
  its transaction). A refused or dropped undo puts its entry back. Undo first waits (up to 3 s) for
  my pending ops to be acknowledged, so an edit just made is on the stack.
- **Planning** (`planInverse`, pure): field by field against a last-writer map fed from every
  `applied` (a delete records its user under column `*`). `created_at`/`updated_at` are never
  reported, and a row with only those left is not written. Structural entries (CONTRACT's
  `isStructural`) are refused if anyone else's beat-writing op (structural, or `start_beat` /
  `end_beat` of the timeline tables) has seq above theirs, or if any field was skipped.
- **Order** (`orderForTriggers`): deletes children first, then updates in inverse order, then
  inserts parents first (table order from `readSyncedTables`).
- **Cascades.** After writing, the undo reads `temp.sync_change_log`; a row touched beyond the
  plan (a foreign-key cascade) whose last writer is someone else refuses the undo.
- **Focus.** The undo's timeline batch is caught from `subscribeTimelineChanges` and given to
  `timelineHistoryFocus`, as solo undo does.
- **Feedback.** `onRefused` raises one "offline, read-only" toast (sonner id `sync-read-only`);
  conflicts are grouped per loser, row and kind; the loser of an overwrite gets "Put mine back",
  which writes `lostValue`s back through `transactionWithHistory`.
- **Presence** is `{ selection: number[], playhead, loop }` (spec beats), published from
  `SelectedMarchersContext` and `TimelineSelectionStore`, at most every 50 ms and only when it
  changes, and again after each `welcome`. Rendered by `SyncPeopleList` (chip popover, "Go to"
  seeks my playhead and sets my loop), `SyncTimelinePresence` (one line in
  `TimelineVariants.tsx`) and `SyncFieldPresence` (one line in `ThreeField.tsx`, reading the
  field's `FieldMarchers` and view store).
- **Test hook.** `window.__sync.holdIncoming(on)` holds received messages, to make two edits
  concurrent in a scenario.
