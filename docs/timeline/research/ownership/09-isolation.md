<!-- cspell:disable -->

# 09: Isolating a move (prototype)

Status: prototype on branch `timeline/isolation-focus` (based on P8.17,
`timeline/p8-17-core-loop`). Nothing here changes `spec.md` or `ui.md` yet. This
folder's other files (01–08, README, VALIDATION) are on `timeline-try-2`; merge this
file and its validation rows into them when the branches meet.

## Why

The owner (2026-10-04): the timeline view doesn't show enough. Two needs:

1. Edit the destinations of marchers who were stolen out of a move. Their
   destinations belong to the move's plan, not to where they really end up, so in
   the normal view there is nothing to grab.
2. Work on one group's paths without everything else getting in the way.

Both come down to one thing: **pick a block, see its whole plan, keep everything
else out of the way.** A block is a stored timeline; its members are every marcher
with a row in it, including those another move steals partway.

The case for making this a visible state rather than a selection side effect:
06 §5.2's "the window decides" rule already changes what a canvas drag edits
depending on whether the window equals a move's range. That is a mode with no
indicator. Isolation makes it visible.

## What the prototype does

- **Enter:** double-click a page box or a clip on the strip. A range with no stored
  timeline shows an info toast instead.
- **Inside:**
  - the window is the timeline's range, and the playhead stays inside it;
  - Play loops the range;
  - marchers outside the timeline are dimmed and can't be selected or hit (UI-9's
    dimming, unused under UI-10, reused);
  - the page-pair paths are hidden, and the canvas draws the isolated move's scene
    (07 phase G0, read-only):
    - the members' real paths, solid, in the strip's color;
    - for members another move took out partway, the move's plan for the rest of
      the range as gray dashes, ending in a gray dot where the move would have
      ended them;
    - the move that took them, in its own color, over its whole span;
    - start rings and destination dots;
  - a bar over the field names the move and its member count, explains the gray
    dashes, and offers **Done (Esc)**.
- **Leave:** Esc (unless a text field or the line or lasso tool has it), **Done**, a
  click on a page box, home, or a dragged range. Leaving restores the start flag and
  playhead from before. The isolation also ends if the timeline is deleted (undo
  included), and follows it if its range moves.
- **Write path:** a range that starts inside a move and runs past its end is now an
  exit (06 §2 D) and is allowed. A range that runs into a later move partway is
  still refused, naming the join, until live links exist (WP-O3).

Code: `TimelineSelectionStore` (`isolation`, `isolate`, `exitIsolation`,
`isMarcherDimmed`), `timelineFocusScene.ts` (pure scene builder, throwaway plan
resolver), `TimelineFocusLayer.ts` (one fabric object), `useTimelineFocusRender.ts`,
`TimelineIsolationBar.tsx`, `playbackStep` (loop).

## Not done

- Ghost dots aren't draggable yet (07 G2). That is the next step for need 1, and it
  needs no new storage: a ghost end is the move's existing slot destination.
- Joiners' approach ghosts need stored ghost starts (WP-O3).
- Step-size warnings are hidden while isolated. They should show on performed and
  context paths (07 §2).
- No hover preview, notches or count ticks.

## Findings from the first capture (2026-10-04)

- Isolating a small move (the 4-count steal) reads well: 7 paths and everyone else faded.
- Isolating a page-wide move in a converted show isolates every marcher, so it draws
  76 paths and fades nobody. Isolation helps least where a page is one big move.
  Options: fade the members who hold still; or show only the selected members' paths
  when some are selected.
- While the loop is on the range's first beat, the playhead sits on the start flag, so
  UI-10 falls back to the page box ending there, and the strip briefly highlights the
  previous page.

## Ghost ends are draggable (2026-10-04)

The gray end dot of a member another move has at the timeline's end is now a drag handle (07 G2, the owner's need 1). Releasing it sets that member's planned destination in the isolated timeline. This is the timeline's existing slot destination (`moveGhostEnds`; `moveMarchersInTimelineInTransaction` with `ghosts`, which skips the higher-layer refusal). It is one undo step, and it needs no new storage.

What follows from the edit is re-derived:

- the ghost path;
- the point where the member leaves (R-4);
- the stealing move's start.

The member's real end doesn't move.

A press on a handle always goes to it, even inside the marcher selection's box. `findTarget` prefers handles; otherwise fabric would hand the press to the selection and drag the real marchers. Like the shape handles, ghost handles are transparent to the marcher selection.

Limits:

- one ghost at a time; a box selection drops handles, as it does shape handles;
- no live path preview while dragging, so the scene redraws on release;
- coordinate rounding isn't applied;
- ghost starts (joiners) wait for WP-O3.

## Reviews (2026-10-04)

A code review and a designer-UX review ran on the first commit.

**Fixed after review:**

- **The playhead on the first beat edited the previous move.** After Stop, a seek to the start or the loop's wrap, P could equal S. UI-10's window then fell back to the previous page box, so a drag wrote the wrong move. Inside isolation P now stays in `(start, end]`.
- **Esc was swallowed by the registered Escape action.** It now listens in the capture phase. The first Esc deselects as usual; an Esc with nothing selected leaves.
- **The restore point was the double-clicked range.** The panel now records the window on the first mousedown of the click sequence.
- **S drifted when page boxes changed, and S and P stayed behind when the isolated clip moved with P mid-range.** Both now rebuild the isolated window.
- **Scene: a member with two rows lost its first path; a member another move held at the start had no ghost; context paths could repeat.** All three are fixed, and a catch-up ghost is drawn only where the plan doesn't catch up too.
- **`selectNothing` kept isolation, and the join refusal suggested a range that is also refused.** Both fixed.
- **UX:**
  - the bar names moves in pages and counts ("Page 2, counts 5–8");
  - with marchers selected, the others' paths drop to 25%;
  - members who hold still are a quiet ring with no path;
  - the bar no longer wraps.

**Open, for the owner:**

- **Ghost prominence (V-8).** The UX review says gray dashes on a gray grid are the faintest mark on the field, though ghosts are why the mode exists. It suggests the move's color, dashed, with hollow ends, as the drag target.
- **Mid-range edits.** With P scrubbed mid-move, a drag follows UI-10 and makes a sub-range move. The UX review suggests that inside isolation, edits always target the move's end and scrubbing is for viewing only.
- **Draggable ghost ends (need 1).** Selecting B10–B16 inside isolation selects their real dots, which belong to the move that stole them; ghosts need their own hit-testing and selection (07 G2).
- **Not done yet:**
  - the inspector doesn't name the isolated move;
  - nothing on a page box hints at double-click;
  - faded marchers turn pink, which can clash with a move's color (UI-9 dimming);
  - the selection box stays put while playing;
  - step-size warnings are hidden while isolated;
  - follow-the-leader `inherit` order falls back in the plan.

## Validation rows (to merge into VALIDATION.md)

| ID   | Decision (status)                                                                                    | Alternative                                            | What to try                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| V-14 | Isolation is entered by double-clicking a page box or clip; Esc or **Done** leaves (**provisional**) | Enter key on a selected clip; a toolbar toggle         | Do five ghost edits in a row. Is the double-click found without being told? Does Esc feel safe? |
| V-15 | Outside members are dimmed **and locked** while isolated (**provisional**)                           | Faded but still selectable (07 §1.3 focus fade)        | Try to grab a marcher outside the move. Is being blocked helpful, or does it feel stuck?        |
| V-16 | Play loops the isolated range; the scrub is clamped to it (**provisional**)                          | Play on past the end; free scrub with the range shaded | Loop a steal-out several times. Does anyone want to see what happens after the range?           |
| V-17 | The scene stays drawn while playing in isolation (**provisional**; 07 draws nothing while playing)   | Hide paths while playing, as outside isolation         | Play a 200-marcher move isolated. Is it readable, and is the frame rate fine?                   |
| V-18 | Leaving restores the start flag and playhead from before isolating (**provisional**)                 | Stay on the isolated range                             | Isolate, scrub, leave. Did the playhead land where you expected?                                |
