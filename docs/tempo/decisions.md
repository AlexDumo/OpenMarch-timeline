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

## TM-1 The meter is read from count lengths unless a row is typed (tempo map, E11)

- **Context:** counts carry no note values. 7/8 2+2+3 is three counts at 2:2:3, but 12/8 at
  ♩.=152.5 and 4/4 at ♩=152.5 are the same four equal counts.
- **Choice:** `inferMeter` reads ratios of 1, 1.5 and 2 to a measure's shortest count (within 3%)
  as a grouping in eighths (2:2:3 is 7/8 2+2+3, 3:2 is 5/8 3+2); anything else, including equal
  counts, a rit. or a fermata, is n/4. A typed row stores a **mark** (meter and beat unit) at its
  measure in `tempoMapMarks` (workspace settings, by the measure's start beat id, written with
  the retime in the same undo entry, as `tempoSyncedBeatIds`). A mark carries on through later
  measures with the same number of counts and no conflicting grouping.
- **Alternatives:** a `meter` column on `measures` (migration; the right home if the map stays,
  see the synced counts ADR); infer only, so 12/8 can never be shown.
- **Validate:** V-TM-1.

## TM-2 A typed tempo is exact, and later counts shift (tempo map, E11)

- **Context:** "♩=152.5" from a score means every count of the row at 152.5. The drag rule
  re-spaces up to the next synced count instead.
- **Choice:** the row's counts get exactly the typed tempo (`setRangeRamp`, weighted by the
  meter: the long count of 7/8 2+2+3 lasts 1.5 ♩), a rit. keeps the tempo it ends on, and every
  later count shifts. Holds inside the row are flattened (Ctrl+Z brings them back). Nothing
  re-spaces to keep a later synced count in place: in a typed map every row edge is synced, so
  re-spacing would rewrite the next row the user also typed.
- **Alternatives:** `keepRelative` (the average becomes the typed tempo, holds survive, but the
  cell then shows "≈"); `keepSyncedAfter` (later synced counts stay on the music).
- **Validate:** V-TM-2.

## TM-3 Typed rows sync their edges (tempo map, E11)

- **Choice:** a tempo, rit. or meter edit adds the row's first count and the count after its last
  to the synced counts (core's `tempoSyncedBeatIds`); "Add row at m45" syncs m45's first count;
  removing a typed row (Delete) drops its mark and takes its first count out of the synced counts. So Align drags stop at
  the map's rows.
- **Alternatives:** keep the map and synced counts separate; sync only the row's first count.
- **Validate:** with the Align view (E7) once both are on the integration branch.

## TM-4 Where rows start (tempo map, E11)

- **Choice:** at a typed mark, a meter or unit change, a change of steady tempo, and where steady
  counts turn uneven or back. Consecutive uneven measures are one row, so a rit. over two bars is
  one row. A row whose tempos fall on a straight line count by count (first count at the start
  tempo, last at the end, as the kit renders them) shows "rit./accel. to ♩=100"; any other uneven
  row shows its average with "≈".
- **Validate:** V-TM-1 (open the kit's `score-synced` and `rubato-synced` shows).

## TM-5 Meter edits only regroup (tempo map, E11)

- **Choice:** the meter cell takes a meter with the same number of counts per measure (3/4 to 7/8
  2+2+3, 4/4 to 12/8, 2/4 to 5/8 3+2); anything else is refused with "changes the number of
  counts: not in this prototype". The tempo's number stays and its unit follows the meter, so
  4/4 ♩=120 becomes 12/8 ♩.=120 (same counts) and 3/4 ♩=120 becomes 7/8 2+2+3 ♩=120 (the long
  count gets longer).
- **Alternatives:** keep each measure's length (the eighth changes speed).
- **Validate:** V-TM-2.

## TM-6 Relations are worked out once (tempo map, E11)

- **Choice:** "♩.=♩" makes this row's ♩. last as long as the previous row's last ♩;
  "=prev" keeps the previous row's last tempo number in this row's unit (the count goes on at the
  same rate). Both are written as numbers; changing the previous row later doesn't follow.
- **Alternatives:** live links between rows (needs storage and a cascade rule).

## TM-7 A side panel behind the ⋯ menu (tempo map, E11)

- **Choice:** with the flag on, the transport gets a "⋯" menu with "Tempo map…" and Shift+T opens
  it (free in `RegisteredActionsHandler`; Alt+T is Focus timeline). It's a non-modal panel on
  the right, so the timeline and field stay visible and playable. With the flag off there is no
  menu and no shortcut.
