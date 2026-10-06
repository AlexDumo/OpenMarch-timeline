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

## MX-1 Which note is the count in each meter (musicxml)

- **Context:** the parser had a lookup table (7/8 as seven quarters, 5/8 and 5/4 as one count a
  bar, `2+2+3` not read). The app stores no time signature, only counts, and reads mixed meter
  as short and long counts in the ratio 2:3.
- **Choice:** one rule (`packages/musicxml-parser/src/meter.ts`): the score's own grouping wins;
  x/1, x/2, x/4 count the denominator, except x/2 counts quarters while the tempo is printed in
  quarters; x/8 and shorter count in groups of 2 and 3 (6/8, 9/8, 12/8 in dotted quarters, 3/8
  one count, 5 → 3+2, 7 → 2+2+3, 8 → 3+3+2, then 3s before 2s). A guessed grouping is a
  highlighted warning in the preview. Unknown meters (4/3, senza misura) keep the previous meter,
  with a warning.
- **Alternatives:** count every denominator note (6/8 in six, 7/8 in seven); a per-meter "count
  in" choice in the preview (Marcus and Sam ask for it; follow-up).
- **Validate:** V-41. The kit's corps exports (7/8, 5/8, 3/2 in quarters, 12/8) match their
  ground truth count times exactly.

## MX-2 rit. and accel. are applied only to a known target (musicxml)

- **Context:** most exports write "rit." as words with no target tempo.
- **Choice:** a rit. or accel. becomes evenly changing tempos per count (like
  `newBeatsFromTempoGroup`, ending one step short of the target) only when a numbered tempo
  follows within 4 measures, goes the right way, and isn't an "a tempo". Otherwise the preview
  says "rit. not applied" and the counts keep their tempo. "a tempo" goes back to the tempo
  before the rit.; "Tempo I" to the first tempo.
- **Alternatives:** guess a target (say 85%); use `<dashes>` to find the end of the line.
- **Validate:** V-42. On the kit's score export the rit. at m53 has no target in the file, so
  every later count is 0.54 s early against the ground truth; a later in-app rit. edit has to fix
  it.

## MX-3 Approximate and odd tempo marks (musicxml)

- **Choice:** "c. 132", "ca 132" and "126-132" read as their first number (an info note).
  Anything without a number keeps the previous tempo, with a warning (no more NaN durations).
  `<sound tempo>` (quarters, decimals allowed) wins over the printed mark. A modulation printed
  with no number (♩. = ♩) is read as "the new note lasts as long as the old one", with a warning.
- **Alternatives:** refuse "c. 132" (the plan's wording); ignore modulations.
- **Validate:** V-43 for the modulation reading.

## MX-4 Pickups and measure numbers (musicxml)

- **Choice:** an `implicit="yes"` measure shorter than its meter keeps only the counts its music
  fills (rounded up to a whole count, with a warning). Import sets `measurementOffset` to the
  file's first measure number, in the import's undo entry, so a pickup reads m0. A file whose
  numbers aren't consecutive gets a warning naming where the app's numbers start to differ.
- **Follow-up:** per-measure numbers (repeats renumbered, "12a") need a column on `measures`.

## MX-5 Import preview and dry run (musicxml)

- **Choice:** picking a file never writes. A dialog shows the summary line and the measures
  where something happens (all measures behind a checkbox), with warning rows highlighted.
  Import runs once in a rolled-back transaction first (ripple and commit checks included); if
  the drill would refuse it, the preview says why and Import stays disabled. The existing
  "page N starts at measure N" mapping is kept and stated in the preview.
- **Validate:** V-44.
