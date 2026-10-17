# Real-time collaboration: feasibility and architecture

Research branch `research/collaboration`, based on fork `main` at `72976f001` (timeline model).
The shipped page model is upstream `origin/main` (`4bc4eeb3e`). Written 2026-10-17. All paths are
under `apps/desktop/` unless they start with `packages/` or `docs/`.

## 1. TL;DR

- **Standard path, at the SQL layer, not at the JavaScript layer.** No single JavaScript mutation
  layer exists: about 75 files call `@/db-functions` directly, and 11 UI files build their own
  transactions. But every undoable show write passes through one function, `transactionWithHistory`
  (`src/db-functions/history.ts:99`, 89 production call sites). Each one lands in a table that SQLite
  triggers already watch. The timeline tables already have a working change feed (`timeline_change_log`, drained per
  transaction). If that feed is extended to every synced table, each committed transaction becomes
  one op, with **no call-site refactor**.
- **About eight paths are case-by-case.** They are `workspace_settings`, `view3d_cameras`,
  `audio_files` (raw SQL in the main process), the Library tables, the undo/redo replay, and the file
  lifecycle (create, convert, repair, migrate). The table in §3 lists each one, with an estimated effort.
- **The hard work is semantics, not plumbing.** Four problems carry most of the cost:
  - Row IDs are local `max(rowid)+1`, so two clients pick the same ID.
  - Timeline rows reference **beat ordinals** that every beat or page edit rewrites.
  - Undo replays full-row SQL by rowid, which would wipe out other people's edits.
  - `timeline_assignments.layer` is stored but is meant to be derived.
    All four have contained fixes (§5).
- **Recommended shape.** Keep local SQLite as the session's working mirror, so all existing reads,
  the resolver, the field and the 3D view work unchanged:
  - A client runs a command locally, and the transaction's row changes are sent as the op.
  - A Durable Object with SQLite storage runs **the same schema, CHECKs, triggers and
    `timeline_commit_violations` view**. It orders and validates each op, applies it with
    field-level last-writer-wins (LWW), and broadcasts the effective changes.
  - Each client applies remote changes the way it applies an undo today: no history, a drained
    change log for the resolver, and table-name invalidation.
- **Rough size.** A two-person v1 behind a flag is about 6–9 engineer-weeks after the timeline
  schema settles: capture and apply is about 2 weeks, IDs about 0.5, beat ordinals about 1–2, undo
  about 1.5, and the Durable Object about 1.5–2, plus presence, claims and the remaining paths. The
  solo path changes only by gaining a dormant trigger and an ID helper.

## 2. How data flows today

| Kind of state       | Where it lives                                                                                                                                                                                                                                                                                                                                                                              | Source of truth        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Show data           | SQLite file in the **main process**. On the web it runs in a worker on in-memory sqlite-wasm and is copied to the browser's private file storage (OPFS) (`web/worker/sqlite.ts`, `storage.ts`).                                                                                                                                                                                             | SQLite                 |
| Renderer access     | Drizzle `sqlite-proxy`. Every statement goes over IPC `sql:proxy` (`src/global/database/db.ts`, `electron/database/sqlProxy.ts`), one at a time, through a serial queue. Snapshot reads use `sql:read-batch`.                                                                                                                                                                               | –                      |
| Server-state cache  | TanStack Query. Each `src/hooks/queries/use*.ts` has a key base named after its table (`pages`, `beats`, `marchers`, `cues`, …).                                                                                                                                                                                                                                                            | Copies of SQLite       |
| Motion              | **Derived, never stored.** `useTimelineResolverStore` (`src/timeline/timelineStore.ts`) holds a `@openmarch/core` resolver, cold-built under `withTimelineWriteLock` and updated incrementally from `ChangeBatch`es. The field samples `positionsAt()` into a `PositionBuffer` (`src/field/three/fieldMarchers.ts`). The 3D window builds its own resolver (`src/view3d/positions.ts:118`). | Timeline tables        |
| UI state            | Zustand stores in `src/stores` and `src/timeline`, for example `TimelineSelectionStore` (selection, playhead, loop, start flag). Contexts hold `SelectedPageContext` and `SelectedMarchersContext`.                                                                                                                                                                                         | Local, per user        |
| User prefs, Library | electron-store (`electron/main/index.ts:106`), `localStorage` in 14 files, and `userData/library` (`electron/main/library/store.ts`).                                                                                                                                                                                                                                                       | Per user, not per show |

**Writes.** A command is a db-function that wraps `transactionWithHistory`, or UI code that composes
`*InTransaction` helpers inside one. The wrapper does four things:

- It serializes wrapped writes behind one promise lock (`withTransactionWithHistoryLock`).
- It bumps the undo group.
- After the callback, it checks `timeline_commit_violations` and drains `timeline_change_log`
  (`checkAndDrainTimelineChangesInTransaction`, `src/db-functions/timelineChanges.ts`).
- After the commit, it calls `notifyTimelineBatch`, then `bumpTimelineDisplayVersion`, then
  `notifyHistoryChange`.

**How the UI learns of changes.** There are three mechanisms:

1. **Manual invalidation per mutation.** Each `*MutationOptions.onSuccess` calls
   `invalidateQueries([KEY_BASE])`; about 40 files do this.
2. **Change-log batches** for motion. They feed the resolver, and the field redraws on
   `resolver.version`.
3. A **display-version counter** (`src/db-functions/timelineDisplay.ts`) for timeline rows that
   views read directly.

Undo and redo are the one place that invalidates **from table names**
(`tableNamesToQueryKeys`, `src/hooks/queries/utils.ts`). That path is the model for applying remote
changes. The 3D window is told about changes by IPC relay (`src/view3d/sync/useView3dPublisher.ts`
wraps `invalidateQueries`).

**Undo and redo.** SQLite triggers `_it`/`_ut`/`_dt` on every table in `tablesWithHistory`
(`src/db-functions/historyTriggers.ts:15`) write **inverse SQL text** into `history_undo`, keyed by
`rowid`. The update inverse sets _every_ column back to its old value. `performHistoryAction`
(`history.ts:945`) replays a group under the same lock, drains the change log, and returns the
tables it touched. The page model on `origin/main` uses the identical mechanism (123 matches in 27
files there, against 467 matches in 93 files on the fork).

**Source data versus derived data.**

- **Source data:** marchers (including `home_x`/`home_y`), beats (`duration`), measures, pages
  (`start_beat → beats.id`), the timeline tables (`timelines`, `timeline_shapes`,
  `timeline_transitions`, `timeline_assignments`, `timeline_slot_destinations`,
  `timeline_kept_assignments`), cues, tags, appearances, field properties, venue, and workspace
  settings.
- **Derived, never stored:** positions, timestamps (the `timing_objects` view), collisions, and path
  samples.
- **Derived but stored:**
  - `timeline_assignments.layer`. ADR 0001's 2026-10-16 amendment says layers are derived, but this
    checkout still picks them per edit (`stealLayer`, `src/db-functions/timelineCommands.ts:274`).
  - The timeline `start_beat`/`end_beat` **ordinals**, which `withTimelinePageRipple`
    (`src/db-functions/timelineRipple.ts`) rewrites on every beat or page edit.
  - `beats.position`, renumbered on insert and delete (`src/db-functions/beat.ts`).
  - The transition beat columns, which mirror their timeline (C-11).

## 3. Write-path inventory

| Path                                     | Where                                                                                                                                                                                                                                                                                                                                                                                 | Shared layer?             | Collaboration effort                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| db-function commands                     | 67 `transactionWithHistory` sites in 27 files of `src/db-functions` (`timelineCommands`, `timelineAssignmentEdits`, `beat`, `page`, `tag`, …)                                                                                                                                                                                                                                         | **Y**                     | None to capture (triggers)                                                    |
| UI-composed transactions                 | 22 sites in 11 files: `components/launchpage/newShowCompletion.ts`, `global/classes/FieldProperties.ts`, `components/timeline/audio/EditableAudioPlayerUtils.ts`, `components/music/TempoGroup/TempoGroup.ts`, `hooks/queries/{useMeasures,usePages,tags/mutations}.ts`, `components/music/MusicXmlImport.ts`, `components/inspector/PageEditorUtils.ts`, `global/classes/Measure.ts` | **Y** (the same wrapper)  | None to capture. Optional S: move into db-functions                           |
| Components calling db-functions directly | about 75 files, e.g. `TimelineModePanel.tsx:330` `movePageFlag`, `timeline/timelineTransitionEditor.ts:361`                                                                                                                                                                                                                                                                           | **Y** (callee wraps)      | None                                                                          |
| Inserts that rely on `max(rowid)+1`      | 25 `.insert(` calls, **all in `src/db-functions`**                                                                                                                                                                                                                                                                                                                                    | Y                         | **S**: one `insertRows` helper that sets an allocated ID                      |
| Undo/redo replay                         | `executeHistoryAction`, `history.ts`                                                                                                                                                                                                                                                                                                                                                  | Y (same lock, drains log) | **L**: redesign for sessions (§4.4)                                           |
| Workspace settings                       | `db-functions/workspaceSettings.ts:47`, a plain `db.transaction` with no history; a single JSON blob holding tempo defaults, project name, audio offset, …                                                                                                                                                                                                                            | **N**                     | S: wrap it, and LWW per JSON key                                              |
| Show cameras                             | `db-functions/view3dCameras.ts:updateShowCameras`, plain insert                                                                                                                                                                                                                                                                                                                       | **N**                     | S: move into history (or sync as a separate table)                            |
| Library embed                            | `db-functions/showLibrary.ts:embedLibraryVersions`, plain transaction into `library_blobs`/`library_items`                                                                                                                                                                                                                                                                            | **N**                     | M: content-addressed blobs go to R2; rows go as ops                           |
| Audio                                    | `audio:insert`/`update`/`delete`/`select`, raw SQL in the main process (`electron/main/index.ts:518`, `electron/database/database.services.ts:370-381`)                                                                                                                                                                                                                               | **N**                     | M: blob upload plus a metadata op. `selected` is per user and must stay local |
| File lifecycle                           | `database:create`/`load`/`save`/`repair`, migrations (`services/DrizzleMigrationService.ts`), convert on open (`database/convertOnOpen.ts`), new-show drafts                                                                                                                                                                                                                          | **N** (file-level)        | M: refuse during a session; convert before upload; the server owns migrations |
| History bookkeeping, trigger DDL         | `history_stats`, `historyTriggers.ts:315` (`unsafeSql:proxy`)                                                                                                                                                                                                                                                                                                                         | –                         | Excluded from sync                                                            |
| Per-user state                           | electron-store, `localStorage`, the user Library                                                                                                                                                                                                                                                                                                                                      | N (not show data)         | None: never synced                                                            |

**Verdict.** About 90% of show mutations by count, and all motion edits, already funnel through one
wrapper and a trigger-observed set of tables. Funneling the remaining paths is days of work, not a
rewrite.

What is not standard is **conflict meaning**. A transaction is a _result_ (row images), not an
_intent_. The server can order and validate results, but it cannot re-run "move these marchers 2
steps left" against newer state. For partitioned work under LWW that is acceptable (§5). If it ever
is not, specific commands can be lifted to intent ops later.

## 4. Recommended architecture

### 4.1 Operation model

One op is one committed local transaction:

```ts
interface Op {
  opId: string; // client UUID, for idempotent retries
  baseSeq: number; // last server seq this client had applied
  gridVersion: number; // beats/pages structure version the command was computed on (§5.3)
  label: string; // transactionWithHistory's funcName, for toasts ("Resize move")
  changes: RowChange[]; // raw log order
}
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
```

**Capture.** Generalize `timeline_change_log` into a `sync_change_log`, using the same trigger
style as `electron/database/migrations/triggers.ts`:

- Add AFTER INSERT, UPDATE and DELETE triggers on every synced table, writing `json_object(...)`
  before and after images.
- Gate them with `WHEN (SELECT recording FROM sync_state) = 1`, so a solo file pays one
  short-circuited `SELECT` per write.
- `transactionWithHistory` drains the log beside the timeline drain, diffs before and after into
  `set`/`prev`, and hands the op to a sender after the commit.

The timeline log stays as it is, because the resolver contract depends on it (ADR 0001 §5).

**IDs.** On join, the server leases each client a block, for example `2^40 × clientIndex`. In a
session, `insertRows` sets `id` explicitly from that block, so IDs are global and never reused. Solo
files keep `max+1`. This is a refactor of the 25 insert sites, not a schema change.

### 4.2 Applying remote ops

Add `applyRemoteChanges(changes)` beside `executeHistoryAction`. It runs inside
`withTransactionWithHistoryLock` and does five things:

1. Sets `sync_state.recording = 0` and turns off the undo triggers. Use the same `WHEN` gate;
   history must not record remote rows.
2. Runs the row statements with `PRAGMA foreign_keys = OFF`, as undo already does, because the
   server's order is already valid.
3. Drains `timeline_change_log`, then calls `notifyTimelineBatch`, so the resolver updates
   **incrementally**.
4. Calls `bumpTimelineDisplayVersion` when the batch touches display tables.
5. Invalidates `tableNamesToQueryKeys(tables)`, which is undo's own refresh path.

Nothing above the data layer needs to know whether a change came from a person, an undo or a peer.

**Optimistic local edits.** The command already ran against the mirror, so the UI is current. The
client keeps a queue of unacknowledged ops. A remote change to a field that has a pending local
write is skipped, as in Figma's LWW model; the server's ack brings the final value.

A skipped value is not thrown away. It becomes the `prev` of the earliest pending op that writes
that field, so if that op is refused, the revert lands on the server's value, not a stale one. The
prototype's stale-grid case depends on this: an insert-time op arrives while a resize is pending.

On a **reject**, the client does three things:

1. Applies the op's `prev` images in reverse order, skipping fields that a later pending op rewrote.
2. Applies the server's catch-up.
3. Shows a toast that gives the server's reason.

**On disconnect**, the client reverts every unacknowledged op and refuses edits until it is
reconnected. Ops belong to the connection they were sent on: a message queued before a drop must
never go out on the next socket.

### 4.3 Local SQLite during a session

Local SQLite is a **mirror and cache, never the authority**. The session file can be a temp copy
(`<show>.session.dots`), so the person's local file is never mixed with session state. "Leave
session" or "Save a copy" writes a snapshot.

Keeping it buys a lot. Every query, the resolver, exports, the 3D window and the web build keep
working with zero changes, and the server can ship a snapshot as a plain `.dots` file.

### 4.4 Undo with several people

Use per-user, selective undo, as Figma and Google Docs do:

- In a session, the local undo stack holds this user's **acknowledged ops**, not trigger SQL.
- Undo builds the inverse from the op's own `prev`/`row` images, **field by field**. A field whose
  current value no longer equals what this user wrote has been changed by someone since; it is
  skipped, and a toast names who changed it.
- An insert's inverse is a delete, which is skipped if others now reference the row. A delete's
  inverse re-inserts the row with the same ID; global IDs make that safe.
- The inverse goes out as an ordinary op, and redo is its inverse.

The existing `history_undo` trigger path stays for solo files. Its full-row `UPDATE … WHERE rowid=`
inverse (`buildHistoryTriggerSql`) must **never** run in a session, because it would revert other
people's columns.

### 4.5 Server (Worker plus one Durable Object per show)

**Responsibilities:**

- Accept WebSockets using the hibernation API.
- Assign `seq`, apply each op in one `transactionSync`, and broadcast `{seq, by, effective changes}`.
- Relay presence, which is never stored.
- Hold claims and roles.
- Lease ID blocks.

**Persistence:**

- The show lives in DO SQLite (`ctx.storage.sql`) using the **same migrations** (Drizzle has a
  `durable-sqlite` driver).
- Keep an op log for catch-up (the last N ops, or ops since `seq`; otherwise send a snapshot).
- Store snapshots in R2 for "download the file" and for audio and Library blobs.

**Validation** (an op is all or nothing):

- **Identity and role:** claims, and head-writer-only actions.
- **Allowlist:** only synced tables and columns.
- **Constraints:** the schema's CHECKs, FKs and timeline invariant triggers; they come free from
  running the same DDL.
- **`timeline_commit_violations`** must be empty after the op.
- **`gridVersion`** must be current for ops that write beat columns (§5.3).
- **Op size limits.**

The server never runs the resolver or db-functions in v1. Validating structure is enough, because
clients derive positions themselves.

## 5. Hard cases

1. **Stacked and overriding moves.** Two people add overlapping moves for the same marcher. Both
   rows survive; neither one is a conflict. **Who wins is decided by the timeline, not by who wrote
   last**, using the 2026-10-16 amendment's rule: page moves underneath, the later start wins, and
   on the same start the shorter one wins. This works only if `layer` is truly derived. So:
   - finish the amendment;
   - have the server, or every client after apply, re-derive layers for the touched marchers and
     write them as a follow-up change in the same `seq`;
   - exclude `layer` from LWW.

   Until then, two concurrent `stealLayer` calls can store the same layer for both moves, and
   `timeline_asn_overlap_*` makes the server reject the second op. That is safe but annoying. The
   same-range L-4 refusal stays a server rejection.

2. **Delete versus edit.** The delete wins. An update or insert that references a missing row or
   parent fails its FK or `RESTRICT` check, so the whole op is rejected. The loser's toast reads
   "Sam deleted this move". The timeline's child-first deletes (C-1) and `ON DELETE CASCADE` from
   marchers run on the server, so the broadcast carries the cascade and no client re-derives it.
3. **Inserting time, beats and pages.** This is the worst case. Timeline rows store beat
   **ordinals**, so inserting 4 beats at ordinal 20 rewrites every later row
   (`withTimelinePageRipple`). An op computed on the old grid would land 4 beats off.
   - **v1:** every client tracks a `gridVersion`, bumped by any op that touches `beats`, `pages`
     or `measures`. Ops that write beat columns carry their `gridVersion`; a stale one is rejected,
     and the client retries on the new grid with a toast. Structural edits are rare and could be
     head-writer only.
   - **Later:** store timeline edges as `beats.id` (as `pages`, `measures` and `cues` already do),
     so ordinals become derived and the ripple disappears for beat inserts. That is an ADR 0001
     change, and the resolver keeps integer beats through a map at the host.
4. **Composite edits that span rows.** A "move" is a timeline, its transitions, assignments and
   destinations, with transition ranges mirroring the timeline (C-11). Field-level LWW across two
   ops can break that mirror. The server's commit-violation check catches it and rejects the later
   op. This is acceptable because it needs two people on the same move at the same moment.
5. **JSON blobs.** `timeline_shapes.geometry` and the `workspace_settings` JSON are single fields,
   so two edits to one shape mean that one loses entirely. Accept this for shapes (show the conflict
   toast), and split `workspace_settings` into per-key LWW.
6. **Marchers added together.** `UNIQUE(drill_prefix, drill_order)`: two people adding "T5" means
   the second op is rejected with "taken". This is a natural candidate for a head-writer-only action.

## 6. Rules for new features

1. **Every show mutation goes through `transactionWithHistory`**, and through a db-function where
   possible. No plain `db.transaction` writes, and no main-process SQL for show data.
2. **Every new show table goes in `tablesWithHistory` and in the synced-table list**, or is
   explicitly marked per user or bookkeeping. One list should drive history, sync capture and
   invalidation.
3. **Inserts go through the ID helper.** Never rely on `max(rowid)+1`, and never reuse IDs.
   Cross-table references use IDs, not positions or ordinals.
4. **No stored derived data.** If a value can be recomputed (positions, layers, ordinals, counts),
   compute it. If it must be cached, keep it out of the synced set and rebuild it after apply.
5. **The UI refreshes from table names or the change feed**, not only from a mutation's
   `onSuccess`. A remote write has no mutation, so anything that refreshes only in `onSuccess`
   goes stale.
6. **Per-user state stays out of show tables.** Selection, `audio_files.selected`, view, playhead
   and camera choice are presence or per-user state.
7. **Prefer columns to JSON blobs** for anything two people might edit independently.
8. **Commands must be valid on any server state, or fail cleanly.** Cross-row invariants live in
   the DDL or the commit-violation view, so the server enforces them without the app's code.

**What will fight us:**

- Beat ordinals and their ripple.
- Stored layers, until the amendment lands.
- Full-row rowid undo.
- `max+1` IDs.
- Main-process audio SQL.
- `workspace_settings` as one blob.
- Manual per-mutation invalidation (40 files).
- Throwaway resolvers built inside write transactions (`timelineMoves.ts`, `timelinePointMoves.ts`,
  …). These are correct but make commands expensive to re-run, which is one more reason to ship
  results, not intents.

## 7. Assumptions and open questions

**Assumptions:**

- The timeline model on fork `main` is the target, since the page era is dropped on conversion
  (`0020_drop_page_era`). The page model is mapped above for completeness. A page-model session
  would sync `marcher_pages` rows by the same mechanism, with the same ID and undo problems, and no
  beat-ordinal problem.
- "Online-only" means no queued offline ops, so a disconnected client shows read-only and catches
  up with ops after its last `seq` (or a snapshot).
- Audio, artwork and Library blobs go to R2 by content hash. Only metadata rows sync.

**Open questions for you:**

1. Do structural edits (beats, pages, tempo, inserting time) need to be head-writer only in v1? It
   would remove most `gridVersion` rejections.
2. Should claims be by **section**, by **marcher set**, or by **time range** (for example "I own
   counts 1–64")? Time-range claims fit the timeline model and partitioned choreography well.
3. Does a session file stay linked to the local file ("save back"), or does leaving a session
   always produce a new copy?
4. Should the migration of timeline edges to `beats.id` happen before collaboration ships? It is
   the single change that most reduces risk.

## 8. Prototypes

The prototypes are in [`prototypes/collaboration/`](../../prototypes/collaboration/README.md). They
are one small app: a Worker and one Durable Object per show, and a plain-JS client whose local
mirror is sql.js. Built that way, they exercise the architecture above directly:

- Commands write SQL in a local transaction, and capture triggers turn it into an op (§4.1).
- Remote changes are applied with recording off (§4.2).
- The Durable Object validates each op by running **the same DDL** (§4.5).

The "move" is a simplified timeline row, and positions are derived on every client.

To run them: `cd prototypes/collaboration && pnpm install --ignore-workspace && pnpm dev`, then
open <http://localhost:8787>. Two scripted checks run against it:

- `pnpm smoke` covers the server protocol.
- `pnpm check:browser` runs a two-window walkthrough of each prototype in headless Chromium. Each
  walkthrough also checks that both windows converge.

Both passed on 2026-10-17.

| #   | Prototype                                                                              | What it taught                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [Live sync](../../prototypes/collaboration/01-live-sync/README.md)                     | SQL-layer capture needs nothing from commands. The only design work was IDs (explicit IDs from a per-member block) and the beat grid (ops carry `grid_version`).                                                                                                                       |
| 2   | [Presence](../../prototypes/collaboration/02-presence/README.md)                       | Presence is a separate channel: relayed, never ordered or stored. The app already holds what it needs (`TimelineSelectionStore`, the field editor's pending drag), except that `SelectedMarchersContext` holds objects, not IDs. A Durable Object socket attachment is capped at 2 KB. |
| 3   | [Soft section claims](../../prototypes/collaboration/03-section-claims/README.md)      | Claims need a server-side "which marchers does this op touch" function per table. In the real schema that walks shape → transition → assignment → marcher. Structural edits can't respect claims, so they are head-only.                                                               |
| 4   | [Conflict feedback](../../prototypes/collaboration/04-conflict-feedback/README.md)     | A per-field "last seq and writer" table plus `baseSeq` is enough to tell "replaced unseen work" from an ordinary edit. Feedback works at the row level, and "Put mine back" is just a new op built from `lostValue`.                                                                   |
| 5   | [Disconnect behavior](../../prototypes/collaboration/05-disconnect/README.md)          | Online-only means three rules: revert unacknowledged ops, refuse edits, catch up from `lastSeq`. The one real bug was a queued message going out on the next socket.                                                                                                                   |
| 6   | ["Make collaborative"](../../prototypes/collaboration/06-make-collaborative/README.md) | The snapshot is small (about 820 moves and 78 KB for a 95-marcher show) because positions aren't uploaded. The flow is a conversion and should reuse `ConvertShowDialog`'s confirm-first shape. The creator reloads from the server's snapshot, so every client starts identical.      |

**Not prototyped:**

- Per-user undo (§4.4).
- Moves into shapes, and the derived-layer write-back (§5.1).
- R2 blobs.
- Auth: a session is open to anyone with its link, and the head drill writer is whoever holds a
  token in that tab.

**Tooling note.** The repo's wrangler 4.94 runs workerd 2026-05-28, so the prototype's
`compatibility_date` is set to 2026-05-01.
