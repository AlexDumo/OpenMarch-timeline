<!-- cspell:disable -->

# Pathways: implementation plan and to-do list

Status: draft 2, 2026-11-03 (step by step: no up-front schema, turns parked). Model: [draft-model.md](draft-model.md) (draft 5, reference). Controls:
[ux-sheet.md](ux-sheet.md) (draft 3). Decisions: [register](README.md).

## How we build it

The feature ships as **small steps, each one a lab build the owner can try and judge on its own**.
Each step is one PR into an integration branch (`pathways/host`), and does one thing a person can
see. A step lists what to try, what good looks like, and what is deliberately left out, so feedback
is about that step only.

- **One step at a time.** The next step starts once the owner has given the current one a verdict.
  further starts until N has feedback.
- **Feedback changes the plan here.** Each step's row in the tracker records the verdict
  (good / fix / rethink) and any fixes, so nothing gets lost between steps.
- **Lab builds only for steps with something to try.** Steps 1 and 2 are plumbing with a small
  visible piece; the rest each add one behaviour.
- The integration branch goes to main only when everything is in and every check is green.

## Before building

| #   | Item                                                                                                                                                                                                                      | State                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| B-1 | Prototype round 3 (calls A/B, ↻ ↺, collisions, Follow bend vs count, Steps change, teaching list)                                                                                                                         | Done, 24 selftests pass                                                                                                                |
| B-2 | Simulated users, round 3 (H-13 to H-19)                                                                                                                                                                                   | Done: [proto-round-3.md](proto-round-3.md); open calls: ↺ keeps amount, pen draws Follow lead-out (teaching findings dropped with M-1) |
| B-3 | ~~Draft 6 / UX sheet 4 from round 3~~                                                                                                                                                                                     | Dropped: later steps revise the research docs as they go                                                                               |
| B-4 | Short ADR amending ADR 0001 C-8 (a move may follow a drawn path) and spec v0.9 with the step 1 rules only; owner reads and accepts (#641)                                                                                 | Next                                                                                                                                   |
| B-5 | Open items, each settled in the step it blocks: O-5 entry aim (step 12, default first fit); resizing a move whose formation spans two moves (15); row-end rounding and O-27/28/29 (11); O-25 keep `arc` beside routes (1) | In their steps                                                                                                                         |

## The steps

**Build order (owner, 2026-11-03):** 1 corners, 2 curves, 15 draw for a group, 3 paths as objects, 5 midsets and quarter sets (with Put corners on counts), then the rest by the table's blocking column. Step numbers are kept so they still match the tickets. Steady speed stays the rule until pins: runs and flutters have more corners than counts, so corners on counts is an action, not a default.

Revised 2026-11-03 after an independent review of the first order (reviewer had only the owner's
words, the register, the model and the code). The owner's request, in its order: runs and flutters;
follow the leader (smooth, and block letters with a clear count at each corner; ripple through an
in-between transition); one marcher's path (midsets, quarter sets, each count); double and half time
as maybe-scope. Turns came later. One marcher's drawn path still goes first because follow the
leader reuses its pen and geometry; after that the two tracks interleave.

**Every UI step's acceptance includes:** one action = one undo step with ids restored; works with
pencil and finger (point menus on long-press); a lab note saying what is deliberately left out;
existing edits (resize, split, split by marchers, merge, flag drags) either correct or refused with
a reason, never a broken file.

| #       | Step                                                  | Blocked by     | What you can try                                                                                                                                                                                                                                                                                                         |
| ------- | ----------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~P-0~~ | ~~Schema and resolver seam~~                          |                | Dropped (#642 closed): each step adds the storage it needs; step 1 adds the per-move walked-path seam                                                                                                                                                                                                                    |
| 1       | Draw a cornered path for one marcher                  | B-4            | Path pen: click corners, Enter, Backspace; playback, 3D and start-flag paths follow it; Big steps per leg; split and merge of such a move refuse; a marcher taken over walks straight (interim). Adds only its own storage                                                                                               |
| 2       | Curves                                                | 1              | Drag for smooth points; marchers keep facing front (P-3)                                                                                                                                                                                                                                                                 |
| 3       | Paths as objects: open, edit, clear a collision       | 2, 15          | Click selects a path, double-click opens it; dragging a dot still makes a new move (P-1); drag, add, delete points; corner ↔ smooth; a point edit on a group path moves the group, a hand edit to one lane gives it its own path; Re-fit; Paths Off / Selected / All; collisions sampled along the path; "No collisions" |
| 4       | Follow a drawn trail into place                       | 2              | Follow, leader, Reverse; a line follows a drawn trail into its spots                                                                                                                                                                                                                                                     |
| 5       | Midsets and quarter sets                              | 3              | On an open path: drag the playhead marker to pin, or Pin to count… on a point; ticks on the clip; resizing keeps pinned counts (Alt scales); **Put corners on counts** pins every corner to a whole count by length (slot trades)                                                                                        |
| 6       | Corner counts for block letters                       | 4              | Each marcher's turning count at each corner; a warning when a corner isn't on a count                                                                                                                                                                                                                                    |
| 8       | Per-count editing                                     | 5              | With a path open, drag the marcher's playhead marker on any count to set its spot there (J-4); dragging a dot still makes a new move (P-1)                                                                                                                                                                               |
| 9       | Ripple into the next trail                            | 4              | One follow the leader through a straight in-between transition of N counts                                                                                                                                                                                                                                               |
| 10      | Arcs and following around an outline                  | 4              | Circle and box outlines as trails                                                                                                                                                                                                                                                                                        |
| 11      | Snake through a box                                   | 10, O-27/28/29 | Snake order, advance N spots, pen draws the lead-out                                                                                                                                                                                                                                                                     |
| 12      | Rejoin a path after a takeover                        | 5              | A marcher taken off a path picks it back up; hatched lead-in                                                                                                                                                                                                                                                             |
| 13      | Join a follow the leader along a shape                | 11, 12         | A marcher joins the snake from off the trail                                                                                                                                                                                                                                                                             |
| 14      | Stops and holds                                       | 5              | Mark time at a point, at the start, at the end                                                                                                                                                                                                                                                                           |
| 15      | Draw for a group (built third)                        | 2              | A block slides along one shared path, each member at its own offset; Own path, Rejoin; rings. Point editing on the shared path comes with step 3                                                                                                                                                                         |
| 16      | Steps per count                                       | 5              | Double, half, triplet; "32 steps"; pins on the step grid                                                                                                                                                                                                                                                                 |
| 17      | Split and merge with paths                            | 5, 11, 15      | Splits keep paths, pins and follow the leader exact                                                                                                                                                                                                                                                                      |
| 18      | Drawable paths for other apps                         | 2              | The walked path as SVG (or a polyline) per marcher, beside today's coordinates at any time (P-2)                                                                                                                                                                                                                         |
| T-R     | Revise the turn rules (no lab build) — **parked**     | B-4            | Apply Fable review 3 and T-5 to the model and spec; Fable re-checks. Waits until drawing and follow the leader have feedback                                                                                                                                                                                             |
| 21      | Turn: same shape, fixed pivot — **parked**            | 1, T-R         | Gate turn and box spin; typed angle; ↻ ↺; Restore when leaving Turn                                                                                                                                                                                                                                                      |
| 22      | Turn: pivot drag, travelling pivot, pins — **parked** | 5, 21          | Pivot to the middle; spin while travelling; half turn by count 8                                                                                                                                                                                                                                                         |
| 23      | Turn into a different shape — **parked**              | 21             | Box spirals into a circle                                                                                                                                                                                                                                                                                                |

**Owner calls that block a step (only that step waits):**

- Pen draws a Follow lead-out (step 11).
- Settled: ↺ keeps the amount and whole turns live on the turn (T-5); facing stays front (P-3),
  so "Against travel" and "rotation past 360°" are no longer steps.
- Settled 2026-11-03: C-1 → P-1 (paths are objects; dragging a dot never edits a path); C-2 and
  the Teach card → no teaching output, coordinate sheets unchanged (M-1 withdrawn); C-4 → the
  mobile app is a separate task, needing only coordinates at a time and a drawable path (P-2);
  C-3 → groups only slide, no "turn with the path" (G-1).

**Storage grows step by step.** Each step adds its own migration on `pathways/host`; lab files may break between steps (fork-internal data doesn't matter). v0.1.7 files open unchanged at every step, and the step migrations are folded into one before main. Each step also writes its own rules into the spec when it starts.
Resolver steps also extend the independent oracle, so budget for it.

## Published

Spec: fork issue #640. Tickets #641–#663 (sub-issues of #640, native blocking edges): #641 = ADR and step 1 rules; #642 (P-0) closed; steps 1–18 = #643–#659 (step 7, the Teach card, was dropped); T-R = #660 and turns #661–#663, parked (no `ready-for-agent` label).

## Tracker

Filled in as we go: one row per step, the owner's verdict, and what changed because of it.

| Step | PR  | Lab | Verdict | Fixes / notes |
| ---- | --- | --- | ------- | ------------- |
| 1    |     |     |         |               |
