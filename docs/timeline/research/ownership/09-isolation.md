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

## Validation rows (to merge into VALIDATION.md)

| ID   | Decision (status)                                                                                    | Alternative                                            | What to try                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| V-14 | Isolation is entered by double-clicking a page box or clip; Esc or **Done** leaves (**provisional**) | Enter key on a selected clip; a toolbar toggle         | Do five ghost edits in a row. Is the double-click found without being told? Does Esc feel safe? |
| V-15 | Outside members are dimmed **and locked** while isolated (**provisional**)                           | Faded but still selectable (07 §1.3 focus fade)        | Try to grab a marcher outside the move. Is being blocked helpful, or does it feel stuck?        |
| V-16 | Play loops the isolated range; the scrub is clamped to it (**provisional**)                          | Play on past the end; free scrub with the range shaded | Loop a steal-out several times. Does anyone want to see what happens after the range?           |
| V-17 | The scene stays drawn while playing in isolation (**provisional**; 07 draws nothing while playing)   | Hide paths while playing, as outside isolation         | Play a 200-marcher move isolated. Is it readable, and is the frame rate fine?                   |
| V-18 | Leaving restores the start flag and playhead from before isolating (**provisional**)                 | Stay on the isolated range                             | Isolate, scrub, leave. Did the playhead land where you expected?                                |
