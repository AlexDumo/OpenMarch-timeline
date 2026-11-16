<!-- cspell:disable -->

# Roster changes 03: pathways, holds and placeholder dots

Fact-finding for "how should a designer delete (or add) a marcher in a show that already
exists?". Read-only, 2026-11-16.

- **main** = fork main at `e5e2b3a30` (`/mnt/ssd/worktrees/claude/OpenMarch/roster-changes`).
- **PH** = `pathways/host` at `38be62da0` (tip as of today, not in main).
- **FACT** = read in code, docs or GitHub. **INFERENCE** = my reading, not checked by running.

## Summary

1. A **slot** is an anonymous spot in a move's transition; an assignment puts a marcher in it
   (spec D-4). On PH a **lane** binds a slot (not a person) to a drawn route, with its offset and
   Adjust.
2. **Deleting a marcher today drops its lane and Adjust in most shows.** Compaction removes the
   vacated slot's lane (AP-R15 step 1). The owner's "empty spot keeps path and Adjust" (Q1) only
   holds where nothing is compacted: stored-shape (`dest_shape_id`) moves and follow moves.
3. **Casting anyone into a laned move is refused** ("This edit can't keep a drawn path yet").
   Cast, recast and slot change all refuse (`timelineAssignmentEdits.ts:38–44`). AP-R16 (recast
   offset follows the new person) is specified, not built. **No UI calls the casting procedures
   at all**, on main or PH.
4. A new marcher can join an existing group path only via **Rejoin**, and only once it already has
   a row in that move. It gets a new lane on its own slot, not the empty spot's Adjust.
5. Follow-the-leader: a deleted member **leaves a gap** (AP-T6, built). FTL Adjust (step 27) is
   not built.
6. Pathways: 17 step PRs merged on PH, 4 open (#900 3c, #903 5, #907 10, #908 26). Not started:
   **12** (spots change hands, range occupancy, AP-R16), **17** (exact splits), 25, 27, 8, 11, 13,
   14, 16, turns.
7. **Holds** are per-marcher rows (`timeline_held_marks.marcher_id`, ON DELETE CASCADE). Delete
   drops them; add creates none. #1015 ("Held whole" shapes) is open, not merged.
8. **Placeholder dots do not exist as a feature.** The data model already allows vacant slots
   (D-13) and recipe holes. #358 (shapes with unassigned spots) is the only plan, and it has no
   design. Upstream has no plan.
9. Show-level data keyed by marcher id: assignments, held marks, recipe members, tags, items, and
   (in open PR #1010) `cue_marchers`. All cascade. Uniforms and section looks are keyed by section.
10. `.ompb` (schema#1) requires every marcher on the field for the whole show. It cannot express
    a placeholder or a mid-show entry.

## 1. Slots, lanes and what deletion or casting does

### What the pieces are

| Thing           | What it is                                                                                                                                                                        | Source                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Slot            | An anonymous spot of a transition. "Lets a designer author a 16-person circle before deciding who is in it."                                                                      | FACT: spec D-4 (main `docs/timeline/spec.md:117`)                                      |
| Vacant slot     | A slot with no assignment. Valid, flagged `D-VACANT`, not an error.                                                                                                               | FACT: spec D-13 (main `spec.md:126`); PH makes it per range (`spec.md:1286`)           |
| Assignment      | Marcher `m` in slot `k` of transition `T` over `[start, end)`. `marcher_id` ON DELETE CASCADE. Still `UNIQUE(transition_id, slot_index)` and `UNIQUE(transition_id, marcher_id)`. | FACT: PH `electron/database/migrations/schema.ts:571–611`                              |
| Route           | A drawn path, absolute field points. No owner column.                                                                                                                             | FACT: PH `schema.ts:412–430`; ADR 0014 §1                                              |
| Lane            | `(transition_id, slot_index) → route_id`, plus `offset_x/y` (start offset; NULL = own path) and `adjust` (JSON profile).                                                          | FACT: PH `schema.ts:514–568`; ADR 0015 §1 (PH `docs/adr/0015-lanes-on-slots.md:68–95`) |
| Adjust          | A displacement profile keyed by places on the route. Belongs to the spot, not the person (D-22).                                                                                  | FACT: ADR 0015 §2, §4 (`0015…:96–156`); spec D-22 (PH `spec.md:156`)                   |
| Detach / Rejoin | Detach copies the route; Rejoin re-points the lane back and drops the Adjust (Q4). `timeline_route_sources` (K6) arrives with #900, not merged.                                   | FACT: ADR 0015 §3; plan tracker row 3c (PH `implementation-plan.md:355`)               |
| FTL trail       | A follow move's `route_id` on the transition. Trails write no lanes today.                                                                                                        | FACT: PH `schema.ts:452–457`; no lane writes in `src/db-functions/timelineTrails.ts`   |

Owner decisions that bear on roster changes (FACT, ADR 0015 PH `0015…:57–64`):

- **Q1:** an emptied spot keeps its lane and Adjust for whoever is cast there next. The path goes
  only when no lane has an occupant.
- **Q2:** on a recast the start offset follows the new person; path and Adjust stay with the spot.
- **Q3:** an FTL Adjust is keyed by slot, so it stays with the marcher.
- **Q4:** Rejoin after Detach always drops the Adjust.
- "Marchers needn't own a spot forever": occupancy by count range (§4, I-A4′/I-A5′). **Not built**
  (step 12): the two UNIQUE indexes are still there.

### Deleting a marcher (main and PH)

Path: `deleteMarchers` (main `src/db-functions/marcher.ts:238–266`) →
`removeDeletedMarchersFromTimelinesInTransaction` (`timelineMarchers.ts:155–177`, `compact: true`)
→ `removeAssignmentRowsInTransaction` → delete the marcher row (cascades) → delete empty recipes.
One undo step. FACT.

| Case                                                         | What happens to the slot                                                   | What happens to its lane / Adjust                                           | Source                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Marcher alone in a one-slot transition                       | Transition deleted                                                         | Lanes deleted (AP-R3); route goes if no other occupied lane (AP-H3)         | FACT: PH `timelineMembership.ts:549–560`, `:676–679`; spec AP-R3 (`spec.md:3045`) |
| Shared **shapeless** transition (points; what recipes write) | Compacted: the top slot's occupant moves down into the hole with its point | **Vacated slot's lane is deleted**; the moved occupant's lane moves with it | FACT: PH `timelineMembership.ts:578–646`; spec AP-R15 step 1 (`spec.md:3058`)     |
| Shared `dest_shape_id` (stored-shape) transition             | Left vacant                                                                | Lane and Adjust kept (Q1) while another lane of the route has an occupant   | FACT: `timelineMembership.ts:561–566`; AP-R15                                     |
| Transition sharing a marcher with an inheriting FTL move     | Left vacant                                                                | Kept (Q1)                                                                   | FACT: same lines                                                                  |
| FTL **trail** move                                           | Left vacant: "leaves a gap"; order and everyone's end spot stay            | No lanes involved; with nobody left the transition and its route go         | FACT: spec AP-T6 (PH `spec.md:3381`); `timelineMembership.ts:549–560`             |
| Last occupant of a group path leaves                         | —                                                                          | Route and all its lanes deleted (AP-H3)                                     | FACT: PH `timelineLanes.ts:150–177`                                               |
| Inspector "remove assignment"                                | Left vacant (no compaction)                                                | Lane kept (Q1)                                                              | FACT: PH `timelineAssignmentEdits.ts:509–523`. **No UI calls it** (see below)     |

INFERENCE: app-made shapes are recipes over points (ADR 0006: "the positions themselves are
ordinary destinations", main `schema.ts:606–612`; #505 removes the spec-shape code). So on today's
shows a deleted marcher's spot is compacted away, and **Q1 almost never applies on delete**. The
spec's own example QA-AP-L5 (PH `spec.md:3225`) shows both branches. The model-c scenario S-13 #4
("Its lane goes; arc slot left vacant", `model-c/02-scenarios.md:340`) assumed a shaped move.

### Adding a marcher / casting into an empty spot

| Action                                                                             | Today                                                                                                 | Source                                                                                                                        |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Add marcher                                                                        | Gets a home only; no moves, no slot, nothing else moves                                               | FACT: main/PH `timelineMarchers.ts:18–31`                                                                                     |
| Cast into a transition **with any lane**                                           | **Refused**: "This edit can't keep a drawn path yet. Remove the path first"                           | FACT: PH `timelineAssignmentEdits.ts:33–44`, called at `:168` (cast), `:313` (recast), `:386` (set slot); `i18n/en.json:2717` |
| Recast an FTL move                                                                 | Refused ("places its marchers by their order on the trail")                                           | FACT: `en.json:2684`; ui.md:98                                                                                                |
| Cast into an FTL trail's gap                                                       | Not refused by the lane guard (trails have no lanes); takes the lowest vacant slot                    | INFERENCE: `timelineAssignmentEdits.ts:152–210`; ui.md:96–98 ("New marchers take its lowest vacant slots")                    |
| Any casting from the UI                                                            | **No caller** outside the db module and tests, on main or PH                                          | FACT: grep for `castMarchersIntoTransition`, `recastTransition`, `setAssignmentSlot`                                          |
| Join an existing group path                                                        | **Rejoin (AP-R10)**: a marcher already in the move gets a lane on its own slot at offset `A − R.from` | FACT: PH `timelineGroupRoutes.ts:634–673`                                                                                     |
| Take over the empty spot's path and Adjust ("takes over spot 3's path (adjusted)") | Specified in AP-R15/AP-R16; **not built**                                                             | FACT: spec `spec.md:3058–3059`; plan step 12 (`implementation-plan.md:272–308`)                                               |

So the step-24 refusal on cast, recast and slot change **still stands** (tracker row 24:
"casting and Basic refuse or skip laned marchers (… AP-R16 offsets … come later)",
`implementation-plan.md:339`). FACT.

Other refusals that touch roster edits (FACT): split by marchers refuses laned rows
(`timelineSplitMoves.ts:324`); point moves on a laned row refuse (`timelinePointMoves.ts:251`);
the holds cuts treat a laned row like a non-direct one and fall back to `splitRefusal`
(`timelineMoveCuts.ts:545–555`); paste and mirror of a move with paths refuse until step 17
(plan `:188`).

### Open scenario questions that are exactly roster questions (FACT, PH `model-c/02-scenarios.md`)

| Id                     | Question                                                                                                         | State                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| S-27-a (`:701`)        | A marcher in a mid-move swap is deleted: does its slot stay vacant after the swap, or does its partner stay put? | Open. Needs step 12 first                                                     |
| S-31-a (`:780`)        | A deleted trail member: gap travels or closes?                                                                   | Settled in practice by AP-T6 (gap), spec Q-5 (`spec.md:2119`)                 |
| S-32 #4 (`:797`)       | Delete B2 from a ripple: B-rank still starts on 2                                                                | Expected result only; ripple (step 12) not built                              |
| S-42 #2–3 (`:956–957`) | Delete D4 / Rejoin a new marcher: others unchanged (reference ends stored, not re-derived)                       | Holds today (routes store `from`/`to`). FACT for storage; behaviour INFERENCE |

## 2. Pathway steps and what matters for roster changes

Issues #640–#663 are all still **open** because their PRs merge into `pathways/host`, not main.
Steps 24–27 and B0 have no tickets yet (plan `:327`). FACT.

| Step                                                         | Issue                        | PR                                                        | State                   | Roster relevance                                                                                              |
| ------------------------------------------------------------ | ---------------------------- | --------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1 Cornered path                                              | #643                         | #674                                                      | Merged, accepted        | —                                                                                                             |
| 2 Curves                                                     | #644                         | #680                                                      | Merged, accepted        | —                                                                                                             |
| 15 Group path                                                | #656                         | #683                                                      | Merged, verdict pending | Rejoin adds a new marcher to a group                                                                          |
| ADR 0015 docs                                                | #640                         | #724                                                      | Merged                  | Q1–Q4 decisions                                                                                               |
| 24 Lanes                                                     | —                            | #734                                                      | Merged (built)          | Introduced the cast/recast refusal; compaction carries lanes                                                  |
| 3a Paths as objects                                          | #645                         | #737                                                      | Merged                  | —                                                                                                             |
| 3b Adjust, Re-fit                                            | #645                         | #781                                                      | Merged                  | Adjust lives on the lane (lost on compaction)                                                                 |
| 18 Walked paths                                              | #659                         | #790                                                      | Merged                  | Exports read the resolver; nothing per marcher stored                                                         |
| 4 Follow a trail                                             | #646                         | #792                                                      | Merged                  | AP-T6: deleted member leaves a gap                                                                            |
| 4b–4j, 10a, 6, 9                                             | #646, #651, #648, #650       | #816, #817, #830–#836, #859, #897, #899, #902, #909, #915 | Merged                  | 4f/4g: remembered order lives in shape recipes (marcher ids, cascade)                                         |
| 3c Detach, Rejoin                                            | #645                         | #900                                                      | **PR open**             | Adds `timeline_route_sources` (provenance)                                                                    |
| 5 Pins                                                       | #647                         | #903                                                      | **PR open**             | Adds `routes.timing`                                                                                          |
| 10 Outline                                                   | #651                         | #907                                                      | **PR open**             | —                                                                                                             |
| 26 Sub-group Adjust                                          | —                            | #908                                                      | **PR open**             | `group_adjust_id`; AP-H3 step 1 deletes linked Adjusts with no lane                                           |
| **12** Rejoin after takeover, spots change hands, late joins | #653                         | —                                                         | **Not started**         | **Blocking.** Range occupancy, AP-R16 recast offset, `path_timing.offset`, D-22 refusals, range-aware casting |
| **17** Split and merge with paths                            | #658                         | —                                                         | Not started             | Exact group splits; split by marchers copies lanes (AP-R21)                                                   |
| 25 Spacing handoff                                           | —                            | —                                                         | Not started             | —                                                                                                             |
| **27** FTL Adjust                                            | —                            | —                                                         | Not started             | Q3 ("stays with the marcher") is not exercised yet                                                            |
| 8, 11, 13, 14, 16                                            | #649, #652, #654, #655, #657 | —                                                         | Not started             | 14 (stops on a path) touches holds                                                                            |
| Turns 21–23, T-R                                             | #660–#663                    | —                                                         | Parked                  | —                                                                                                             |

Sources: tracker `implementation-plan.md:333–360`; `git log --first-parent` on PH; `gh pr view`.

**What must land before roster changes can honour the owner's decisions** (INFERENCE from the
above):

1. **Step 12**: AP-R16 casting with lanes, range occupancy, `path_timing.offset`. Without it the
   designer can't put anyone into a laned move's empty spot, and "recast start = where the new
   person stands" has no code.
2. **A decision on compaction vs Q1.** AP-R15 deletes the vacated slot's lane in shapeless moves,
   which are most moves. Either compaction stops for laned slots, or Q1 is scoped to stored
   shapes. This is a design gap, not a coding gap.
3. **A casting UI.** The inspector casting (P8.4/UI-7) is not reachable on either branch.
4. **Step 27** if FTL Adjusts must survive a roster change.
5. **#900** for Detach provenance, so a removed Detached member's copied route is swept too.

## 3. Holds (fork main)

| Question                                    | Answer                                                                                                                                                                                                     | Source                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| What a hold references                      | One marcher and a beat range: `timeline_held_marks(id, marcher_id, start_beat, end_beat)`, `UNIQUE(marcher_id, start_beat)`. App data; the resolver never reads it. A nullable `style` came on 2026-11-15. | FACT: main `schema.ts:578–610`; ADR 0012 main `:376–395`, `:595–610`       |
| What it grows out of                        | The move ending at its start, or the starting spot. No stored anchor; derived from rows.                                                                                                                   | FACT: ADR 0012 main `:399–410`                                             |
| Delete a marcher                            | Its marks cascade on `marcher_id`. Other marchers' marks are untouched.                                                                                                                                    | FACT: holds `01-edit-rules.md:42`; schema cascade                          |
| Add a marcher                               | "unchanged; no spans". Holds are always explicit.                                                                                                                                                          | FACT: `01-edit-rules.md:41`; holds README decision 3 (`README.md:134–146`) |
| A hold whose arrival row goes (side effect) | Upkeep deletes it or reaches it back to the last arrival                                                                                                                                                   | FACT: ADR 0012 main `:498–533`                                             |
| Holds of a shape (#1015, **open**)          | "A shape is Held whole": holding some members holds the rest; "removed members leave holes"; `shapePartlyHeld` refuses edits on a partly Held shape                                                        | FACT: PR #1015 body                                                        |
| A hold on a drawn path (step 14)            | Planned: holds live in `routes.timing` and apply to every lane                                                                                                                                             | FACT: plan row 14 (`implementation-plan.md:89`). Not started               |

INFERENCE: deleting one member of a Held-whole shape (after #1015) leaves the mates' marks and a
recipe hole, so the shape stays Held whole minus one. A marcher added to that shape later would
have no mark, so the shape would become partly Held and `shapePartlyHeld` would refuse edits
there until the new member is held too.

## 4. Placeholder dots

Nothing in either checkout draws or stores a dot that isn't a performer. FACT (searches for
placeholder, ghost, unassigned, vacant, empty spot, "position without a marcher").

| Item                                          | State                                                                                                                                              | Source                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Vacant slots (D-13)                           | **Exists in storage.** A slot can have a destination and no marcher. It is flagged, not drawn.                                                     | FACT: spec D-4, D-13; `D-VACANT`                           |
| Recipe holes                                  | **Exists.** A recipe keeps a spot whose member left, "only as a hole". A spot with nobody from the start is "planned, not built".                  | FACT: ADR 0006 main `docs/adr/0006-shape-recipes.md:93–98` |
| Remembered order holes (PH step 4f)           | **Exists.** "the slots of members who left by hand kept as holes"                                                                                  | FACT: PH `src/db-functions/rememberedOrder.ts:8–20`        |
| Empty spot keeps path and Adjust (Q1)         | **Decided, partly built** (stored shapes only; see §1)                                                                                             | FACT                                                       |
| #358 Shapes with unassigned spots             | **Planned, no design.** Owner 2026-10-20: "a box of 16 spots, filled later". Open: where they live, how they draw, how marchers are assigned later | FACT: fork issue #358                                      |
| #504 Recipes onto the transition              | Planned. "An empty spot is a recipe slot with no marcher. It's not a separate concept."                                                            | FACT: fork issue #504                                      |
| #982 Pick which spots stay empty when pasting | Proposal only: hollow spots in the paste preview; needs #358                                                                                       | FACT: fork issue #982 (blocked by #961)                    |
| #960 Marcher assignment, app-wide             | Idea: one shared "who goes where" rule; shortest walk likely default                                                                               | FACT: fork issue #960 (`ready-for-human`)                  |
| #961 Paste                                    | Decided: paste rearranges, **never creates marchers**; pathways tabled                                                                             | FACT: fork issue #961                                      |
| Upstream                                      | No plan. #625 (closed): add a marcher without a section or drill number. #937 "Onion skin sets" is unrelated                                       | FACT: `gh issue list -R OpenMarch/OpenMarch`               |

Summary: **exists** = vacant slots, recipe holes, order holes (all invisible, all "a person left").
**Planned** = #358/#504 (empty spot = recipe slot with no marcher). **Idea only** = drawing them,
filling them later, picking empty spots at paste, a shared assignment rule.

## 5. Show-level data keyed by marcher id

| Data                                     | Keyed how                                                          | On delete today                                                                                                        | Decision needed?                                                                                                                                           | Source                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Timeline assignments                     | `marcher_id` FK cascade                                            | Deleted explicitly first, then compaction                                                                              | Compact vs keep spot (§1)                                                                                                                                  | FACT: main `schema.ts:494–530`; `timelineMarchers.ts:155–177`                                             |
| Lanes, routes, Adjust (PH)               | By slot, not marcher                                               | Follow the slot's fate (§1)                                                                                            | Yes: Q1 vs compaction                                                                                                                                      | FACT                                                                                                      |
| Held marks                               | `marcher_id` cascade                                               | Deleted                                                                                                                | Probably no                                                                                                                                                | FACT                                                                                                      |
| Shape recipe members, order marks        | `timeline_shape_recipe_marchers.marcher_id` cascade                | Deleted; empty recipes deleted; others keep a hole                                                                     | Whether a hole should become a placeholder (#358)                                                                                                          | FACT: main `schema.ts:644–668`; `marcher.ts:258–260`                                                      |
| Tags                                     | `marcher_tags.marcher_id` cascade                                  | Membership deleted; tag appearances stay                                                                               | No                                                                                                                                                         | FACT: main `schema.ts:248–260`                                                                            |
| Section, drill number                    | Columns on `marchers`; `UNIQUE(drill_prefix, drill_order)`         | Number freed; no renumbering                                                                                           | Renumber or keep gaps                                                                                                                                      | FACT: main `schema.ts:152–188`                                                                            |
| Section appearances                      | By section name                                                    | Unaffected                                                                                                             | No                                                                                                                                                         | FACT: main `schema.ts:209–214`                                                                            |
| 3D uniforms                              | Show-level presets (`uniforms`, `guardUniforms`)                   | Unaffected                                                                                                             | No                                                                                                                                                         | FACT: `src/view3d/core/marchers/uniformPresets.ts:5`, `looks.ts:6`                                        |
| Props and equipment items                | `items.marcher_id` (a `marchers` row of type `item`) cascade       | Item deleted with its row                                                                                              | Roster UI must filter `type = 'marcher'`                                                                                                                   | FACT: main `schema.ts:703–750`                                                                            |
| Cues (ADR 0015 cue model)                | `cue_marchers(cue_id, marcher_id)`; every cue names its performers | Not on main yet. PR #1010 (open): "Deleting a marcher takes them out of their cues and deletes a cue left with nobody" | **Yes for adds:** "a marcher added to a section later doesn't inherit that section's earlier cues" (accepted cost)                                         | FACT: main `docs/adr/0015-cue-model.md:146–148`, `:200`, `:301`; ADR 0004 D-2 (`0004…:101–106`); PR #1010 |
| Equipment cues (#992)                    | Cue performers                                                     | Lane rows "re-form when performers are added or removed"                                                               | Yes for adds (same as above)                                                                                                                               | FACT: fork issue #992                                                                                     |
| 3D cinema subjects                       | `{kind: "marcher", marcherId}` / `{kind: "set", marcherIds}`       | Not persisted (demo track and runtime store only)                                                                      | Later, if shots are saved                                                                                                                                  | FACT: `packages/core/src/cinema/types.ts:26–37`; only `demoTrack.ts`, `directorStore.ts` use them         |
| Exports, coordinate sheets, walked paths | Computed from the resolver                                         | Marcher simply absent                                                                                                  | No                                                                                                                                                         | FACT: ADR 0014 §2 (PH `0014…:50–62`); step 18 row                                                         |
| `.ompb` (OpenMarch/schema#1, open)       | `marcherId` text; flattened motion                                 | Marcher absent                                                                                                         | **Yes:** "every marcher is on the field for the whole show"; coverage must run from tick 0 to the end. No way to express a placeholder or a mid-show entry | FACT: schema#1 body ("Coverage", "Marchers off the field")                                                |

## Side notes

- **ADR number clash (FACT):** main has `0014-desktop-updates.md` and `0015-cue-model.md`; PH has
  `0014-moves-follow-drawn-paths.md` and `0015-lanes-on-slots.md`. INFERENCE: the pathways ADRs
  will need new numbers when PH merges, so cite them by name in roster docs.
- **File versions (FACT):** PH writes 11 (lanes), 12 (Adjust), 13 (trails); open PRs take 15, 16
  and 17. Any roster-change storage on main must pick numbers no lab build wrote (ADR 0015 §9).
- **Every procedure that peels, renumbers, copies or deletes slots must carry lanes or refuse**
  (ADR 0015 Consequences, PH `0015…:238–241`). Marcher delete and add are on that list through
  compaction and casting.
