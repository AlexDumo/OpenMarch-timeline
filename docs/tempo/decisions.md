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

## T-E7-1 A toggles Align, except while marchers are selected (align)

- **Context:** the brief asks for key A. A already moves selected marchers left (WASD nudge in
  `RegisteredActionsHandler`), and the timeline panel is only shown while the canvas has focus.
- **Choice:** A toggles Align when no marchers are selected; with marchers selected, A keeps
  moving them. The button and its ✕ always work.
- **Alternatives:** Shift+A; a different letter; let A do both (it would move marchers and switch
  views at once).
- **Validate:** V-41.

## T-E7-2 A flag drag syncs the flag; Shift doesn't; a release in place writes nothing (align)

- **Context:** 12-ux.md 3 says any drag syncs; 11-ui.md B used Shift for "only pages N and N+1".
  T-5 left the modifier for the `"shift"` rule to the UI.
- **Choice:** dragging a flag, a rehearsal mark or count 1 adds it to the synced counts in the
  same undo entry; Shift+drag moves it without syncing (12-ux.md). The first sync shows a toast
  once per user (localStorage). A drag released where it started (it snaps back within 6px)
  writes nothing, not even the sync. The `"shift"` after-rule has no modifier yet.
- **Alternatives:** manual sync only (right-click); Shift for "only this page and the next".
- **Validate:** V-42.

## T-E7-3 Flag handles sit above the playhead's head (align)

- **Context:** the playhead usually rests on count 1 (home), so count 1's handle was under the
  playhead head and a drag there scrubbed instead.
- **Choice:** in Align, flag handles are above the playhead (z 55, under **+**'s 60). The playhead
  still scrubs from anywhere else on the ruler.
- **Validate:** capture `tempo-align` step 3.

## T-E7-4 Typed page tempo is 40–400 BPM; dragged tempos read "≈" (align)

- **Context:** a typed "12038" (120 with "38" appended) squeezed a page to nothing in the first
  capture. Sam wants exact typed values shown exactly.
- **Choice:** "Tempo…" accepts 40 to 400 BPM and selects the old value on focus. Page labels show
  a tempo exactly ("152.5") only when every count is the same length and the BPM has at most two
  decimals; a drag's 137.93… reads "≈138".
- **Validate:** V-46.

## T-E7-5 Align's zoom and size (align)

- **Choice:** Align has its own px/s, set on entering so the playhead's page keeps its width, and
  doesn't touch the normal timeline's remembered Fit. The surface is at most 16 000 px wide (so
  its canvases fit at 2× density), which caps px/s for long shows. The waveform is 64px (24px
  compact), drawn from the envelope in 2px bars on the same decibel scale as the normal lane.
- **Validate:** V-44.

## T-E7-6 Holds: which ticks can be grabbed, and what reads as held (align)

- **Choice:** count ticks in the measure row take the pointer only when a count is at least 10px
  wide and isn't a flag. A count longer than 1.6× its page's median count is hatched as held.
  Drags snap to the playhead, then the count's own time (no onsets yet: E5).
- **Validate:** V-45.
