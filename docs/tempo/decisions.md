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
