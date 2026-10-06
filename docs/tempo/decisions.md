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

## MR-1 Rehearsal marks belong to their measure (measure row, E8)

- **Context:** a `measures` row stores its downbeat and its mark, so re-barring has to decide
  whether a mark follows its measure (and its number) or stays on its count.
- **Choice:** the mark follows its measure line: re-barring moves the row, and its mark with it,
  so "D at m25" stays at m25. A mark is lost only when its line is removed or pushed past the end
  of the show, and the toast names it with Undo.
- **Alternatives:** keep each mark on its count and move it to whichever measure starts there
  (better for marks set by ear, worse for marks typed from the score).
- **Validate:** V-43.

## MR-2 R marks the nearest downbeat while playing (E8, Dana's E4)

- **Context:** marking "the big hit is here" by ear means pressing a little early or late.
- **Choice:** while playing, R marks the nearest downbeat at once (one undo entry), without
  stopping, then opens the name field with the suggested letter; typing and Enter renames it (a
  second undo entry), and R or Space before anything is typed go on to the timeline, so marking
  hit after hit, or pausing, never types into the field. Paused, R opens the field on the measure
  holding the playhead and writes nothing until Enter. With no measure there, the field explains
  that a mark needs a measure line and Enter starts one at that count.
- **Alternatives:** the measure holding the playhead (a press a hair early lands a measure
  before); a draft that waits for Enter (a press while playing would be lost if ignored).
- **Validate:** V-41.

## MR-3 The suggested mark name (E8)

- **Choice:** the name after the previous mark: A … Z, then AA, BB (doubled letters, as scores
  do); trailing numbers count up ("B2" → "B3", "41" → "42"); a word starts at A. Names the show
  already uses are skipped, so go-to "C" stays unambiguous.
- **Alternatives:** AA, AB (spreadsheet style); allow duplicates.
- **Validate:** V-42.

## MR-4 Beats in mN (E8)

- **Choice:** "Later measures keep their beats" is on by default: every later line moves by the
  difference. Lines pushed past the end are removed. The last measure is open-ended, so shortening
  a measure makes it longer rather than adding lines at the end. Unchecked, the next measure
  absorbs the difference; lines it passes are merged into it (a mark there moves to the line that
  stays when that line has none). "Beats per measure from here" re-bars up to the next rehearsal
  mark (default when there is one) or to the end, and a last shorter measure keeps what's left.
- **Alternatives:** unchecked by default (11-ui.md's "usual case" argues for on).
- **Validate:** V-43.

## MR-5 The measure row's targets (E8)

- **Choice:** measure numbers become buttons when the row can edit (a click names that measure;
  it no longer seeks). A right-click on the row targets a rehearsal tab, else the count tick
  within 6px, else the measure under the pointer. Tabs keep seeking on click (owner rule);
  double-click or Enter renames. Compact mode has no numbers, so only tabs, R and the menu edit
  there.
- **Validate:** V-44.

## MR-6 No ripple, no flag (E8)

- **Context:** the brief's three layers: labels touch neither counts nor timing.
- **Choice:** `editMeasureLines` writes only `measures` rows in one `transactionWithHistory`; it
  doesn't run `withTimelinePageRipple` (nothing for it to do: same beats, same grid). No Tempo lab
  flag: this restores what the click-a-tick popover did before PR 80.
- **Side effects checked:** tempo groups are derived on read (`TempoGroupsFromMeasures`), so a new
  mark or line only changes how the Music modal groups measures; no beat duration is written. Two
  knock-ons remain, as with the old popover: a mid-group mark splits that group, so a later tempo
  edit in the Music modal applies to the smaller group; and re-barring a mixed-meter measure
  (2+2+3 durations) can change whether the modal reads it as mixed meter. Measure numbers after an
  added or removed line renumber everywhere (readout, go-to, PDF), which is the point, but the designer's
  printed sheets will disagree until reprinted.
