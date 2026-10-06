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

Tap the beat (E6) entries are numbered TB-n so they don't collide with other workers' T-n; the
lead renumbers on merge.

## TB-1 Tapping scales; it doesn't flatten (tap-beat, 2026-10-06)

- **Context:** Dana taps 8 beats near the start; the show's later counts may hold score tempo
  changes (Marcus) or a slower letter C (the kit's `steady`).
- **Choice:** `planTapTheBeat` matches the tapped stretch to the taps on average and scales every
  later count by the same factor, so relative lengths survive. The first synced count after the
  taps stays on the music, with the counts before it re-spaced. From the start, count 1 goes to
  the fitted first tap (`originShift`); from here, the playhead's count stays and absorbs up to
  half a beat of phase.
- **Alternatives:** `setRangeBpm` to the end (one tempo everywhere: wrong for any score with a
  tempo change); only the tapped stretch changes (later music drifts against counts).
- **Validate:** V-TB1.

## TB-2 Applying is never refused; it needs four taps

- **Choice:** Apply is enabled from four taps whatever the confidence ("Keep going…" is advice,
  not a gate); the count limits clamp, and the sentence says so. One undo entry includes the
  offset and the strip's dismissal, so Ctrl+Z brings the strip back with the old timing.
- **Validate:** V-TB2.

## TB-3 ×2 / ÷2 after applying is a new undo entry

- **Choice:** before Apply, ×2/÷2 only change the preview. After, they re-plan from the show as it
  was before the first apply and write again (offset unchanged), as a second undo entry, rather
  than undoing and redoing.
- **Alternatives:** hide ×2/÷2 after Apply; replace the first undo entry.

## TB-4 Taps use the input event's time

- **Context:** on a loaded machine the main thread ran key handlers 300 ms late during playback
  (measured in the headless capture), which made taps uneven and the tempo wrong.
- **Choice:** a tap is `livePosition - (now - event.timeStamp)`, ignored past one second.
- **Validate:** V-TB2 on a slow laptop.

## TB-5 Where the entry points live

- **Choice:** the strip sits over the waveform lane's left edge (full timeline only; compact has
  no room) and sticks to the viewport. "Tap the beat…" is in the Sound popover. The panel floats
  over the bottom of the field so the field and timeline stay visible. No header button.
