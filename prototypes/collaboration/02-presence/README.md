# 2. Presence

You can see who is in the session, which marchers each person has selected, what they are dragging
as they drag it, and where each person's playhead and time selection are on the timeline.

## Run

Same as [1](../01-live-sync/README.md): **Make collaborative**, then **Open a second window**. Give
each window a different name in the header. Two different names make it easier to follow.

## Try

- **Selection.** In window A, select a section (the **select** buttons) or drag a box. Window B
  shows dashed rings in A's color around those marchers, with A's name tag.
- **Live drag.** In A, drag marchers slowly. B sees translucent ghosts in A's color, labelled
  "_Alex is moving these_", before anything is saved. When A lets go, B sees the move land and the
  changed marchers pulse once in A's color, so a remote edit never happens silently.
- **Playhead lines.** Scrub or press **Play** (Space) in A. B's timeline shows A's playhead as a dashed
  line with A's name, plus ▶ while A plays. Shift-drag the ruler in A to make a time selection; B
  sees it as a band in A's color.
- **Go to.** In B's People panel, each person shows their page, count, selection and what they are
  doing. **go to** jumps B's playhead and time selection to theirs.
- Set **Simulated latency** to 500 ms in one window to feel how presence trails behind an edit.

## What it taught

Presence is a **separate channel from ops**. It is relayed and never stored or ordered. Here the
server keeps it in each socket's attachment, and a slow or lost presence message costs nothing. It
should stay out of the op path and the undo stack entirely.

In the app, everything presence needs is already in a store:

- `TimelineSelectionStore` holds the playhead, the loop and the start flag.
- The field editor's pending drag (`fieldEditor.ts`, `pending`) is exactly the "what are they
  dragging" ghost.
- `SelectedMarchersContext` holds `Marcher` objects. Presence wants IDs, so that context needs an ID
  selector before it can be broadcast.

A Durable Object's socket attachment is capped at 2 KB, so a real implementation keeps large
selections in memory (or sends ranges) rather than in the attachment.
