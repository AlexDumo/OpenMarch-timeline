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

## K-0 Test-show kit (kit, 2026-10-06)

Entries K-1 to K-7 are about the test-show kit in `apps/desktop/tempo-kit` (its README has the
fixture list and how to score).

## K-1. Truth times are audio-file seconds

- **Context:** a show's count times start at 0, but the music in a recording starts later. The app links the two with `audioOffsetSeconds` (audio time = show time − offset).
- **Choice:** every truth time is seconds from the start of the audio file. The scorer subtracts the show's offset. A synced show stores `-leadIn`.
- **Alternatives:** times from count 1, which can't score an offset mistake; a lead-in count, which changes the count structure.
- **Validate:** `-synced.dots` scores 0 ms. Moving the offset by 0.1 s scores 100 ms on every count (unit test).

## K-2. What a count is in each meter

- **Context:** the truth has to commit to a count per note value, and today's parser gets several meters wrong.
- **Choice:**
  - 6/8 and 12/8 count dotted quarters.
  - 7/8 counts 2+2+3 and 5/8 counts 3+2 (three and two uneven counts).
  - 3/2 counts quarters: six counts, a step per quarter at ♩=176.
  - A pickup is its own one-count measure, m0, with `measurementOffset` 0.
- **Alternatives:**
  - 3/2 in halves (three counts, as the parser's table has it).
  - 6/8 in six.
  - The pickup inside m1.
- **Validate:** ask Sam how the 3/2 bar is marched. If the answer is halves, change `METERS["3/2"]` and regenerate. The E3 import preview's "count in" choice needs the same answer.

## K-3. Fermata and caesura lengths

- **Choice:**
  - A fermata's seconds are the held count's whole length (3.2 s means the count lasts 3.2 s).
  - A caesura's seconds are silence added after its count.
  - Errors "in counts" divide by the count's length without either, so a held count doesn't hide an error.
- **Alternatives:** a fermata as extra time added to the count.
- **Validate:** read `rubato.json` m5 beat 4 and m14 beat 4 against the WAV.

## K-4. How each "wrong" show is wrong

- **Choice:**
  - Dana: flat ♩=120 (the new-show default).
  - Marcus: every count 4% fast.
  - Jo: only the printed tempos (no rit., accel., fermatas or caesura).
  - Sam: 0.5 s per count whatever the note value.
  - All with no audio offset.
  - Marcus's live take: his render-synced show with the live audio swapped in.
  - Counts, measures and marks are always right, so only timing needs fixing. That keeps every fix duration-only, which the ripple never refuses.
- **Alternatives:** shows imported by today's parser, with its wrong counts. Those test the parser, not alignment, and the MusicXML files already cover that case.
- **Validate:** each persona's script starts from its `-wrong` show and ends with a scorer run.

## K-5. Generated audio stands in for a MuseScore render

- **Context:** the plan asks for a MuseScore render and a real band recording. MuseScore isn't on the capture box, and the recording needs two annotators.
- **Choice:** render the click with `createMetronomeWav`, a louder hit sound at marked hits, and a quiet sustained chord per section, straight from the truth. The truth is then exact to the sample.
- **Alternatives:** time-stretching one render for the live take. The kit renders the live map directly instead, so its truth is exact too.
- **Validate:** E5 (onset snapping) needs something less clean than clicks. Add reverb or a real recording before running it.

## K-6. Score letters, typo and rit.

- **Choice:**
  - The score's rit. leads into H. The lead's task named H; Marcus's persona report said K.
  - The 6/8 section is at I, with the 3/4 bar (m70) closing I before J.
  - v1 prints the ♩=138 typo at F. The audio and `score.json` are v2 (♩=132).
  - The Sibelius export prints "c. 132" at K, restating the tempo, so a parser that refuses or warns there loses nothing.
- **Validate:** Marcus's E12 script. Re-importing v2 over a v1 import should change only the timing after F.

## K-7. The generator runs through vitest

- **Context:** the shows have to be built with the app's own db-functions and converter, which import through the `@/` alias and need a DOM-like environment.
- **Choice:** `generate.kit.ts` is one vitest "test" under its own config (`tempo-kit/vitest.kit.config.mts`), as `~/om-capture/make-fixture` already does. The scorer is plain Node (`score.mts`), so anyone can run it on a saved show.
- **Alternatives:** `tsx` with tsconfig paths. Some app modules pull in browser globals at import time, which vitest's jsdom environment provides.

## T-8 Wizard: counts to the end of the recording, pages stay at the start (show-length, E1)

- **Context:** "Tempo only" made 20 measures (80 counts, 40 s at 120) whatever the MP3's length;
  "Skip for now" made 128 counts. The music past that had no counts, so nothing could be planned
  there.
- **Choice:** with audio and no MusicXML, "Tempo only" makes whole measures of the chosen meter
  at the chosen tempo until the recording ends (at least the 20 starter measures), and "Skip"
  makes counts until it ends (at least 128, still no measures). The starter pages are unchanged
  (five pages at the start, last page 2 measures). The length is the decoded file's duration, read
  once at completion; a file that can't be decoded falls back to the starter length. A MusicXML
  file's own measures set its show's length, unchanged.
- **Alternatives:** pages through the whole song (every 4 measures); a fixed 64 counts with "+"
  to extend (11-ui); asking how long the show is.
- **Validate:** E1 session task 2 ("put a set at the very end of the song"): does anyone ask how
  to add more?

## T-9 **+ N counts**: a page after the last page, N from the "new page counts" setting (show-length, E1)

- **Context:** "+" was offered only at the paused playhead, and never past the show's last count
  (`planPageFlagInsertion` returned null there), with nothing to say why.
- **Choice:** a labelled button, "+ 16 counts" (tooltip "Add a page of 16 counts after the last
  page"), always shown while paused just after the last page's flag. It adds a page of N counts
  after that flag and appends counts only where the show ends before the new flag (all of them
  when the counts end at the last flag, the usual case after the first use). N is the workspace
  setting "Default new page counts" (16 by default, 4 measures for a tempo-only show), which the
  old page-mode "+" used. Appended counts continue the last measure's tempo and count lengths and
  carry on its measure lines. The beats go through `withTimelinePageRipple` and the flag through
  `addPageFlagInTransaction`, in one undoable edit; nothing lies after the end, so it is never
  refused for the drill. When **+** at the playhead would cover it, it moves just past that one.
- **Alternatives:** N from `last_page_counts` (it becomes huge after a page that covers spare
  counts, and the next click would say "+ 230 counts"); the button at the end of the counts with a
  flag at the new end (on a wizard show with counts to 2:31 and pages to 0:36 it would make one
  page of 2 minutes); a plain "+" with no count.
- **Validate:** V-41.

## T-10 The music past the last count: drawn dimmed, with a note that offers extending (show-length, E1)

- **Context:** the waveform lane drew only the music under existing counts, so a show shorter than
  its music looked complete.
- **Choice:** the lane goes on past the last count at 40% opacity, on counts at the show's last
  tempo (as appending would make them), up to where the music ends: the last moment the waveform
  would draw (within 42 dB of the loudest), so the silent padding the player adds isn't music.
  Both parts share one loudness scale. When more than one count of music is left, a note sits in
  the top row just past the last count: "Counts end at 0:48; the music runs to 1:00. Extend counts
  to the end". Extending appends counts (no pages) to the end of the music, finishing the last
  measure, as one undoable edit, and a toast says how many were added. Fit includes the music past
  the end and room for the note, so a fitted timeline shows both. Counts that reach the end within
  50 ms of the music's end count as reaching it.
- **Alternatives:** the note in the Music modal (Dana doesn't open it); a toast on open (lost to
  interruptions); extending automatically when audio is added (a hidden structural change).
- **Validate:** V-42, V-43.

## T-11 One rule for which count a moment belongs to (count-parity, E2)

- **Context:** the timeline readout, the PDF drill sheet and the video overlay named different
  counts and measures for the same moment (on m5's downbeat the video was one count ahead of the
  timeline). See [count-convention.md](count-convention.md).
- **Choice:** count k of a page is the k-th beat line after its start flag, so the flag is the
  last count. A line is named by the beat that starts on it; a moment belongs to the line at or
  before it. Applied to the readout, the PDF measure range and the video overlay; the go-to box
  already agreed.
- **Alternatives:** counts as the beats a page spans (keeps "5 - 8" on sheets, but reverses UI-12
  and UI-13, which put a page's last count on its flag); or a mixed rule that keeps the sheet's
  span range (two answers for one page).
- **Validate:** owner decides whether "5(2) - 9(1)" on drill sheets is acceptable; Sam's script
  (print page 12, scrub to its count 1 and 16, render the video, read all three) finds zero
  mismatches. Note T-3 calls the show's first beat "count 1"; under this rule the first page's
  count 1 is the second beat line, so the two docs should settle one word.

## MR-1 Rehearsal marks belong to their measure (measure row, E8)

- **Context:** a `measures` row stores its downbeat and its mark, so re-barring has to decide
  whether a mark follows its measure (and its number) or stays on its count.
- **Choice:** the mark follows its measure line: re-barring moves the row, and its mark with it,
  so "D at m25" stays at m25. A mark is lost only when its line is removed or pushed past the end
  of the show, and the toast names it with Undo.
- **Alternatives:** keep each mark on its count and move it to whichever measure starts there
  (better for marks set by ear, worse for marks typed from the score).
- **Validate:** V-46.

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
- **Validate:** V-44.

## MR-3 The suggested mark name (E8)

- **Choice:** the name after the previous mark: A … Z, then AA, BB (doubled letters, as scores
  do); trailing numbers count up ("B2" → "B3", "41" → "42"); a word starts at A. Names the show
  already uses are skipped, so go-to "C" stays unambiguous.
- **Alternatives:** AA, AB (spreadsheet style); allow duplicates.
- **Validate:** V-45.

## MR-4 Beats in mN (E8)

- **Choice:** "Later measures keep their beats" is on by default: every later line moves by the
  difference. Lines pushed past the end are removed. The last measure is open-ended, so shortening
  a measure makes it longer rather than adding lines at the end. Unchecked, the next measure
  absorbs the difference; lines it passes are merged into it (a mark there moves to the line that
  stays when that line has none). "Beats per measure from here" re-bars up to the next rehearsal
  mark (default when there is one) or to the end, and a last shorter measure keeps what's left.
- **Alternatives:** unchecked by default (11-ui.md's "usual case" argues for on).
- **Validate:** V-46.

## MR-5 The measure row's targets (E8)

- **Choice:** measure numbers become buttons when the row can edit (a click names that measure;
  it no longer seeks). A right-click on the row targets a rehearsal tab, else the count tick
  within 6px, else the measure under the pointer. Tabs keep seeking on click (owner rule);
  double-click or Enter renames. Compact mode has no numbers, so only tabs, R and the menu edit
  there.
- **Validate:** V-47.

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
- **Validate:** V-48. The kit's corps exports (7/8, 5/8, 3/2 in quarters, 12/8) match their
  ground truth count times exactly.

## MX-2 rit. and accel. are applied only to a known target (musicxml)

- **Context:** most exports write "rit." as words with no target tempo.
- **Choice:** a rit. or accel. becomes evenly changing tempos per count (like
  `newBeatsFromTempoGroup`, ending one step short of the target) only when a numbered tempo
  follows within 4 measures, goes the right way, and isn't an "a tempo". Otherwise the preview
  says "rit. not applied" and the counts keep their tempo. "a tempo" goes back to the tempo
  before the rit.; "Tempo I" to the first tempo.
- **Alternatives:** guess a target (say 85%); use `<dashes>` to find the end of the line.
- **Validate:** V-49. On the kit's score export the rit. at m53 has no target in the file, so
  every later count is 0.54 s early against the ground truth; a later in-app rit. edit has to fix
  it.

## MX-3 Approximate and odd tempo marks (musicxml)

- **Choice:** "c. 132", "ca 132" and "126-132" read as their first number (an info note).
  Anything without a number keeps the previous tempo, with a warning (no more NaN durations).
  `<sound tempo>` (quarters, decimals allowed) wins over the printed mark. A modulation printed
  with no number (♩. = ♩) is read as "the new note lasts as long as the old one", with a warning.
- **Alternatives:** refuse "c. 132" (the plan's wording); ignore modulations.
- **Validate:** V-50 for the modulation reading.

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
- **Validate:** V-51.

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
- **Validate:** V-52.

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
- **Validate:** V-53.

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
- **Validate:** V-52 (open the kit's `score-synced` and `rubato-synced` shows).

## TM-5 Meter edits only regroup (tempo map, E11)

- **Choice:** the meter cell takes a meter with the same number of counts per measure (3/4 to 7/8
  2+2+3, 4/4 to 12/8, 2/4 to 5/8 3+2); anything else is refused with "changes the number of
  counts: not in this prototype". The tempo's number stays and its unit follows the meter, so
  4/4 ♩=120 becomes 12/8 ♩.=120 (same counts) and 3/4 ♩=120 becomes 7/8 2+2+3 ♩=120 (the long
  count gets longer).
- **Alternatives:** keep each measure's length (the eighth changes speed).
- **Validate:** V-53.

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
- **Validate:** V-54.

## TB-2 Applying is never refused; it needs four taps

- **Choice:** Apply is enabled from four taps whatever the confidence ("Keep going…" is advice,
  not a gate); the count limits clamp, and the sentence says so. One undo entry includes the
  offset and the strip's dismissal, so Ctrl+Z brings the strip back with the old timing.
- **Validate:** V-55.

## TB-3 ×2 / ÷2 after applying is a new undo entry

- **Choice:** before Apply, ×2/÷2 only change the preview. After, they re-plan from the show as it
  was before the first apply and write again (offset unchanged), as a second undo entry, rather
  than undoing and redoing.
- **Alternatives:** hide ×2/÷2 after Apply; replace the first undo entry.

## TB-4 Taps use the input event's time

- **Context:** on a loaded machine the main thread ran key handlers 300 ms late during playback
  (measured in the headless capture), which made taps uneven and the tempo wrong.
- **Choice:** a tap is `livePosition - (now - event.timeStamp)`, ignored past one second.
- **Validate:** V-55 on a slow laptop.

## TB-5 Where the entry points live

- **Choice:** the strip sits over the waveform lane's left edge (full timeline only; compact has
  no room) and sticks to the viewport. "Tap the beat…" is in the Sound popover. The panel floats
  over the bottom of the field so the field and timeline stay visible. No header button.

## TB-6 From here plays with a pre-roll

- **Context:** Dana's E2 asks for a pre-roll before "here" so her taps have settled by the
  playhead.
- **Choice:** Play from here starts 8 counts before the playhead. Taps in the pre-roll set the tempo
  but never move counts before the playhead. The playhead's count is fixed when Play or the first
  tap happens, because pausing a play-on run moves the playhead (UI-12).
- **Alternatives:** two measures (needs the meter; counts are what the panel knows); no pre-roll.

## E7-1 A toggles Align, except while marchers are selected (align)

- **Context:** the brief asks for key A. A already moves selected marchers left (WASD nudge in
  `RegisteredActionsHandler`), and the timeline panel is only shown while the canvas has focus.
- **Choice:** A toggles Align when no marchers are selected; with marchers selected, A keeps
  moving them. The button and its ✕ always work.
- **Alternatives:** Shift+A; a different letter; let A do both (it would move marchers and switch
  views at once).
- **Validate:** V-56.

## E7-2 A flag drag syncs the flag; Shift doesn't; a release in place writes nothing (align)

- **Context:** 12-ux.md 3 says any drag syncs; 11-ui.md B used Shift for "only pages N and N+1".
  T-5 left the modifier for the `"shift"` rule to the UI.
- **Choice:** dragging a flag, a rehearsal mark or count 1 adds it to the synced counts in the
  same undo entry; Shift+drag moves it without syncing (12-ux.md). The first sync shows a toast
  once per user (localStorage). A drag released where it started (it snaps back within 6px)
  writes nothing, not even the sync. The `"shift"` after-rule has no modifier yet.
- **Alternatives:** manual sync only (right-click); Shift for "only this page and the next".
- **Validate:** V-57.

## E7-3 Flag handles sit above the playhead's head (align)

- **Context:** the playhead usually rests on count 1 (home), so count 1's handle was under the
  playhead head and a drag there scrubbed instead.
- **Choice:** in Align, flag handles are above the playhead (z 55, under **+**'s 60). The playhead
  still scrubs from anywhere else on the ruler.
- **Validate:** capture `tempo-align` step 3.

## E7-4 Typed page tempo is 40–400 BPM; dragged tempos read "≈" (align)

- **Context:** a typed "12038" (120 with "38" appended) squeezed a page to nothing in the first
  capture. Sam wants exact typed values shown exactly.
- **Choice:** "Tempo…" accepts 40 to 400 BPM and selects the old value on focus. Page labels show
  a tempo exactly ("152.5") only when every count is the same length and the BPM has at most two
  decimals; a drag's 137.93… reads "≈138".
- **Validate:** V-61.

## E7-5 Align's zoom and size (align)

- **Choice:** Align has its own px/s, set on entering so the playhead's page keeps its width, and
  doesn't touch the normal timeline's remembered Fit. The surface is at most 16 000 px wide (so
  its canvases fit at 2× density), which caps px/s for long shows. The waveform is 64px (24px
  compact), drawn from the envelope in 2px bars on the same decibel scale as the normal lane.
- **Validate:** V-59.

## E7-6 Holds: which ticks can be grabbed, and what reads as held (align)

- **Choice:** count ticks in the measure row take the pointer only when a count is at least 10px
  wide and isn't a flag. A count longer than 1.6× its page's median count is hatched as held.
  Drags snap to the playhead, then the count's own time (no onsets yet: E5).
- **Validate:** V-60.

## E7-7 What the other experiments' controls do in Align (align, merge with the integration branch)

- **Context:** E10 draws page flag grips that move a flag to another count, E1 draws **+ N
  counts**, a dimmed waveform past the last count and a "music runs on" note, and E8 makes the
  measure row editable. All of them were built on the counts axis.
- **Choice:** in Align, a flag drag retimes (E7), so E10's grips and **+** at the playhead are
  hidden there: one gesture, one meaning per view (12-ux.md 3). Structural edits stay in the
  right-click menu and in Normal. **+ N counts** and the music note stay, placed after the last
  count on the seconds axis. The dimmed waveform past the end isn't drawn in Align, which already
  draws the whole recording in time. E8's measure row works the same in both views: its numbers,
  tabs, editor and right-click targets all use the timeline's axis. In Align, a rehearsal tab
  also drags its measure onto the music, and a click that ends a drag doesn't seek.
- **Validate:** capture `tempo-align` on the integration branch.

## RI-1 Bars line up by shape first, then by shared marks (re-import, E12)

- **Context:** a corrected score must land on the show's existing counts. Counts carry no bar
  numbers of their own, and arrangers both fix typos (same bars) and add or cut bars (v3).
- **Choice:** `planReimport` (`timeline/tempo/reimport.ts`). If the show and the file have the
  same number of bars with the same counts in each, bar N pairs with bar N whatever the marks say
  ("same structure"). Otherwise bars line up at rehearsal marks both versions use exactly once (in
  the same order), with the first bar lined up by measure number when that makes the stretch up
  to the first mark the same length (a pickup added or dropped). Between two such marks, bars pair
  one to one only if both versions have the same number of bars there; a bar whose count differs
  is left out on its own. A stretch with a different number of bars is left alone entirely and
  reported ("2 bars added before L: m77–82 here is m77–84 in the file"), because counts alone
  can't tell where inside it the bars went, and pairing wrongly would put tempos on the wrong bars.
- **Alternatives:** pair the longest equal prefix and suffix inside the stretch (would usually be
  right for v3, silently wrong when bars go in near the start); match by measure number everywhere
  (an insert renumbers everything after it); a sequence alignment on count lengths (identical 4/4
  bars give no signal).
- **Validate:** V-62.

## RI-2 Paired bars get the file's count lengths; nothing else moves (re-import, E12)

- **Choice:** a paired bar's counts get the file's durations through `retimeBeatsInTransaction`
  (duration-only: same beat ids, same pages, so the ripple is a no-op and drill can't refuse it),
  its rehearsal mark becomes the file's (added, removed or renamed), and the first measure's
  number follows the file when the first bars pair. Unpaired bars and counts outside measures keep
  their lengths and marks. Pages never move to measures (the full import moves page N to measure
  N). Tempo map marks (`tempoMapMarks`) are kept as they are: they're keyed by beat id, which
  survives. One transaction, one undo entry; a re-import that changes nothing writes nothing.
- **Alternatives:** also add or remove counts for the bars that differ (that is E10's
  insert/cut with its drill choices; a later step could call it from here).
- **Validate:** V-62, the kit tests in `db-functions/__test__/musicXmlReimport.test.ts`.

## RI-3 A synced show keeps its alignment by default (re-import, E12)

- **Context:** synced counts mean someone lined the show up with the recording; the score's
  timing would move them off it (Marcus's "this replaces your alignment to live.mp3").
- **Choice:** when the show has synced counts, the preview says how many and how many the score's
  timing would move, and asks: "Keep my alignment, update marks only" (default) or "Use the
  score's timing". With the score's timing, counts it moves more than 1 ms are dropped from the
  synced counts; the rest stay synced. Without synced counts there's no question and the score's
  timing is used.
- **Alternatives:** a third option that keeps synced counts put and re-spaces between them in the
  score's proportions (keeps alignment and picks up a fixed rit. or 6/8 shape; cheap with
  `respaceProportional`, left out to keep the choice to two); keep every synced id even if it
  moved (then "synced" would be a lie).
- **Validate:** V-63. Note that tempo-map rows also sync their edges (TM-3), so a show whose map
  was typed reads as "lined up with the recording" here too.

## RI-4 Update in place first, Replace everything one step further (re-import, E12)

- **Context:** Priya: "a Replace everything import must never be one click away from her drill."
- **Choice:** with the flag on and at least one bar pairing, the preview opens on the Re-import
  summary with **Update show**. **Replace everything…** switches the dialog to the old import
  (with its warning that alignment is lost and pages move, and its dry run), which still needs
  Import. The dry run only runs once Replace everything is chosen. If nothing pairs, the old
  import opens with a note saying so.
- **Validate:** V-64.

## RI-5 What the summary lists (re-import, E12)

- **Choice:** "same bars and counts" or "N of the file's M bars line up"; tempo changes per run
  of bars ("m41–48 (F): tempo 138 → 132", "≈" for uneven bars, at most 6 lines then "and N
  more"); when the show ends now ("3:02 (was 3:00, +1.9 s)"); marks added, removed, renamed;
  numbering; then the bars that don't line up, highlighted. Tempos are counts per minute, without
  a note value (counts carry none; see TM-1).

## PT-1 Tap targets are named as the transport reads them (punch-tap, E9)

- **Context:** the task's chip read "Next tap → Pg 12 ct 1" for a page start. In OpenMarch a
  page's counts lead up to its flag (UI-13): the moment a page starts is the previous page's
  flag, which the transport reads "Pg 11 · ct 16/16"; "Pg 12 ct 1" is one count later.
- **Choice:** the chip names the target the way the transport would with the playhead on it:
  "Next tap → Pg 11 ct 16" in page mode, "→ Pg 12 ct 5" in count mode, "→ count 1" for the
  start. The target flag also gets a ring and a **T** badge on the ruler, so the words are a
  second cue.
- **Alternatives:** "Pg 12 ct 1" (contradicts the readout); "start of Pg 12" (new phrase).
- **Validate:** V-65.

## PT-2 What a tap sets, and when (punch-tap, E9)

- **Choice:** taps are sequential: each sets the next target after the one it set. Paused, the
  target is the first at or after the selected range's start (or the playhead), and T plays a
  count-in: from the previous flag (one page) in page mode, 8 counts before in count mode. If
  From start is on, T plays the user's own window (and loop), as Space does. Playing without a
  chosen target (Space, a loop restart, a jump back), the target is the next one the music hasn't
  passed, with half a count of grace. A tap after the last target does nothing.
- **Alternatives:** nearest target by time (wrong whenever the timing is far off, which is the
  case being fixed); restarting the take on a loop.
- **Validate:** V-65.

## PT-3 Mistakes: bounce, Backspace, amber, retarget (punch-tap, E9)

- **Choice:** a tap within 120 ms of the last is ignored. Backspace drops the last tap, brings
  back the draft it replaced and steps the target back (it may reach into an earlier loop pass).
  A tap whose span is more than 35% faster or slower per count than the span before it is drawn
  amber with "Missed a tap? …", never discarded. Clicking a flag (or a draft's tag) makes it the
  next target; new taps replace only the drafts on the counts they hit, so looping a page keeps
  the latest tap per flag.
- **Alternatives:** ±25% (11-ui.md); dropping suspect taps; Delete on a selected tap (not built).
- **Validate:** V-66. The 35% is a guess: Jo's report says fermatas, ritardandos and the caesura will
  all go amber, which teaches users to ignore it. E1 should measure it.

## PT-4 Drafts draw over the stored timing (punch-tap, E9)

- **Context:** a drag preview redraws the whole Align axis on the edited timing. While playing,
  that moves the playhead off the music (it is placed by count).
- **Choice:** the stored timing stays drawn; drafts are dashed lines at the tap times with
  numbered tags, the next target has a ring and a **T** badge, and the Align preview layer tints
  the re-spaced and shifted counts on the drafted timing, with the flags that would move drawn
  dotted where they'd land.
- **Validate:** capture `tempo-punch-tap`.

## PT-5 Applying (punch-tap, E9)

- **Choice:** `tapApply: "stop"` writes the take when playback stops (a pause too); a stop with no
  taps writes nothing. `"drafts"` keeps drafts until Enter or Apply; Esc once asks, a second Esc
  within 3 s discards. Either way it's one `retimeBeats` write (one undo; duration-only, never
  refused) with the tapped counts synced (count 1 moves the audio offset instead), and a toast
  "Lined up pages 12–18 to your taps." with Undo. Leaving Align keeps drafts in memory; closing
  the show loses them without asking (not built).
- **Validate:** V-67.

## FB-1 Tapping syncs what it put on the music (fix-beginner, E6)

- **Context:** after Tap the beat, only count 1 was synced, so the first Align flag drag re-spaced
  every page back to count 1 and moved a hit Dana had just lined up (Dana, major 1).
- **Choice:** applying taps (`syncedAfterTaps`) syncs the first and last tapped counts, and, From
  here, the playhead's count too (it stays put); synced counts the taps moved are dropped as
  before. ×2 / ÷2 after applying re-derive the set from the synced counts before the apply. The
  counts the taps only extrapolated (after the last tap) aren't synced: they aren't evidence.
- **Alternatives:** sync every page flag in the tapped stretch (more protection, but a tapped
  stretch is usually 8 counts, inside one page); sync nothing and rely on FB-2 alone.
- **Validate:** V-68.

## FB-2 An Align flag drag changes its page only (fix-beginner, E7; Tempo lab `alignDragScope`)

- **Context:** a flag drag re-spaced back to the previous **synced** count, so flags left alone
  because they were right moved (Jo blocker 1, Dana major 1, Priya). Holds did the same up to the
  next synced count, so a second hold in a page moved the first.
- **Choice:** `alignDragScope: "page"` (default): a flag (or rehearsal mark, or measure line) drag
  re-spaces back to the previous flag, synced or not (`moveCount({ respaceFrom })`); after it,
  counts re-space up to the next synced count as before, or shift. A count-tick hold absorbs the
  change up to the next flag after it (`holdCount({ absorbUntil })`), so the page's flag stays and
  later pages don't move; on a page's last count it absorbs into the next page. `"toSynced"`
  keeps E7's first rule for comparison. When the re-spaced range spans more than one page (always
  possible with `toSynced`, or a mark drag across a flag) the chip says from where: "Pg 1–11 · 138
  → 135 · since the start". A stop at an unsynced flag reads "up to Pg 5 ct 8", not "synced".
- **Alternatives:** sync every flag left of the last drag (Jo's alternative: protects more, but
  hidden state accumulates); Shift for the wide drag (Shift already means "don't sync").
- **Validate:** V-69, comparing both settings on `rubato-wrong` and Dana's show.

## FB-3 One name for a place (fix-beginner)

- **Context:** one count was "page 10's flag" on the ruler and toast, "Pg 10 · ct 16/16" in the
  transport, "page 11, count 1" in Tap the beat and "synced Pg 12" in the chip (bug B2, `afterPart`
  named the page that _starts_ at the synced count).
- **Choice:** everything follows the transport (count-convention.md rule A, UI-13): a tick is
  "Pg N ct M", counted from the page's start flag, so a flag is the last count of the page it
  closes ("Pg 10 ct 16"). The chip (`countName`), the synced toast ("Pg 11 ct 16 is now
  synced…"), and Tap the beat (`countLabel`: "From Pg 10 ct 16, counts will run…") all use it;
  the show's start is "the start". The count-1 chip reads from the music's side: "Count 1 is
  1.84 s into the music" (Jo minor 9).
- **Not done:** naming by rehearsal letter ("from C"), which Dana would prefer; it needs the
  measures in the chip and panel and a rule for a letter that isn't on a page start.
- **Validate:** V-70.

## FB-4 Tap the beat stays findable (fix-beginner, E6)

- **Context:** once the strip went, Tap the beat lived only in the Sound popover (Dana major 3).
- **Choice:** a small "Tap the beat" button at the right of the waveform lane: in Normal view it
  appears while the pointer is over the timeline (no permanent header button), in Align it stays
  (the strip is hidden there, FB-11). When the paused playhead is 32 counts or more past the last
  synced count before it (`suggestTapAgain`), it reads "Tap again from here", stays visible, and
  opens the panel on From here. The panel, after applying, offers "Tap again from here" in place
  of "Tap again" when the playhead is 32 counts from the tapped stretch.
- **Alternatives:** a transport button next to Align (critique; adds a permanent header item);
  "Tap the beat from C" in the rehearsal tab menu (not built).
- **Validate:** V-71.

## FB-5 Taps show on the timeline before Apply (fix-beginner, E6)

- **Choice:** while the panel previews, the timeline draws each tap as a tick at the top of the
  lanes and a dashed accent line where each changed count would land (`tapGhostCounts`), on the
  current axis: in Normal view the lines sit off the count grid by as much as the counts would
  move; in Align they sit on the music. After Apply the changed range flashes once (1.6 s).
- **Alternatives:** switch to Align while tapping (a hidden mode change, UI rules forbid it);
  redraw the whole axis on the plan (moves the playhead off the music while playing, PT-4).
- **Validate:** V-72.

## FB-6 The pulse check, hearing it first, and From here at home (fix-beginner, E6)

- **Choice:** a tapped tempo above 200 or below 60 per minute shows "Did you tap twice per count?
  [÷2]" or "Did you tap every other count? [×2]" in amber instead of "That's steady".
  **Play with clicks** sits before **Apply** and, before applying, clicks on the plan's counts
  (scheduled from the live position; the metronome follows stored counts). **From here** is off
  while the playhead is at home (it would retime from count 1: Jo), with a line saying to move the
  playhead first. When the plan moves synced counts, the sentence is amber and Apply reads "Apply
  (moves 7 synced counts)".
- **Alternatives:** 40–240 (a ballad in 2 or a fast march would trip 60–200; owner to tune).
- **Validate:** V-73.

## FB-7 Pages to the end of the music in one step (fix-beginner, E1)

- **Context:** a show made from an MP3 has counts to the end of the song but five pages; "+ 16
  counts" added a page over counts that already existed (bug B3).
- **Choice:** when 16 or more counts lie past the last flag, the pill reads "+ page of 16 counts"
  ("Add a page over the next 16 counts"), and a second pill "Pages every 16 counts to the end"
  adds a flag every N counts (N is the show's new-page counts) to the end of the show, with a
  shorter last page for the remainder (`pageFlagsToEnd`, `appendPagesToEnd`): one undo, no counts
  added, drill untouched.
- **Alternatives:** create the pages in the wizard (the critique's suggestion: fewer clicks, but
  decides page lengths for the user before they've heard the music); 4 measures per page.
- **Validate:** V-74.

## FB-8 Small drags in Align count (fix-beginner, E7)

- **Choice:** a drop lands back on the old place only within 2 px (`ALIGN_ORIGIN_SNAP_PX`; was the
  6 px snap, 0.31 s at the opening zoom, Jo blocker 2); the playhead snap stays 6 px; a drag still
  starts after 3 px. A drag that would change nothing shows "No change: zoom in (Ctrl+scroll) for
  finer moves" in the chip, and as a toast when dropped.
- **Validate:** V-69 (fine corrections on `rubato-wrong` at the opening zoom).

## FB-9 Rehearsal marks have unique names; R says when a mark is already there (fix-beginner, E8)

- **Choice:** naming or renaming a mark to a name another measure has (ignoring case) is refused
  with "There's already a C at m12", and the input stays open with the typed text. R while
  playing on a measure that already has a mark shows "C is already at m41. Pause and double-click
  it to rename it." instead of a rename box the music runs past. Paused, R still opens the rename.
- **Alternatives:** "Move C here" (retime C onto the press, the critique's suggestion; a tempo edit
  from a label key felt too surprising for R).
- **Validate:** V-75.

## FB-10 The wizard's tempo is optional with music (fix-beginner)

- **Choice:** with an audio file and Tempo lab `tapTheBeat` on, the Tempo step labels the BPM
  "Tempo (BPM), if you know it" and offers "I don't know: I'll tap it", which greys out the field
  and creates the show at 120 with a note that Tap the beat lines it up once it opens.
- **Validate:** V-74 (the same first-show run).

## FB-11 Align's own small fixes (fix-beginner)

- The line-up strip isn't drawn in Align, where it covered the pickup (Jo); the lane button stands
  in.
- Clicking a rehearsal tab in Align seeks again: any pointer jitter used to count as a drag and
  swallow the click (Jo bug 3). Backspace no longer removes a mark in Align (Jo major 6).
- A ruler page box shows its tempo note only when name and note fit on one line, so it no
  longer wraps onto the time line (Dana B4, Jo bug 6). `formatShowTime` no longer reads "1:16.10"
  (Jo bug 2).

## FE-1 Undo refreshes after every history write (fix pass, Priya blocker)

- **Context:** count edits (cut, add counts, page flag grips) commit through
  `transactionWithHistory` outside a TanStack mutation. The app refreshed `canUndo` only on
  mutation events, so Undo stayed greyed out and Ctrl+Z said there was nothing to undo.
- **Choice:** `transactionWithHistory` notifies `subscribeHistoryWrites` listeners after it
  commits; `refreshHistoryOnWrites` (App) invalidates the history queries on those and on
  mutations. Every write is covered, whoever calls it, so new tempo paths can't regress this.
- **Alternatives:** route every commit through `useMutation`; invalidate `historyKeys` in each
  caller (the drill-edit dialog does too, as a belt).
- **Validate:** `historyWrites.test.ts` (one test per write path); V-82.

## FE-2 A cut keeps its first rehearsal mark, and says how measures renumber (fix pass)

- **Context:** a cut silently deleted marks on removed measures (F at m41) and renumbered every
  measure after it.
- **Choice:** by default (`marks: "move"`) the first mark on a removed measure moves to the first
  measure after the cut, unless that measure has its own; other marks in the cut go. The dialog
  offers "Keep F on the first measure after the cut" / "Remove F", and the report's summary lists
  marks that move or go, "Later measures renumber: m57–96 become m41–80", and marks whose number
  changes ("G m65 → m49"). The cut's measures go in the dialog's subtitle ("m41–56 (Pg 11 ct 1 –
  Pg 14 ct 16): 64 counts"). Add counts reports renumbering the same way.
- **Alternatives:** always drop (as before); move every mark (two marks on one measure).
- **Validate:** V-83.

## FE-3 "Did the recording lose these counts too?" on a cut (fix pass)

- **Choice:** asked only when audio is loaded; default yes (their time goes with them). No keeps
  the music where it is: the counts after the cut, to the end of the page that then holds them,
  slow down evenly to fill the cut's seconds, so every later page keeps its time. The report shows
  the tempo change ("Pg 11 gets slower: 120 → 24 BPM"), flagged as a warning when over half.
- **Alternatives:** spread the time over the rest of the show (the end lines up, nothing else
  does); a long hold on the last count before the cut; leave a gap (counts can't have one).
- **Validate:** V-84. Open question: is "No" ever what a drill writer wants, or is it only "the
  new recording isn't here yet"? If the latter, "Yes" plus a note may be enough.

## FE-4 Starting a cut (fix pass)

- **Choice:** any measure number (its downbeat tick), measure or tab offers "Remove m49's
  counts…" (lowercase m everywhere); a right-click anywhere inside a drawn range (ruler, measure
  row, waveform, clips) offers Remove counts… for the range; a right-click on empty space opens a
  menu with Add counts at the playhead…; Ctrl/⌘+drag that starts on the
  playhead draws a range (it used to scrub); with nothing drawn the menu says "Ctrl+drag across
  measures to remove counts". The range is cleared after a count edit.
- **Alternatives:** a "Remove measures…" dialog with from/to fields (Priya's suggestion; more
  typing, but closer to how she thinks; not built).
- **Validate:** V-85.

## FE-5 Big steps and big tempo changes are warnings (fix pass)

- **Choice:** a squeezed or stretched move is a warning (red, "!", "big steps, check this move")
  when its largest step becomes bigger than 5 to 5, or gets more than half as long again while
  bigger than 8 to 5; a step that was already a sprint and barely changes isn't flagged again. A
  page tempo that changes by more than half is a warning too. The summary (marks, renumbering,
  show length) sits under the dialog's title, above the choices; the clip lines follow in a box
  up to 38% of the window, and the dialog may grow to 88% of it.
- **Validate:** V-86. The thresholds are guesses for show tempo; a slow ballad tolerates bigger
  steps.

## FE-6 Holds are named after their measure (fix pass)

- **Choice:** holding moves an add-with-hold makes are named "Hold (vamp m70)" (stored text,
  English, like a typed clip name).
- **Alternatives:** keep page moves and holds out of the clip lanes (bigger change; the page's
  own move still shows as a clip once its page box grows).

## FE-7 Align menus and the mixed-tempo chip (fix pass)

- **Context:** a mouse click on Mark as synced fell through the portal to the pointer surface
  (React events bubble through portals), which moved the playhead and captured the pointer, so the item was
  never chosen.
- **Choice:** the Align flag menu and the timeline's right-click menu stop pointer, click and
  context-menu events at their content. A flag drag that re-spaces pages whose tempos differ by
  1.5× or more turns the chip amber: "Pg 1–16 · avg 92 → 94 · includes 168 and 72 BPM sections,
  all re-spaced alike". The drag's scope is unchanged (another worker owns it).
- **Validate:** V-87.

## FE-8 Moving a rehearsal mark by dragging its tab (fix pass)

- **Choice:** in the Normal view a tab drags along the measure row and drops on the nearest
  measure: a label-only edit (`moveMark`), one undo; a measure with a mark of its own refuses
  (red ghost). In Align the tab drag still retimes; both tooltips say so. A pointer click on a
  tab seeks and leaves it unfocused, so Backspace (Jo's "drop the last tap") can't remove it;
  keyboard focus still renames (Enter) or removes (Delete).
- **Alternatives:** the same gesture in both views (two meanings for one gesture remain); a
  "Move G to…" menu item.
- **Validate:** V-88.

## FX-1 The tempo map opens in its grid and keeps its keys (expert fixes, E11)

- **Context:** Sam pressed Shift+T and typed; focus was on ✕, so "=prev" started playback and
  made a rehearsal mark "ev".
- **Choice:** the map opens with the focus in the grid on the first row's tempo cell (Radix
  `onOpenAutoFocus`). While anything in the map has the focus, keys stop there (the panel's
  `onKeyDown` stops propagation) except Ctrl/⌘ shortcuts (undo, save) and Esc, which closes it.
  A click outside the map gives the keys back to the app.
- **Alternatives:** a modal map (the timeline couldn't be played while typing); block only the
  known single-key shortcuts (misses new ones).
- **Validate:** V-76.

## FX-2 "=prev" and relations carry the pulse (expert fixes, E11; replaces part of TM-6)

- **Context:** after m25 `e=352`, `=prev` on the 6/4 row wrote ♩=352: the number went across
  units and the show drifted a second.
- **Choice:** `=prev` takes the previous row's last tempo and converts it into this row's unit
  (same note length), so `e=352` then `=prev` in ♩ is ♩=176, and 4/4 ♩=152.5 then `=prev` in 12/8
  is ♩.=101.667. `♩.=♩` already did this. Confirmations show what was written ("m29: ♩=176"), not
  what was typed.
- **Alternatives:** keep the count rate (TM-6's old rule; it is what made the bug).

## FX-3 The import writes the tempo map's marks (expert fixes, E3/E12)

- **Context:** the preview read 6/8 ♩.=88, 3/2 in ♩, 7/8 2+2+3 and the pickup, but the map then
  showed "2/4 ♩=88", "6/4" and "1/4": counts carry no note values (TM-1). Typing the score's own
  ♩.=86 then played 1.5× too fast.
- **Choice:** a MusicXML import stores a `tempoMapMarks` entry (source "import") at the first
  measure, every meter change and every tempo marking: the meter as counted (from the parser's
  count lengths), the score's own text as `label` when it counts differently ("3/2" counted in ♩,
  "3/4+3/8"), and the marking's unit and tempo (from the quarter tempo the counts use). A marked
  measure shorter than its meter is a pickup ("4/4 pickup, 1 count"), counted as the meter's last
  counts. A re-import gives paired bars the file's marks, drops import marks the file no longer
  has, and keeps typed rows when the show keeps its timing. Separately, a dotted unit typed over
  counts read as plain quarters (no meter typed or imported) makes them compound: ♩.=86 over "2/4"
  is 6/8 ♩.=86. Sibelius' ♩. = ♩ is an "info" note ("read as ♩.=152.5"), not a warning.
- **Alternatives:** a meter column on `measures` (migration; the ADR's long-term home); ask
  "Each count here is a ♩., set ♩.=86?" instead of reinterpreting.
- **Validate:** V-77.

## FX-4 "=" means written, "≈" anything else (expert fixes, E11)

- **Context:** a drag over typed ♩=176 left "♩=185.035" with "=", the glyph for typed values;
  after Align, Marcus's map showed fitted tempos as exact.
- **Choice:** marks store the tempo they were given (`bpm`, `endBpm` for a rit.). A marked row
  shows "=" while it still plays at that tempo (within 1e-6); once something else changed it, it
  shows "≈" and its dot turns ○ with "Typed ♩=176; changed since (now ♩≈185)". A row without a
  stored tempo (older files, rows nobody typed) shows "=" only for a steady tempo with at most two
  decimals, as E7-4 does for page labels.
- **Alternatives:** a "Score" and a "Plays" column (Marcus; more surface); "=" only for marks
  (a show made with the wizard at 120 would read "≈120").
- **Validate:** V-78.

## FX-5 Typed sections need an Override; count 1 always moves the music start (expert fixes, E7)

- **Context:** an Align drag inside typed ♩=176 re-spaced it silently; nudging count 1 after
  typing squeezed the typed pickup to 400 BPM because the typed rows' synced edges held the rest.
- **Choice:** rows typed in the map (source "typed") that still play as typed are protected
  sections (both edges were already synced, TM-3). A drag, hold or nudge that would give any of
  their counts another length says so in an amber chip ("Overrides typed ♩=176 (m1–16)") and on
  release waits for **Override** (Enter) or **Keep typed** (Esc). After an override the row reads
  "≈" (FX-4) and is no longer protected. Imported rows aren't protected: lining a score up with a
  live take is what Align is for. Count 1's drag and arrow nudges always shift the whole show
  (`after: "shift"`, the audio offset changes), whatever is synced. The Music panel's Audio Offset
  shows milliseconds and says its sign in words ("Count 1 is 0.500 s into the music (the
  recording starts first)."); count 1's handle label says the same.
- **Alternatives:** a modifier (Ctrl/⌘ is range drawing, Alt no snapping, Shift no sync: none
  free); refuse the drag outright; protect imported rows too.
- **Validate:** V-79, V-80.

## FX-6 Re-import keeps a hand-made rit. and counts only real alignment (expert fixes, E12)

- **Context:** a file's "rit." without a target flattened the show's rit. at m53–54; "lined up
  with the recording at 2 places" counted typed tempo map rows, even with no audio; the dialog's
  buttons spilled over the timeline.
- **Choice:** where the file has a rit. or accel. with no target and the show's bar there is
  uneven, the show's timing stays for that bar and the uneven paired bars after it (at most four),
  and the summary says "m53–54: your rit. or accel. stays as it is…". Synced counts that are a
  typed row's edge don't count as lined up with the recording, and with no audio loaded the
  question isn't asked (the score's timing is used). The dialog is at most 40rem (or the window)
  tall; its body scrolls and the buttons stay in the box.
- **Alternatives:** keep a fixed four bars from the rit.; an unchecked "flatten my rit." line.
- **Validate:** V-81.

## FX-7 Tempos in the score's note in Align and the readout (expert fixes, E7)

- **Choice:** where the tempo map counts in another note than a plain ♩ (6/8 in ♩., or 5/8 3+2
  whose long count is 1.5 ♩), page labels, the Align chip and the transport readout show
  "♩.=88" / "♩.≈85" / "♩=176" from the map's units; plain ♩ shows the number as before ("120",
  "120 BPM"). A page that runs into another note reads the tempo where it starts, never an average
  across a meter change.
- **Validate:** V-77 (open the imported score in Align).
