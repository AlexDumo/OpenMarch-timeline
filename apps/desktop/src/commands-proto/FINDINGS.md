<!-- PROTOTYPE (fork #357 spike): throwaway, do not build on this. -->
<!-- cspell:words trumpts crete rifels mellos -->

# Command contract spike: findings

The question was whether draft ADR 0008's command contract (fork PR #373) holds
against the real app, and where it breaks. Branch `proto/command-contract`
from fork main 57943c741.

**What was built:** `contract.ts`, `query.ts` (a pure parser and resolver),
`sentence.ts`, five commands plus undo, redo and the D-8 legacy-action adapter
(`commands.ts`), a ctx builder (`ctx.ts`) with a React bridge (`bridge.tsx`),
`registry.ts` (list, run and batch, with instrumentation), and `agent.ts`
(`window.openmarchCommands` and a palette row).

**Evidence:** `e2e/browser/tests/commands-proto-agent.spec.mts` runs a
scripted agent session in Expert and in Basic. It writes
`run/{expert,basic}/transcript.md` (62 calls each, every JSON result) and
screenshots. Step numbers below (E12, B16) point into those transcripts.

## Blast radius (edits outside this folder)

| File                                              | Change                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/App.tsx`                                     | Imports. `installCommandsProto()` at module level. Mounts `<CommandsProtoBridge/>` inside the show's providers. |
| `src/shortcuts/palette/sources.ts`                | `PaletteContext.query` and `PaletteItem.pinned` (sources couldn't see the typed text).                          |
| `src/shortcuts/palette/CommandPalette.tsx`        | Passes `query` to sources and lists pinned rows first.                                                          |
| `e2e/browser/tests/commands-proto-agent.spec.mts` | New spec.                                                                                                       |

The palette needed two changes because no palette source can see the typed
text. A sentence surface needs the query in `PaletteContext`. `/` isn't on
main (it lives on `shapes/host`, #354), so only ⌘K was wired.

## 1. Context injection

Could every `run()` get everything from a handed-in ctx? **Yes, but only
because a mounted React component pushes four things into it.** Without that
bridge, no command can select, undo, read "playing" or change the page.

| ctx field                                                       | Where it really comes from                                                                                                                                                                                                     | Outside React?                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `db`                                                            | Module global, `global/database/db.ts:33`                                                                                                                                                                                      | Yes                                             |
| `queryClient`                                                   | Module global exported from `App.tsx:72`. Importing it makes a cycle (App → bridge → ctx → App); it works only because it's read lazily.                                                                                       | Yes, needs its own module                       |
| selection read/write                                            | `useState` in `context/SelectedMarchersContext.tsx:47`                                                                                                                                                                         | **No**, needs the bridge                        |
| `isPlaying`                                                     | `useState` in `context/IsPlayingContext.tsx:14` (`TimelineSelectionStore.playback` is a second source of truth)                                                                                                                | **No**, needs the bridge                        |
| select a page (page.addAt selects the new page, as the UI does) | `useState` in `context/SelectedPageContext.tsx:35`                                                                                                                                                                             | **No**, needs the bridge                        |
| undo/redo with focus restore                                    | The `usePerformHistoryAction` hook (`hooks/queries/useHistory.ts:106`) needs the selection and page contexts. The plain `performHistoryAction` (`db-functions/history.ts:965`) neither invalidates queries nor restores focus. | **No**, needs the bridge                        |
| "is a show open"                                                | `App.tsx`'s `databaseIsReady` is `useState`. The spike infers it from whether the bridge is mounted.                                                                                                                           | **No**                                          |
| mode, workspace, preview                                        | `EditorModeStore`, `WorkspaceViewStore`, `PreviewModeStore` (zustand)                                                                                                                                                          | Yes                                             |
| playhead, resolver                                              | `TimelineSelectionStore`, `timeline/timelineStore.ts:67`                                                                                                                                                                       | Yes                                             |
| field view                                                      | `useFieldViewStore` plus `setView` (`field/three/fieldNavigation.ts:46`). Module singletons, so there is only one field.                                                                                                       | Yes                                             |
| export dialog                                                   | `useAppDialogStore` (`stores/AppDialogStore.ts`)                                                                                                                                                                               | Yes; the modal is mounted only with a show open |
| measures (for `m5` as a beat)                                   | Only in the timeline view model, built by hooks (`useTimingObjects`)                                                                                                                                                           | **No**, so `beat` doesn't parse `m5`            |

Hidden globals inside write paths:

- `addPageFlagMutationOptions` reads `isBasicMode()` itself
  (`hooks/queries/usePageFlags.ts:53`). The command has to pass `splitMoves`
  from `ctx.mode`.
- Invalidation lives in mutation options (`useMarchers.ts:111`,
  `usePages.ts:57`), so each command has to copy it (see section 4).
- Drill-number allocation is inside a component (`MarcherForm.tsx:146-185`),
  and selection by section is inside `SelectTab.tsx`. The spike rewrote both.

## 2. Results

**Yes, mostly without re-querying.**

- `createMarchers` returns rows, so `changed.marchers` holds the ids (E4).
- `addPageFlag` returns the new page, its range and, in Basic, the split
  marcher ids (`AddedPageFlag.splitMoves`; B16).
- `select` reads the selection back after it commits.

The page **name** needed a re-read (`readPageGrid`).

Undo is the weak one. `performHistoryAction` returns `tableNames` and
`marcherIdsToSelect` as **Sets**, which JSON turns into `{}` silently. Table
names aren't the user's words either ("Undid an edit to utility, pages,
marchers", E18). `summary` also needs to be honest: Basic's page add says
"moves split" even when 0 were split (B16).

## 3. Undo

**One run is one undo step: yes.**

- `undoGroupsMade` was 1 for every write and 0 for select, focus and export
  (every step).

**A batch flattens into one step: yes, with `flattenUndoGroupsAbove`.**

- The groups went from 2 to 1 (E16, B16). One undo removed the tubas and the
  page together, and redo restored both (E18 to E21). The same held in Basic.

**Breaks:**

- **The flatten swallows other people's edits.** A command started while the
  batch ran committed between its steps and was merged in (E51: 3 groups
  before the flatten). One undo then removed the mellophone and both
  clarinets (E53 to E54). Flattening by group range can't tell actors apart.
- **Undo isn't per actor.** The person dragged T1 just after an agent batch.
  The agent's `edit.undo` then undid the **drag** (T1 went back to 90,90) and
  left the batch in place (E55 to E60).
- **There is nowhere to store a batch label.** `history_undo` is
  `(sequence, history_group, sql)` (`schema.ts:58`), so "Agent: …" can't be
  shown or used.
- **A failed step leaves earlier steps applied.** Each command commits its own
  transaction (`partialApplied`). A true atomic batch needs commands to expose
  `*InTransaction` bodies and run inside one `transactionWithHistory`. That
  lock is not re-entrant (`history.ts:36-46`), so a command can't simply call
  another command.

## 4. Freshness

Measured at the instant `run()` resolves (`debug.freshAtResolve`), and with
`show()` and `fieldTest` read in the same task:

- **Whenever the command awaits its own invalidation, everything agreed at
  resolve.** The database, the query cache, the resolver, `fieldTest`, the
  page and the selection matched on every step in both modes (E4, E13, E16).
- **The resolver and the field are fresh synchronously.**
  `transactionWithHistory` delivers the change batch before it releases the
  lock (`history.ts:241`).
- **The query cache is not.** A raw `createMarchers` without invalidation
  (E34) left the cache at 16 rows against 17 in the database. It was still
  stale after a frame and after 1 s, and fixed only by invalidating. So
  freshness is per-command discipline. Wrapping today's mutations as-is would
  be stale: several invalidate un-awaited (`void qc.invalidateQueries`,
  `useMarchers.ts:133`; `void invalidatePageQueries`,
  `usePageFlags.ts:69,119,134`).
- **The selection is readable only after React commits.** The bridge resolves
  a waiter in a layout effect; it takes about 15 ms.
- **On a freshly opened blank show the resolver reports `loading`.** So
  `view.focus` was refused ("The timeline is not ready (loading)", E1 list)
  until the first edit.

## 5. Availability with reasons

Every reason string is written in `commands.ts`. Nothing in the app returns a
reason.

| Refusal                                                                   | Where it came from                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| No show open                                                              | The bridge isn't mounted. Not exercised: the harness always opens a show.                    |
| Preview: "Preview edits nothing", "Preview has no selection" (E39 to E41) | `PreviewModeStore`                                                                           |
| Visuals: "Edits the drill. Switch from Visuals…" (E44 to E46)             | `WorkspaceViewStore` plus mode, re-deriving `isVisualsView`                                  |
| Not ready                                                                 | The resolver store's `status`                                                                |
| Playing                                                                   | The bridge (`IsPlayingContext`)                                                              |
| Web build                                                                 | `isWebBuild`. The export handler isn't even registered there (`useAppActionHandlers.ts:15`). |

Legacy actions through the D-8 adapter:

- `isActionEnabled` is a boolean. "alignHorizontally is disabled (no reason
  given)" came from an empty selection (E49). In Basic, "toggleWorkspace is
  disabled (no reason given)" is really "Basic has no Visuals" (B43).
- Basic **unregisters** actions: 90 of 103 have handlers against 92 in Expert
  (`splitSelectedIntoNewMove` and `mergeMoveIntoPage` vanish; B2 vs E2).
- The ADR says 102 actions; there are 103.

## 6. Selection outside React

What it took:

- The bridge holds a ref to the context. `set(ids)` fetches the `Marcher`
  rows from the query cache, because the setter takes rows, not ids. It calls
  the setter and waits for the commit.
- The provider then rewrites the selection in effects: it drops marchers that
  are hidden or gone (`SelectedMarchersContext.tsx:71-96`). So a command must
  read the selection back.

The real store move is moderate: 25 files use `useSelectedMarchers` and there
are 21 `setSelectedMarchers(` call sites. Do `IsPlayingContext` (24 files) and
`SelectedPageContext` (22 files) with it, or commands keep needing a bridge.

## 7. Parameters

`count`, `section`, `marchers` and `enum` covered the five commands.

- `beat` was ambiguous. The go-to box reads "7" as **page 7** and "m5" as
  measure 5 (`TimelineGeometry.ts:703`). Measures live in a React view model.
  So `beat` here only accepts plain numbers and `here`.
- Missing:
  - a **page** kind ("p3", page names "2A")
  - placement for `marchers.create` (home spots for now; the box tool needs
    the shape host)
  - a **section-or-family** kind
  - `enum` values that are ambiguous on purpose ("pdf" means two tabs; E36
    refuses with both)
  - `optional` vs `default` semantics: `beat` defaults to the playhead, which
    is state, not a constant

## 8. Serialization

Everything crossed the wire (`agent.ts` round-trips through JSON) because the
spike built plain results on purpose. The traps found:

- `Set`s in history responses.
- Errors: a raw SQLite failure message (the full SQL and its parameters) came
  through as `E_EXCEPTION` (E50). That's not safe or useful to show an agent
  or a person.
- `Marcher` rows carry timestamps. They're strings here, so they're fine.

## 9. Concurrency

- **Two creates at once in one section:** one succeeded. The other failed on
  `UNIQUE(drill_prefix, drill_order)` (E50), because both read the max drill
  number before either wrote. The read and the write have to be in one
  transaction. Today's form has the same race.
- **A batch with an edit started in between:** the edit was absorbed into the
  batch's undo step (section 3).
- **A batch while the person drags:** the drag landed after the batch here,
  and the agent's undo took the drag (section 3). A drag that commits _between_
  batch steps would be absorbed, as the mellophone was.
- The spike's instrumentation (`undoGroupsMade`) also miscounted under
  concurrency: it reported 1 for the failed create because the other run's
  group appeared in the window.

## 10. Sentence parsing

Ambiguities hit:

- **The grammar says `[who] verb`, but every natural example is verb first**
  ("focus T3", "create 12 trumpets", "export pdf"). The spike accepts both;
  who-first only for focus and select (E12).
- **`add`** is both "add 4 snares" and "add page at 17". `page 12` means beat
  12 here, but page 12 in the go-to box (E15).
- **Prefix collisions:** the drill number `M5` and the go-to's measure `m5`;
  `B17` (baritone) and a "b17" beat shorthand. `T1-T6` is a range, but
  `T1 - T6` is "T1 minus T6", and both parse (E10). Spaces change meaning.
- **Section words:**
  - "bass" matches three sections and is refused with all three (E29).
  - "tenor" silently became **Tenors** (drums), not Tenor Sax (E30).
  - "guard" is a family, not the Color Guard section.
  - Missing nicknames: mellos, bones, bari.
- **Left to right:** `T1-6, S2 & brass` gives T1 to T6, because `&` applies to
  everything before it (E9). People may read `&` as binding tighter.
- **Typos:** "crete 4 snares" fell through to the query parser. The message
  says "not a section…", with "create" as a suggestion (E33, screenshot 07). A
  verb typo should be caught as a verb.
- **"Matches nothing" vs "unknown":** "flutes" in a show without flutes is an
  error with the sections that exist (E31). That's right per D-7, but agents
  need to tell it apart from a typo by code.

## 11. Other breaks, and the contract change each implies

| Issue                                                                       | Implication                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalidation knowledge lives in mutation options                            | **Change:** a write helper that commits, then awaits the matching invalidation, used by every command; or make query freshness follow the change log as the resolver does.                                                            |
| Batch atomicity and actor separation                                        | **Change D-6:** run a batch as one `transactionWithHistory` over `*InTransaction` bodies (commands expose `runInTx`). Stop flattening by range. Add `actor` and `label` to history groups (a schema change, so it needs its own ADR). |
| Agent undo undoes the person's edit                                         | **Change:** an agent's undo targets its own group (by id), or refuses when the top group isn't its own.                                                                                                                               |
| Drill-number race                                                           | **Change:** allocate numbers inside the write transaction.                                                                                                                                                                            |
| Reasons only from hand-written checks                                       | **Keep D-4**, and put the workspace and Basic rules in one shared `available` helper. Today they're re-derived from three stores in three places.                                                                                     |
| Selection, playing and page are `useState`                                  | **Keep D-8.** Move all three, not just the selection.                                                                                                                                                                                 |
| `queryClient` in `App.tsx`                                                  | **Change:** move it to its own module (tiny).                                                                                                                                                                                         |
| `CommandParam.beat` vs page names and measures                              | **Change D-2:** add a `page` kind, and make `beat` accept `m5.3` once measures are readable outside React.                                                                                                                            |
| Palette sources can't see the query                                         | **Change:** surfaces need `query` in `PaletteContext`, or a dedicated command-line surface.                                                                                                                                           |
| Raw exception text reaches the agent                                        | **Change D-3:** map exceptions to codes; never pass SQL through.                                                                                                                                                                      |
| `run()` measured 80 to 400 ms per create (the first includes trigger setup) | **Keep.** Fine for agents.                                                                                                                                                                                                            |

## Verdict

**Held:**

- **D-3 results:** creates and page adds return ids for free.
- **D-4 reasons:** each refusal was easy to write once the state was readable.
- **D-7 query grammar:** the parser and resolver are pure and about 250
  lines, and ranges, families, `-`, `&` and suggestions worked first try.
- **D-1:** one registry serving the palette and the agent boundary was
  painless.
- **D-6 "one run = one step":** true for every command.

**Need changing:**

- **D-6 batches:** flattening by group range merges other actors' edits, has
  no label, and isn't atomic. Batches should run in one transaction, which
  means commands expose transaction bodies.
- **D-8:** the store move must cover the selection, playing, the selected page
  and history focus, not only the selection. Also add an awaited invalidation
  helper so freshness isn't each command's job.
- **D-2:** add `page`. Settle `beat` against the go-to grammar.
- **D-9:** an agent-scoped undo is needed before agents get `editsDrill`.

**Phase 1 should be:**

1. Selection, playing and selected page into zustand, and `queryClient` into
   its own module. Then delete the bridge.
2. A write helper (transaction plus awaited invalidation plus an error-to-code
   mapping).
3. Commands as `{available, runInTx | run}`, batch = one transaction.
4. The query parser (as here, with nicknames, plus a binding rule for `&`).
5. The registry with the five commands and the legacy adapter, palette-only.

Agent exposure (MCP) waits for actor-scoped undo and history labels.
