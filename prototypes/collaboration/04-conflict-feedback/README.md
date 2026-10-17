# 4. Conflict feedback

When two people change the same move at once, last-writer-wins still decides, but neither person
is left guessing. Both are told who won. The person who lost gets a one-click way back, and the
marcher and move are marked for a few seconds.

## Run

Same as [1](../01-live-sync/README.md). Real collisions need two edits in flight at once, so set
**Simulated latency** to **1500 ms** in **both** windows. Each message then takes 1.5 s each way,
which makes a near-simultaneous edit easy to produce by hand.

## Try

- **Same field.** Drag marcher W5 up in window A. Within a second, drag W5 down in window B. A few
  seconds later:
  - Both windows converge on B's spot (B's op reached the server last).
  - A gets "_Sam changed W5's spot (counts 0–16) at the same time as you, and theirs landed last,
    so it replaced yours_", with **Put mine back**.
  - B gets "_You and Alex changed W5's spot at the same time. Yours landed last, so it replaced
    theirs_".
  - W5 pulses red with "_Sam won_", and its move bar is outlined.
  - Click **Put mine back** in A. That sends A's lost value as a new op, so both windows go back to
    A's spot.
- **Not a conflict.** If B _had_ seen A's edit before making its own, there is nothing to report.
  The server only flags a write that replaced one the writer hadn't seen (`field_versions.seq >
op.baseSeq`).
- **Delete versus edit.** Select _Brass_ in both windows. In A, click a move bar and press Delete.
  Within a second, resize the same bar in B. B's edit is refused with "_Alex deleted the move you
  were editing_". B's window puts the move back the way the server has it (gone), and the marcher
  is marked.
- **Stale grid.** In A (the head), click **Insert 4 counts at playhead**. Within a second, resize a
  move in B. B's edit is refused: it was computed on the old beat grid. The toast says to try again.

## What it taught

1. **Detection is cheap, if the server keeps one row per field** with the last seq and writer
   (`field_versions` in `server/session.js`). Comparing that seq with the op's `baseSeq` tells
   "replaced something unseen" apart from "edited after seeing it." No conflict-free replicated data types and no vector clocks are
   needed.
2. **The useful unit for feedback is a row, not a field.** A drag writes `x` and `y`, which is two
   field conflicts but one thing to say. The client groups conflicts per person and row, and
   describes the row ("W5's spot (counts 0–16)") using the same marcher mapping claims need.
3. **"Put mine back" is just a new op.** That only works because ops carry `prev` values and the
   server echoes `lostValue`. The same data powers per-user undo (report §4.4).
4. **A rejection must revert locally and say why.** The client applies the inverse of its own
   pending op (`Connection.revert`). Without the server's reason the revert looks like a bug, so
   every refusal code has a sentence.
