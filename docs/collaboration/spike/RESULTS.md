# Collaboration spike: results (WP-E)

<!-- cspell:words collab swiftshader numstat -->

Measured on 2026-10-17 at `research/collab-spike` `b85b297b2` (WP-A, WP-B, WP-C merged), against
`timeline/main` `72976f001` (the merge base). WP-D (per-user undo, presence) was still in progress
in another worktree; its rows say **WP-D pending**. Machine: the 12-core Linux box, shared with
other agents (load average about 2), so treat small differences as noise.

## Verdict

- **Kill criterion: not triggered.** No feature knows about sync. Outside `src/sync/`,
  `src/db-functions/` and `sync-server/`, one product file changed: `src/App.tsx`, by 2 lines.
- **Solo is unchanged.** Solo edits run exactly the same SQL statements as on `main`, and the time
  per edit is within noise.
- **A peer's edit is drawn in 20 to 100 ms** against a local server, in the browser harness and in
  Electron. The bar is under 250 ms. Real network round trips are not measured yet.
- **In a session, a local edit costs 0.1 to 0.5 ms more** at the database layer. That is 2 extra
  statements per edit (3 for an insert).

## 1. Kill criterion audit

`git diff --numstat timeline/main...research/collab-spike -- apps/`: 37 files, +5470 / −73. Outside
`apps/`, only docs and prototypes changed.

| Group                    | Files                                                                                                                                                                                                       |                Lines (+/−) | What                                                                                                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/sync/` (new)        | 9 product files and 1 test                                                                                                                                                                                  | 1787 / 0 product, 457 test | Capture, drain, apply/revert/join, ids, session, connection, `SyncHost` UI                                                                                                                                                                  |
| `src/db-functions/` hook | `history.ts`                                                                                                                                                                                                |                     23 / 0 | `transactionWithHistory`: `if (session)` gate (read-only refusal), drain before commit, `onLocalOp` after commit; undo/redo refused in a session (until WP-D)                                                                               |
| `src/db-functions/` ids  | `beat`, `cues`, `marcher`, `measures`, `page`, `phraseAssets`, `sectionAppearance`, `tag`, `timelineAssignments`, `timelineShapesInTransaction`, `timelineTransitionsInTransaction`, `timelines` (12 files) |                   127 / 67 | **All mechanical**: 17 insert sites wrap their values in `withSessionIds(tx, table, values)`, plus the import. Most of the line count is re-indentation (`timelineAssignments` 25/22, `timelineTransitions` 25/14). No other logic changed. |
| `sync-server/` (new)     | 10 files (2 generated)                                                                                                                                                                                      |                   2571 / 0 | Worker + Durable Object, schema dump script, smoke test                                                                                                                                                                                     |
| Tests / harness          | `e2e/browser/collab.mts` (new), `tests/collaboration.spec.mts` (new), `e2e/browser/fixtures.mts`                                                                                                            |                    503 / 6 | `fixtures.mts`: 5 things exported, plus an optional `hostInstance` so a second window can run in the same process                                                                                                                           |
| **Other product files**  | `src/App.tsx`                                                                                                                                                                                               |                      2 / 0 | Mounts `<SyncHost />`                                                                                                                                                                                                                       |

**Insert sites.** `grep -rn "\.insert(" src | grep -v __test__` finds 25 in product code. 17 are
wrapped. The other 8 are fine as they are:

- `view3d_cameras`, `workspace_settings`, `library_blobs` and `library_items` are out of scope.
- `utility` and `view3d_venue` have fixed ids.
- `timeline_kept_assignments` and `page_performer_settings` are keyed by another table's id.

**Is there feature-specific sync code? No.** No feature module imports sync. The command palette
entries use the existing `usePaletteSource`, and the timeline, field and query layers are untouched.
`src/sync/` still knows a few schema facts by name. These are table registration, not feature
code:

- the grid rule's structural tables (`isStructural`: `beats`, `pages`, `measures`);
- the rows whose triggers refuse a delete (`isProtectedRow`: beat 0, page 0, the `utility` row);
- two tables whose key isn't `id`.

**Ongoing cost.** Every new insert of a synced table needs `withSessionIds`. Nothing enforces this
yet. If a site is missed, a solo show still works, but in a session the row would get a local
autoincrement id that can collide with another member's. A lint rule or a guard in the capture
trigger would close this gap.

## 2. Solo performance

**Benchmark:** `apps/desktop/src/db-functions/__test__/writeBenchmark.test.ts`. It is skipped
unless `OM_WRITE_BENCH` is set. To run it:

`OM_WRITE_BENCH=/tmp/bench OM_WRITE_BENCH_LABEL=x pnpm exec vitest run --silent=true src/db-functions/__test__/writeBenchmark.test.ts`

- **Data:** the `marchersAndPages` fixture (76 marchers, 6 pages, converted to timelines).
- **Connection:** real `node:sqlite` through the app's `handleSqlProxyWithDb`, with every
  statement counted. There's no IPC; see §4.
- **Workloads:** a timeline move of 1 marcher ×40, a move of 10 marchers ×20, and creating 1
  marcher ×15.
- **Rounds:** 7 per run, plus one warm-up. The mode order alternates between rounds.
- **Runs:** 3 per checkout, alternating base and spike. The base was a temporary detached worktree
  of `72976f001` with the same file copied in; it has since been removed.

Median time per edit (ms), with the range of the 3 run medians:

| Edit           | `main` (base)      | spike, solo        | Statements per edit, base → spike |
| -------------- | ------------------ | ------------------ | --------------------------------- |
| move 1 marcher | 1.30 (1.292–1.309) | 1.27 (1.263–1.273) | 21 → 21                           |
| move 10        | 2.62 (2.610–2.639) | 2.57 (2.559–2.582) | 30 → 30                           |
| create 1       | 1.66 (1.662–1.669) | 1.64 (1.640–1.641) | 23 → 23 (first edit 129 → 129)    |

The spike is 1 to 3% faster, which is within run-to-run noise. The statements are identical:
`diff base-1-statements-solo.txt measure-1-statements-solo.txt` shows no difference across one
edit of each workload. Solo creates no temp objects, so the solo path adds only the
`getSyncSession()` check in `transactionWithHistory` and `withSessionIds`. The test "solo: no temp
objects, and inserts keep their usual ids" in `src/sync/__test__/sync.test.ts` covers the same.

## 3. Session overhead

Same benchmark, after `startCapture` and `setSyncSession({ isLive: () => true, onLocalOp: no-op })`:

| Edit           | Solo | Session (3 runs)   | Overhead       | Extra statements                                       |
| -------------- | ---: | ------------------ | -------------- | ------------------------------------------------------ |
| move 1 marcher | 1.27 | 1.36 (1.343–1.367) | +0.08 ms (+6%) | +2: `SELECT … FROM temp.sync_change_log`, `DELETE`     |
| move 10        | 2.57 | 3.06 (3.026–3.090) | +0.5 ms (+19%) | +2 (the triggers' `json_object` work is inside SQLite) |
| create 1       | 1.64 | 1.84 (1.826–1.855) | +0.2 ms (+12%) | +3: also `SELECT max(id)` from `withSessionIds`        |

Applying the same ops on a fresh copy, as a remote peer would (`applyRemoteChanges`):

| Op             | Time    | Statements |
| -------------- | ------- | ---------: |
| move 1 marcher | 0.51 ms |         16 |
| move 10        | 1.19 ms |         34 |
| create 1       | 0.57 ms |         16 |

In Electron, each statement is also one renderer-to-main IPC round trip (`sql:proxy`). So the
session cost per edit is 2 or 3 round trips more than the times above.

## 4. Remote latency (browser harness)

`pnpm run build:browser`, then `pnpm run e2e:browser e2e/browser/tests/collaboration.spec.mts`.
4 runs, all passed (14–16 s each), with 6 drags per run.

- **Columns:** times are in ms, from the sender's commit (its `local` event). `received` is the
  socket message arriving at the peer. `writeMs` is the peer's `applyRemoteChanges` plus
  invalidation. `drawn` is when the peer's field shows the new position.
- **Run medians** for `drawn`: 50, 34, 41 and 49 ms.

| Path            |   n | ack       | received | writeMs    | applied    | drawn          |
| --------------- | --: | --------- | -------- | ---------- | ---------- | -------------- |
| browser→browser |  24 | 23 (9–28) | 2 (1–2)  | 39 (26–57) | 41 (28–59) | **42 (29–59)** |

**Where the time goes.** The network and server take 1–2 ms on loopback. Nearly all the rest is
the peer's write.

The harness carries every SQL statement as a Playwright-exposed function: a CDP round trip
between Chromium and the test's Node process. Both windows' databases live in that one Node
process, so they share its event loop. With about 16 statements for a 1-marcher op, that is about
2 ms per statement.

In Electron, each statement is an `ipcRenderer.invoke` to the main process, which runs
`node:sqlite` synchronously. That is normally cheaper. The Electron numbers in §5 agree: when
Electron is the receiver, `writeMs` is 22 ms. The `ack` (10–25 ms) is not on the local edit's
path, because edits apply optimistically.

## 5. Electron check

**This worked.** `e2e/browser/tests/collaboration-electron.spec.mts` (new) runs in the
`electron-scenarios` project:

- **Window A** is the built Electron app (`pnpm run build`, Electron 40.8.5 / Chrome 144,
  `file://` origin).
- **Window B** is the browser harness (`openPeer`).
- Both use a local `wrangler dev` sync server.
- Everything ran in the `openmarch-e2e` Docker image under Xvfb with SwiftShader GL. The
  `~/om-capture/e2e` script was used, plus a mount of `~/.cache/ms-playwright` so window B's
  Chromium could start: `/tmp/spike-electron-run.sh`.

The scenario:

1. A makes the show collaborative and B joins.
2. A creates 4 marchers, and they appear in B.
3. 4 drags from A to B, then 3 from B to A.
4. Both canvases match their files, and the synced tables are equal.

It ran 4 times and passed every time (18–22 s).

**Local Network Access.** The first run granted `local-network-access` as the browser test does.
The last 3 runs gave Electron **no** permission grant. The only change was lifting the fixture's
"no network" route for the server URL. HTTP and WebSocket from `file://` to `127.0.0.1` both
worked, so Chromium's Local Network Access check does not block the shipped app's origin.

| Path             |   n | ack        | received | writeMs    | applied    | drawn           |
| ---------------- | --: | ---------- | -------- | ---------- | ---------- | --------------- |
| Electron→browser |  16 | 19 (13–29) | 6 (3–14) | 53 (38–91) | 67 (41–99) | **67 (41–100)** |
| browser→Electron |  12 | 11 (9–30)  | 3 (3–7)  | 22 (16–36) | 27 (19–42) | **28 (20–44)**  |

All numbers are under one container with software GL; the receiving harness window is the slow
side. **Screenshots:** `/tmp/spike-shots/electron-window-a.png` (Electron, chip "live · 2 here")
and `/tmp/spike-shots/browser-window-b.png`.

**Not verified:**

- a packaged or signed build (`electron-builder`);
- macOS and Windows, including their Local Network Access behavior;
- two Electron instances;
- a real (non-loopback) network.

## 6. Web editor

`pnpm run web:build` **succeeds** (built in 8 s, no errors).

**Capture on sqlite-wasm (quick check).** The 63 capture triggers that `captureTriggerSql`
generates for the synced tables were run on `_blank.dots`, deserialized into
`@sqlite.org/sqlite-wasm` 3.53.4 under Node (the same build the web worker uses):

- The TEMP tables and TEMP triggers were created.
- An insert, update and delete of a marcher were all logged with `json_object` rows.
- `0.1 + 0.2` came back exactly as `0.30000000000000004` (`printf('%!.17g')`).

The web worker shares one SQLite connection per show (`web/worker/sqlite.ts`), so temp triggers
see every write, as on desktop.

**Not run:** a session in the web editor itself.

## 7. Acceptance criteria (REPORT, "Decisions from the review")

| #   | Criterion                       | Status              | Evidence                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A peer's edit shows in < 250 ms | **Met (locally)**   | Medians 28–67 ms, worst 100 ms (§4, §5). Loopback only: add the real round trip to a Cloudflare location.                                                                                                                                                                                                                          |
| 2   | Local edits as fast as solo     | **Met, small cost** | Optimistic, with no wait on the server. +0.08 to 0.5 ms and 2–3 statements per edit at the database layer (§3).                                                                                                                                                                                                                    |
| 3   | No silent overwrite             | **Partly**          | The server's LWW records conflicts, which the smoke test covers. `SyncHost` shows toasts, but they use raw table and column names. No app scenario has two people editing the same field. Conflict feedback: **WP-D pending**.                                                                                                     |
| 4   | No silent loss                  | **Partly**          | Refused ops are reverted, with a toast. Unconfirmed ops are reverted on disconnect, with a "dropped" toast. Edits made offline are refused under a read-only banner, which the scenario covers. An edit in flight at disconnect is lost (with a notice), because the spike is online-only. Not tested with a conflicting scenario. |
| 5   | Undo never touches others' work | **WP-D pending**    | Today, undo and redo are refused in a session (`SyncUndoUnavailableError`).                                                                                                                                                                                                                                                        |
| 6   | Presence always visible         | **WP-D pending**    | Today, only the "live · N here" chip exists (screenshot above).                                                                                                                                                                                                                                                                    |
| 7   | Solo unchanged, by measurement  | **Met**             | Identical statements, timings within noise, no migration and no persistent object (§2).                                                                                                                                                                                                                                            |

## 8. Known gaps (from CONTRACT "As built" and MIGRATIONS.md)

- **Not synced:**
  - blob columns (`field_properties.image`; the server refuses an op that writes one and drops them
    from snapshots);
  - `workspace_settings`, which holds tempo and synced counts until MIGRATIONS' Option B;
  - `view3d_cameras`, `audio_files` and the Library tables.
- **Remote apply runs with foreign keys `OFF`** (CONTRACT deviation). It relies on the sender's
  cascades being in the op and on the server's check.
- **Online only.** Unconfirmed ops are reverted on disconnect. Built-in undo is refused in a
  session until WP-D lands.
- **Beat ids are not built.** Ops that write beats, pages, measures or timeline beat ranges carry a
  grid version and are refused `STALE_GRID` when stale. Every beat or page edit still rewrites
  later timeline rows.
- **Derived layers are not built.** `layer` syncs as an ordinary field, and merged values are
  trusted.
- **Waiting on in-progress branches** (MIGRATIONS.md):
  - tempo / endless counts (#280, #182): `workspace_settings` data, lazy beat appends, refresh;
  - split move (#266): page-move inference by lowest id breaks with per-member id blocks;
  - shape recipes (#181, #288): sync as is, plus an overlay refresh;
  - show cameras (#267): one row per camera under history;
  - previews and dry runs: safe as designed.
- **Session ids are an unenforced convention** (§1).
- **No accounts, links, R2 or version history.** The spike uses dev names and a dev owner token.
- **Not measured:**
  - real network latency;
  - about 10 people at once;
  - large shows (the benchmark uses 76 marchers);
  - the web editor in a session;
  - a packaged app on macOS or Windows.
