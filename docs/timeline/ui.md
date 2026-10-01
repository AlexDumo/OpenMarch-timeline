# Timeline UI

The spec (`spec.md`) deliberately leaves out the editor UI (§14). This file is
the UI's source of truth: it adopts the timeline built on the `0.2` branch as
the reference presentation, and maps it onto the spec's model. Phase 8 builds
from it. The spec still wins on the model; this file decides presentation.

- Reference: `origin/0.2` at `568056aa`, in
  `apps/desktop/src/components/timeline/` (`Timeline.tsx`, `TimelineVariants.tsx`,
  `TimelinePrimitives.tsx`, `TimelineViewModel.ts`, `TimelineGeometry.ts`,
  `TimelineCanvas.tsx`, `TimelineStoryFixtures.ts`, `Timeline.stories.tsx`).
- Run the stories to see it: they cover the expanded and collapsed densities,
  page and track selection, range selection with Create Track, inactive spans
  and a 512-beat show.
- Status: accepted by the project owner on 2026-09-30 (P8.0). Open questions U-Q1 to U-Q4 are deferred to the Phase 8 work that meets them, decided from the spec where it can, and recorded here when decided.

## What the reference UI is

- A page ruler (page buttons, measure labels, rehearsal marks), a beat grid, a
  waveform lane, a draggable playback cursor, a transport, and zoom.
- Tracks drawn as one clip each, packed into rows automatically. Two densities:
  expanded (22 px rows) and collapsed (5 px micro-pills).
- Selection: a page, a track or a free range, shown as one overlay with
  draggable start and end flags and an "N counts" badge. **Create Track**
  appears for a range when a target is selected.
- Moving a clip snaps to whole beats and commits once, on pointer-up.
- Units are beat indexes with half-open `[start, end)` ranges, the same as
  spec §7 and ADR 0001.

## Decisions

- **UI-1: dashed "inactive" spans mean "stolen".** Inside a clip, a span is
  inactive where the target has an assignment in that timeline but a
  higher-layer assignment wins (spec R-2), or where the target has no
  assignment in that timeline. This is derived from the resolver; nothing
  extra is stored. (0.2's draft `transition_assignment.is_active` column is not
  adopted.)
- **UI-2: timelines start and end on any beat.** The spec allows motion to begin
  mid-page, which breakaways need (golden vector G2 steals at beat 8 of a
  16-beat move). The UI snaps to page lines by default as an aid, and a
  modifier key turns snapping off. The reference validator's page-boundary
  rule is removed when the components are ported.
- **UI-3: the default tracks (answers U-Q1, P8.8).** The timeline shows every
  shape track, plus a marcher's track in a timeline when the marcher moves
  individually there (it has an assignment to a one-slot transition without a
  shape, which is what Create Track makes for a marcher) or is selected.
  Group moves without a shape, such as a converted page show's page moves,
  show only for the selected marchers. Why: the number of default tracks
  follows what was authored (shapes and individual moves), not the band's
  size, so a 250-marcher show doesn't open with hundreds of tracks; a shape
  track already stands for its members; an individual move has nothing else
  to stand for it, and is how a breakaway steal (G2) shows; and the selection
  brings up any other marcher on demand.
- **UI-4: shape track activity (answers U-Q4, P8.8).** The provisional rule
  stands: a shape track is active where at least one member's winning span
  is in its transitions, and inactive where every member is stolen or none is
  assigned. A partial steal (G12's leader) shows on the stolen marcher's own
  track, not on the shape's.
- **UI-5: the zero-length beat 0 isn't drawn (P8.8).** Every show starts with a
  fixed beat 0 that has no time (`timeMap.ts`). The timeline's x axis starts
  at beat 1: view beat `v` is spec beat `v + 1`, and spec positions in
  `[0, 1)` draw at view 0, so the first timed page starts right after the
  initial page's inset. `Timeline` converts at its boundary: its props
  (tracks, playback position) and its commands (seek, clip move, Create
  Track) stay in spec beats, and a clip move sends the clip's spec range
  shifted by the dragged beats. A Create Track range from view 0 sends spec
  beat 1, which is the same show time as beat 0.
- **UI-6: the timeline's commands (P8.9).** A clip move shifts its whole spec
  timeline, every transition and assignment in it, by the dragged beats
  (`shiftTimeline`); shapes and destinations stay put, so every position moves
  in time only. A shift that would leave beat 0 or overlap the same marcher's
  row at the same layer in another timeline is refused (E-ARGS, E-A3), and a
  clip dropped where it started writes nothing. Create Track's target is a
  shape picked by selecting its track, which takes the selected marchers, or
  else the one selected marcher. Its assignments go one layer above the
  highest layer the marchers already have in the range (0 where they have
  none), so the new track steals the range (R-2) the way a breakaway does
  (G2). Why: at layer 0 it would overlap a converted show's page moves and
  always be refused (E-A3). A block with fewer cells than marchers is refused
  (E-T4). A marcher's new track starts at its position at the range start, so
  it doesn't jump there, but it holds still over the range. If the track steals
  a move in progress, the marcher stops for the range and the stolen move then
  resumes with a catch-up, a visible change of speed, because progress is
  measured against that transition's own end (D-7).
- **UI-7: casting and layers (P8.4).** Casting gives each marcher a slot by
  nearest slot: the cast that makes the total distance from where the marchers
  stand (at the transition's start, or for a recast at each assignment's start)
  to their slots' destinations as small as it can be. Create Track into a shape
  casts this way too, instead of filling slots in id order. A marcher cast into
  an existing transition gets an assignment over the whole transition, one
  layer above the highest layer it already has over those beats (0 where it
  has none), so it steals them like Create Track does (UI-6). The layer is
  chosen per marcher, since layers only rank one marcher's own moves (R-2). A
  recast that wouldn't shorten the total distance is refused, so ties never
  reshuffle anybody. Why: nearest-slot casting keeps paths short and avoids
  crossings without the designer placing everyone by hand; casting reads the
  positions from the rows inside the edit's own transaction, so it can't plan
  from a resolver that hasn't caught up with an earlier edit.

## Mapping the spec onto the view model

The reference `TimelineViewModel` becomes a derived view: an adapter builds it
from the stored tables and the resolver, and nothing in it is stored.

| View model                                   | Built from                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beatCount`, `pages`, `measures`             | beats, pages and measures, as today                                                                                                                                                                                                                                        |
| Marcher track                                | one per spec timeline in which the marcher has an assignment. Clip range: the marcher's first assignment start to last assignment end in that timeline                                                                                                                     |
| Marcher track `legs`                         | the marcher's resolver spans (R-2) inside the clip: a hold span is `hold`; any other span is `move`                                                                                                                                                                        |
| Marcher track `activitySpans`                | active where the marcher's winning span belongs to an assignment in this timeline; inactive otherwise (UI-1)                                                                                                                                                               |
| Shape track                                  | one per spec timeline and shape used as a destination in it: the transitions whose `dest_shape_id` is that shape (a group move). Spec shapes have no time; the track shows the moves into them. A gap filled by another shape's move splits it into two clips (P8.8)       |
| Shape track `activitySpans`                  | active where at least one member's winning span is in those transitions; inactive where all are stolen (UI-4)                                                                                                                                                              |
| `TimelineRangeChange {timelineId, range}`    | moves the whole spec timeline. Clips from the same timeline move together, so the UI highlights linked clips                                                                                                                                                               |
| `TimelineCreateTrackRequest {target, range}` | one edit: a new timeline over the range with one transition. For a marcher, a shapeless one-slot `direct` transition whose destination starts at the marcher's position at the range start; for a shape, a transition into it with the selected marchers assigned to slots |

## What the timeline doesn't show

These belong in the inspector (P8.5), not the timeline:

- path style, bulge, waypoints, destination shape, `slot_count`, `order_mode`
  and slot casting;
- the layer of each assignment (spec Q-8 stays open for anything richer);
- diagnostics (§8.9 requires them). The timeline adds a warning badge on any
  clip whose range has a diagnostic; the inspector lists them. A shape track's
  badge counts all of its transitions' diagnostics; a marcher track's counts
  the ones about that marcher. A transition-wide one (such as `D-VACANT`) of a
  transition without a shape shows once, on the first shown marcher track
  assigned to it. The badge's tooltip lists them.

**Where they are (P8.5).** The inspector's Timeline section
(`TimelineInspectorSection`, timeline mode only) explains each selected marcher
(up to 10) at the selected page's end beat from `explain`: span kind with a
plain-language note, its beats, the transition and the spec timeline it belongs
to, the assignment's layer, slot, progress, origin (home, or the end of the
previous span), path style, bulge, waypoints, destination, and for
follow-the-leader spans the member order place, order source and target. It
then lists that marcher's diagnostics, and below it every diagnostic of the
show by transition. Errors are worded by `timelineErrorMessages.ts` (P8.6).

**Editing a transition (P8.3).** Below the explanations, the section has an
editor (`TimelineTransitionEditor`) for the move that brought each selected
marcher to the page: the transition of the span that ends at the beat, or the
one the beat falls inside. Spans are half-open, so a move that starts at the
beat (the next page's) isn't offered, and a marcher that held through the page
offers nothing. It edits:

- the path style. Follow the leader is disabled, with the reason, without a
  destination shape (I-T5) or with a block (I-T3). A new arc starts at bulge
  0.25, and a new follow-the-leader with no waypoints;
- the bulge, by slider or number, clamped to ±½ with a note that larger arcs
  aren't supported (D-15);
- the follow-the-leader waypoints: add (at the last one), remove, reorder, and
  numeric x and y. Picking them on the canvas is a follow-up;
- the order mode, with a one-line note on what each does (R-12);
- the destination: a shape from the list, or individual points. Switching to
  points copies the shape's slot samples (R-13), so nobody moves until a point
  is changed (D-16, Q-14). Individual points are disabled for follow the leader.
  The picker disables, with the reason, a block for follow the leader (E-T3)
  and a block with fewer cells than slots (E-T4);
- the slot count, from the highest assigned slot + 1 (the note names the slot)
  to 10000 (I-N2). A shapeless transition's new slots start at its last point.

Each change is one undoable edit through the transition db-functions, a change
that writes nothing is skipped (a number field commits only changed text), and
a refusal is a toast with its P8.6 message. After an edit, the controls stay
disabled until the inspector shows the edited transition, so a quick second
edit is never planned from the old one.
Clip and track selections in the timeline don't drive the editor yet.

**Casting and layers (P8.4).** Below each transition's editor,
`TimelineAssignmentsEditor` lists its slots (the first 64; the rest are
counted): each member by drill number, and each vacant slot, with a warning
line naming the vacant slots (D-13, `D-VACANT`). For each member it edits:

- the slot: a vacant slot is taken, and an occupied one is traded with its
  marcher (both rows are deleted and inserted again, so no moment has two
  marchers in one slot);
- the layer (a whole number from -1000 to 1000), with a note that the higher
  layer wins where a marcher's moves overlap. The same layer over the same
  beats as another of its moves is refused (E-A3);
- the first and end beats, inside the transition (E-A1);
- removal, which leaves the slot vacant.

Each member says where it's stolen: the beats where a higher layer wins, and
by which transition (R-2), the inspector's counterpart of UI-1's dashed spans.
Two actions cast by nearest slot (UI-7): **Cast selected marchers** puts the
selected marchers who aren't in the transition into its vacant slots, and
**Recast by nearest slot** re-picks every member's slot. Each is disabled, with
the reason, when nothing is selected, everyone selected is in already, there
are too few vacant slots (raise the slot count first), the transition is
empty, or it has more than 500 slots (the solve is cubic; 500 take about
30 ms). Edits follow the transition editor's rules: one undoable edit each,
nothing planned until the edited target shows, and refusals as toasts.

## Porting notes

- The components depend on 0.2's frame-clock store
  (`apps/desktop/src/services/clock/frame-clock.ts`), React, a 2D canvas for
  the grid and waveform, `clsx`, `@phosphor-icons/react` and Tailwind tokens.
  The frame clock comes over in Phase 5 (P5.9).
- The waveform comes from a context that only Storybook sets today; wire it to
  the audio player.
- `legs` keep their `move`/`hold` texture but aren't drawn.
- Not in the reference and not needed for the first port: clip edge resizing
  (maps to R-E1 later), wheel zoom and multi-select.

## Open UI questions

- **U-Q1:** which tracks show by default. Decided: UI-3.
- **U-Q2:** what resizing a clip edge means: an R-E1 range edit on the
  timeline's transitions, or on one assignment.
- **U-Q3:** how layers show on the timeline, if at all (spec Q-8). Since
  P8.4 the inspector shows and edits each assignment's layer and where it's
  stolen (UI-7); the timeline itself still shows steals only as dashed spans
  (UI-1).
- **U-Q4:** the shape track's activity rule. Decided: UI-4.
