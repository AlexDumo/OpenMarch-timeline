# Tempo decisions log

One entry per decision made while building: context, choice, alternatives, how to validate.
Feel-based ones also have a row in
[VALIDATION.md](../timeline/research/ownership/VALIDATION.md).

## T-1 Count limits (core, 2026-10-06)

- **Context:** drags and taps must be clamped, never refused (11-ui.md). The plan drops the 40 BPM
  floor for computed tempos because holds are slow.
- **Choice:** 0.15 s (400 BPM) to 30 s per count. A count already outside may stay but not get
  worse, so existing data never blocks an edit.
- **Alternatives:** 10 to 400 BPM (6 s max) as in 11-ui.md; that blocks the kit's 6.5 s fermata.
- **Validate:** V-37.

## T-2 A hold is absorbed proportionally (core)

- **Context:** "later counts shift up to the next synced count, which absorbs it."
- **Choice:** the counts between the held count and the next synced count re-space, keeping their
  relative lengths. Right before a synced count there's no room: the hold is clamped (usually to no
  change) and `clamped` says so.
- **Alternatives:** the next count alone absorbs it; or the synced count moves.
- **Validate:** V-38.

## T-3 Count 1 moves the audio offset (core)

- **Context:** count 1 is always at show time 0 (beat 0 is fixed), so "count 1 lands later in the
  music" can only be an offset change.
- **Choice:** the pure library reports `originShift`; `retimeBeats` sets
  `audioOffsetSeconds -= originShift` in the same undo entry. Positive offsets pad silence before
  the music (`audioOffset.worker.ts`).
- **Alternatives:** count 1 can't move; or keep a separate "show start" in the file.
- **Validate:** V-39.

## T-4 Workspace settings get scoped history (core)

- **Context:** the offset and the synced counts live in `workspace_settings`, which has no undo
  triggers. Without undo, Ctrl+Z after "tap from the start" restores the durations and not the
  offset: the show ends up misaligned.
- **Choice:** a tempo write logs the settings row's undo statement itself; undo/redo create
  triggers on that table only while replaying (`tablesWithScopedHistory`). Other settings writes
  stay out of history.
- **Alternatives:** add `workspace_settings` to `tablesWithHistory` (every settings write would
  join the previous edit's undo entry unless all writers moved into `transactionWithHistory`);
  move the offset to `utility` (migration); accept a non-undoable offset.
- **Validate:** `db-functions/__test__/tempo.test.ts` round trips; the owner should confirm that
  undoing a retime also undoing a later settings change is acceptable (see the ADR).

## T-5 `after` modes (core)

- **Context:** the drag rule re-spaces to the next synced count; experts need an override.
- **Choice:** `after: "respaceToNextSynced"` (default) or `"shift"` (shift past synced counts).
  Which modifier maps to `"shift"` is the UI worker's call (Alt is taken by snapping).
- **Validate:** with the Align view.

## T-6 Tap units (core)

- **Choice:** `applyTaps({ unit: "page" })` re-spaces between taps proportionally (keeps score
  tempo changes inside a page); `unit: "count"` spaces evenly, since a gap between every-count taps
  is a missed tap.
- **Validate:** E9 with the rit. in the kit.

## T-7 Tap tempo fit (core)

- **Choice:** median interval for a first guess, beat numbers by rounding each interval (a missed
  tap counts as two beats, a double tap is dropped), then a least-squares line with taps more than
  ¼ beat off rejected and the fit redone. The first tap is left out when there are four or more.
  Confidence is steadiness (RMS residual against 10% of a beat) times amount (seven fitted taps =
  full).
- **Validate:** V-40, then E4 tap-lab data.

## E10-1 Skip at a cut stops moves, it can't jump them (drill edits)

- **Context:** "Skip that part of the move" should put marchers where they'd be after the cut. The
  timeline model is continuous: a move starts where the previous one ended, so there is no jump.
- **Choice:** skip changes only moves that run into the cut and end inside it: their destination
  becomes the marchers' positions at the cut's first count (direct paths with one marcher per
  slot and no higher layer there). Moves that run out of the cut or across it are squeezed, and
  the report says why ("marchers can't jump").
- **Alternatives:** split moves at the cut (shapes, arcs and per-slot rows make that a large
  write); leave skip out.
- **Validate:** Persona script, "cut 41–56, make the drill skip that part".

## E10-2 Hold for added counts uses the ripple's holding moves, then takes the page out again

- **Context:** at a page flag, "Hold marchers for these counts" should keep moves landing on their
  count and hold until the flag. `addHoldingMoves` does that for an added page.
- **Choice:** in one transaction: insert the counts plus a page over them (the ripple adds the
  holds), then delete that page row without a ripple, so the owner page gets the counts and later
  pages don't renumber. Hold is only offered at a flag; a move partway through there stretches.
- **Validate:** "4-count vamp before the closer, hold everyone" plays as a hold.

## E10-3 Defaults in the count dialogs

- **Choice:** "Does the recording have these counts?" defaults to Yes (the arranger's vamp comes
  with a recording that has it); at a flag, Hold is the default, elsewhere Stretch; a cut squeezes
  by default; clips only in the cut are deleted with it, and the commit button says so.
- **Validate:** as V-rows: which option directors pick first, unprompted.

## E10-4 Page flag grips in the ruler's lower half

- **Context:** UI-10 keeps a plain drag on the timeline a scrub. The start pennant (upper half of
  the ruler) and the playhead sit on flags too.
- **Choice:** a small grip standing on the ruler's bottom edge at each flag; only it moves a flag.
  A drop is one undo; the readout shows both pages' counts and, after a pause, what the drill does.
- **Validate:** owner hands-on; check grips don't clutter a zoomed-out show.

## E10-5 Previews share the renderer's database connection

- **Context:** a preview runs the edit in BEGIN..ROLLBACK on the one renderer connection, and the
  SQL proxy queue serializes statements, not transactions. A query that fetches while a preview's
  transaction is open reads rows that are then rolled back, and TanStack Query caches them.
- **Choice (mitigation):** one preview at a time (a newer one on a channel replaces a waiting
  one), under `withTimelineWriteLock` (so the resolver's reads wait), and after every rollback the
  app re-fetches every query that was fetching or updated since the preview began.
- **Real fix:** have the proxy queue hold a whole transaction (no other statement between BEGIN
  and COMMIT/ROLLBACK), or run previews on a separate connection to a copy (for example an
  in-memory `VACUUM INTO`, or a dedicated main-process connection).
- **Validate:** no stale page boxes after dragging a flag grip for a while.

## E10-6 Measure lines for added counts carry the meter on

- **Choice:** at a downbeat the new counts are whole measures of the previous measure's length;
  after the last count, the last measure is finished and the meter of the last two lines carries
  on (as E1's `countContinuation`); partway through a measure that measure gets the counts.
- **Validate:** adding 16 counts at a downbeat of a 4/4 show gives four 4-count measures.
