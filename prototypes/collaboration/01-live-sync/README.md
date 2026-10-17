# 1. Live sync

Two windows edit the same show, and each edit shows up in the other window right away.

## Run

`pnpm dev`, open <http://localhost:8787>, choose **Generated demo band**, click **Make
collaborative**, then click **Open a second window**.

## Try

- **Move marchers.** In window A, click a marcher (or drag a box around several) and drag them. The
  playhead jumps to the end of the page you are editing; that is where the move ends. Window B shows
  them there as soon as you let go, and its Activity list shows the op with its server `seq`.
- **Edit a move on the timeline.** Click **select** next to _Battery_. Drag the right end of a move
  bar to make it longer, drag its middle to shift it, or select it and press Delete.
- **Stack a move.** Shift-drag on the ruler to make a time selection inside a page, then drag
  marchers. That writes a move over just the selection. It starts later, so it wins over the page's
  move while it runs, and the marcher goes back to the page move afterwards. Neither window stores
  who wins; each one works it out.
- **Insert 4 counts at playhead** (the head drill writer's window). Every later flag and move shifts
  in both windows.
- Use **Play** in both windows. Positions are computed in each window from the synced moves, so
  playback never crosses the network.

## What it taught

Capturing ops at the SQL layer really does need nothing from the commands. `moveMarchersCommand`
and the others are plain SQL against the mirror, written the way db-functions are. The triggers
turn each transaction into an op, and remote apply is just "replay with recording off, then redraw
from the tables that changed."

The two things that needed design were not plumbing:

- **IDs.** An insert has to take an explicit ID from the member's block (`Mirror.nextId`).
- **The beat grid.** An op carries the `grid_version` it was computed on.
