---
phase: C2
title: Customization, props and items on the timeline
status: in-progress
owner: trevor
branch: none
pr: none
depends_on: [C1]
updated: 2026-10-16
---

# C2: Customization, props and items on the timeline

<!-- cspell:words playhead's -->

Follow the protocol in [../README.md](../README.md). Claim a work package before you start, and append to the progress log as you go.

> Draft for the owner's approval (2026-10-11). Everything here is timeline mode only and waits for the timeline merge (C1.3). The items migration follows ADR 0004's cue migration (C3.1).

## Goal

Props and row-backed equipment as `marchers` rows on the timeline, with their three beat-keyed tables (Outline geometry, Placement, artwork slot assignments), the put-down rule, items kept out of every all-marchers loop, and the show's notes list.

## Read first

- [../props-spec.md](../props-spec.md): the design spec, sections on items and Placement, notes, and platforms. Ticket numbers on each package are the ones it cites.
- [ADR 0002](../../adr/0002-3d-view.md) D-9, D-10 and D-22 (amendment of 2026-10-11)
- `CONTEXT.md`: **Item**, **Prop**, **Equipment**, **Outline**, **Placement**, **Crew**, **Off field**, **Hidden**, **Artwork slot**, **Depth**, **Floor prop**, **Roll-out**
- ADR 0001 and the timeline spec on `timeline/timeline-try-2` (resolver R-1, C-10 freeze, C-12 pages are flags)
- `research/props-in-timeline.md` (branch `research/props-in-timeline`); PR 1013 (`git show pr-1013:...`)

## Work packages

Each field is on its own line so that concurrent claims merge cleanly. Edit only the Owner, Status and PR lines of packages you own.

### C2.1: Rebuild PR 1013 on main with the timeline

- Owner: trevor (3d/c2-items-v2)
- Status: in-review
- PR: #278
- Parallel: no
- Depends on: C1.1, C1.3, C3.1

**Goal:** PR 1013's props, rebuilt on `main` for timeline mode, with the Outline geometry table. PR 1013 is the owner's and can change freely.

**Scope:** a branch off `main` (after the timeline merge) carrying PR 1013's work, PR into `main` like any `/3d-work` package. Keep the 2D Outline UI, `marchers.type`, `surface_type` and real units; rename `props` to `items` with `kind` = `prop` | `equipment` (`surface_type` for props only) and an optional Library model reference; drop `props.image` (artwork slots come in C2.4) and make `image_opacity` a 2D display preference; drop `prop_page_geometry` and every `marcher_pages` write; add a timeline create path (home where created, on field from that count; before it a created prop is Off field); add the beat-keyed Outline geometry table (item, beat, width, depth, height, rotation, outline type, custom outline, transition length, plus the Floor prop "rolls out" flag and leading edge) with latest-wins lookup, easing over the transition and beat-delete cascade, independent of moves; geometry, item and slot tables in undo history and repair like the cue tables; a drag of an Outline in the 2D editor writes a geometry change at the playhead's count (the same data the Items tab writes); one squashed migration numbered after the timeline's and ADR 0004's cue migration; wire C1.11's show Library prune to show close and before Save Copy, with the Item tables' Library references as `keep` (C1 handoff notes). Hidden stays `UiSettingsStore.hiddenPropIds`.

**Tickets:** 05, 07, 21, 23, 24, 26.7, 26.8, 26.15, 26.20, 26.22.

**Done when:** in a converted show, a prop can be created, moved by the timeline and resized at a count with no move (in the 2D editor too), nothing writes `marcher_pages`, and upstream PR 1013 (OpenMarch/OpenMarch) is closed with a link to the rebuild. The work goes upstream later with the rest of the 3D work.

**Checks:** schema, migration and history tests; geometry lookup unit tests; a focused e2e creating and resizing a prop; type-check, lint, format, spellcheck.

### C2.2: Keep items out of all-marchers loops

- Owner: trevor (3d/c2-items-out-of-loops-v2)
- Status: in-review
- PR: #279
- Parallel: yes
- Depends on: C2.1

**Goal:** props and equipment rows never act like performers.

**Scope:** filter by `type` in drill order, ripple orders, coordinate sheets, mobile export, drill numbers, the cue targets (band and section never reach items) and Visuals mode's Who list (with a cross-phase note to the cue work if it hasn't landed). Props may still fill formation slots.

**Tickets:** 24.

**Done when:** a show with props produces the same drill numbers, coordinate sheets and mobile export for its performers as without them.

**Checks:** unit tests per loop; type-check, lint, format, spellcheck.

### C2.3: Item Placement

- Owner: trevor (3d/c2-placement-v2)
- Status: in-review
- PR: none
- Parallel: yes
- Depends on: C2.1

**Goal:** where each item is, count by count.

**Scope:** the beat-keyed Placement table: held by one or more performers, each with a hand (left, right, both; hands needed from the model's `OM_grip_*`, else both); placed at the item's own position with an optional Crew; Off field (instant at its count). Item ripples as one row per item at staggered counts with a shared group id. Pure lookups: Placement at a count, hand conflicts (newest takes over at its count; the displaced item is not drawn), crew distance. An item that came from a flag reads as held by its original performer before its first row. Show setting "Warn when a prop moves without a crew", default off, stored in the show file. A visible trade of equipment between performers is a Placement change. Writes through `transactionWithHistory`; the table joins history and repair like the cue tables.

**Tickets:** 07, 21, 24, 26.12, 26.15, 26.19.

**Done when:** lookups and conflict detection match a fixture of held, placed, crewed, rippled and off-field changes.

**Checks:** unit and history tests; type-check, lint, format, spellcheck.

### C2.4: Artwork slot assignments

- Owner: none
- Status: open
- PR: none
- Parallel: yes
- Depends on: C2.1, C1.11

**Goal:** which Artwork sits on each item slot, from each count.

**Scope:** the beat-keyed table (item, slot, beat → Artwork Version), in history and repair, with fill or fit, pan and pad color on the assignment; a no-model prop's slots (top, plus front and back with height) or the model's declared slots; effective DPI per assignment and the "not print-ready" warning; dormant assignments when an update drops a slot, with the remap-to-same-size offer in "update available" and a quiet note; save-prune counts these references; the item slot picker writes a row here at the current count (the whole show while the slot has no changes), with the scope on the button and switchable.

**Tickets:** 05, 07, 08, 11, 26.1, 26.15.

**Done when:** an Artwork update that renames a slot keeps the old assignment dormant and restores it on revert.

**Checks:** unit and history tests; type-check, lint, format, spellcheck.

### C2.5: Put-down and Snap to holder

- Owner: none
- Status: open
- PR: none
- Parallel: yes
- Depends on: C2.3

**Goal:** a released item lands where its holder was.

**Scope:** on a held → placed change, write the item a move ending at the holder's position (the midpoint of the holders' hands for several); when the holder's drill later changes, the quiet note "put down away from its holder" with one-click "Snap to holder". No "follows marcher" span.

**Tickets:** 07, 24.

**Done when:** releasing, then editing the holder's drill, raises the note, and Snap to holder clears it in one undoable step.

**Checks:** unit and history tests; type-check, lint, format, spellcheck.

### C2.6: The show's notes list

- Owner: none
- Status: open
- PR: none
- Parallel: yes
- Depends on: C2.3

**Goal:** one quiet place for every check, never a modal or a block.

**Scope:** a notes model that names counts ("Flag not put down, count 9 of page 5"), shown on the thing and in a show-wide list. First producers: hand conflicts, crew distance, crew-less moves (when the setting is on), put-down drift. Later phases add fit, print, budget, platform, obstacle, Garment-fit, Horn/Equipment-mismatch and Silk-aspect notes. The list lives in Visuals mode (with a cross-phase note to C3.3 if Visuals mode hasn't landed); the 3D View shows a small note count for the moment viewed.

**Tickets:** 07, 18, 21, 24, 25, 26.16.

**Done when:** the four first producers show in the list and on their item, and none of them interrupts editing.

**Checks:** unit and component tests; type-check, lint, format, spellcheck.

## Exit gate

- [ ] In a converted show, props are created, moved, resized, held, put down, crewed and taken off field, all undoable.
- [ ] Drill numbers, coordinate sheets and mobile export ignore items.
- [ ] Type-check, lint, format and spellcheck pass on `main`.

## Handoff notes

- **The 2D editor is the three.js field (#209).** C2.1 was built on Fabric
  first and ported: items are drawn by `ItemsLayer` from `FieldItems`, hit
  inside their Outline by the editor's `itemAt` port, resized and turned by
  item handles (`editor/itemTransform.ts`), and drawn new by the prop tool
  (`editor/propTool.ts`), a mode like the line tool. Later packages that
  draw on the field go through the same seams (`docs/field/porting-fabric-features.md`).
- **Migration numbers:** items are 0024. C2.3's placements and C2.4's slot
  assignments follow as 0025 and 0026, each registering a rollback in
  `electron/database/__test__/migrationRollback.ts`.
- **Feet input** for Outline sizes waits on C1.4's `parseLength`; the Props
  panel takes meters until then.
- **Upstream PR 1013** gets closed with a link once the owner says so.

## Progress log

### 2026-10-16 · trevor (3d/c2-items-v2) · C2.1

- **Done:** migration 0024 (timeline-only) adds `marchers.type` (`marcher`
  | `item`, ADD COLUMN with a named CHECK), `items` (kind, props-only
  `surface_type`, an optional pinned Library Version, no FK) and
  `item_geometry` (beat-keyed Outline: size, height, turn, outline type,
  size-free custom outline, transition, roll-out and leading edge), in
  history and repair. `itemGeometryAt` in core eases a change over its
  transition; an item is Off field before its first change. The field draws
  each item as its Outline, selects it with a click inside, moves it
  through the timeline like any marcher, and resizes or turns it with its
  handles as an Outline change at the playhead, with no move. A Props panel
  draws new Floor props with PR 1013's five outline tools, lists them with
  hide and name toggles, and edits one at the playhead. Save prunes the
  show Library on close and before Save Copy, keeping what items pin.
- **Fixed on the way:** setting marcher homes returned every `marchers`
  column, which the page-to-timeline conversion reads before the
  timeline-only migrations add `type`; it returns ids now.
- **Checks:** desktop vitest (items, migrations, field, editor); core
  tests; `e2e/browser/tests/props.spec.mts` in the browser (7 scenarios);
  type-check, lint, format, spellcheck.

### 2026-10-16 · trevor (3d/c2-items-out-of-loops-v2) · C2.2

- **Done:** `isPerformer` / `performersOnly` (`Marcher.ts`) and
  `performersQueryOptions`. Items are left out of coordinate sheets and
  individual drill charts, the mobile export, the marcher list and section
  appearances, collisions (a performer on a platform isn't colliding with
  it), the Select tab and Ctrl/Cmd+A on the field, and the 3D View's
  performer figures. Drill numbering is untouched: items use their own
  PROP and EQUIP prefixes.
- **Cross-phase:** cue targets, ripple orders and the Visuals Who list
  belong to the cue code; check them when items get cues (C3.7).
- **Checks:** desktop vitest (full suite); type-check, lint, format,
  spellcheck.

### 2026-10-16 · trevor (3d/c2-placement-v2) · C2.3

- **Done:** migration 0025 (timeline-only): `item_placements` (held,
  placed, off_field; beat-keyed; optional ripple `group_id`) and
  `item_placement_marchers` (holders with a hand, crew with none), in
  history and repair. Core lookups `placementAt`, `handsAt`,
  `handConflicts` (newest wins), `crewDistances`, `crewOutOfReach`,
  `handsNeeded`. Writes: set, replace and delete a change, and item
  ripples by group, each one undo step; deleting a holder deletes a held
  change left with none. Placement changes on deleted beats carry forward.
  Show setting `warnPropMovesWithoutCrew`, off by default.
- **Calls:** whether an item came from a flag isn't stored; the lookup
  takes it as `origin`. A created item reads as placed before its first
  row. Holders and crew must be performers.
- **Left:** no UI yet; the Items tab (C3.7) and put-down (C2.5) use these.
- **Checks:** desktop and core vitest (full suites); migration tests;
  type-check, lint, format, spellcheck.
