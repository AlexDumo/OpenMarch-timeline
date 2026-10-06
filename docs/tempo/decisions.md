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
## T-8 One rule for which count a moment belongs to (count-parity, E2)

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
