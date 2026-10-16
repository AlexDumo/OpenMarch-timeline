# Spec: endless counts

Status: **accepted**, 2026-10-16 (decisions at the end). Builds on the show-length work in this branch (E1: T-8, T-9, T-10,
FB-7). A larger change, storing a tempo map instead of beat rows, is a separate question:
AlexDumo/OpenMarch-timeline#264. This spec doesn't need it.

## Problem

A show's counts are its `beats` rows, and nothing after the last one can be planned, played or
flagged. E1 makes that easier to live with (**+ 16 counts**, "Extend counts to the end", counts to
the end of the recording in the wizard), but the user still has to make counts before using them.
Creative tools with a timeline don't ask for that: the grid just keeps going.

## Behavior

1. **The counts never end.** Past the last stored count, the timeline keeps drawing counts and
   measure lines, on both the counts axis and the Align seconds axis. They continue the last
   stored count's tempo and the last measure's meter (`countContinuation`, the rule E1's append
   already uses). Nothing marks where the stored counts stop: a count looks the same whether it's
   stored or not.
2. **The tempo after the end is the last tempo.** A tempo or meter change is an edit to stored
   counts (Tempo…, Align, tap, the tempo map), and the endless counts after it follow whatever
   comes last. Retiming the last stored measure retimes everything after it.
3. **Counts are stored when something lands on them.** Placing anything at or past the stored
   end first appends counts up to it, in the same transaction and undo step: **+** or a page flag
   drag, the last page's length, a timeline move or resize, a measure line or rehearsal mark, an
   Align drag or a punch-in take. Undoing the edit removes the counts with it. Looking, scrolling,
   scrubbing and playing store nothing.
4. **The show's end is the end of the last page:** its flag plus its counts (`last_page_counts`).
   Those counts are always stored (rule 3). It's where drill ends, and exports end there, as they
   do now.
5. **Playback goes on past the show's end** to the end of the music (T-10's `musicEndSeconds`),
   so you can hear what's left to plan. With no music, or music that ends first, it stops at the
   show's end. The playhead can be dragged or stepped anywhere.
6. **The timeline scrolls on.** The scroll extent is the later of the show's end and the music's
   end, plus one screen, and grows as you scroll or seek right. Fit shows the show and the music,
   as T-10's fit does now.
7. **Counts past the show's end belong to no page.** The readout names them by how far past the
   end they are: **END +1** is the first count after the last page ends, **END +5** the fifth. At
   the end itself the readout names the last page's last count, as DN-1 does now.

### What happens to E1

| Piece                                  | Now                                      | With endless counts                                                                                                |
| -------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| T-8 wizard counts to end of recording  | Stores counts to the end of the MP3      | Stores only what the starter pages need. MusicXML still stores its measures, and counts carry on after them.       |
| T-9 **+ 16 counts**                    | Adds a page and appends counts under it  | Stays as the quick way to add a page of N counts. **+** at the playhead now works at any count past the last page. |
| T-10 dimmed music past the last count  | Dimmed waveform and "Extend counts" note | Goes. The waveform draws in full and there's nothing to extend.                                                    |
| FB-7 Pages every N counts to the end   | Flags every N counts to the last count   | Stays, to the end of the music, storing counts as it goes. With no music it isn't offered.                         |
| `extendCountsTo`, `countsToCoverAudio` | Used by the note and the wizard          | Removed once nothing calls them.                                                                                   |

## Design

### The seam: a count grid

One pure module in `apps/desktop/src/timeline/` (working name `countGrid.ts`) owns "counts that go
on forever". It's built from the stored beats (with timestamps) and the measure starts, and
answers:

- `timeAtBeat(b)` and `beatAtTime(s)` for any `b ≥ 0` and `s ≥ 0`, with no clamp at the stored
  end. Inside the stored counts they agree exactly with `timeMap.ts`. Past them they step through
  `countContinuation`, using a running sum cached by count (or a closed form when the continuation
  repeats a fixed pattern, which it always does: one length, or one measure's lengths).
- `countsIn(fromBeat, toBeat)`: each count line and measure line in a range, for drawing only what
  is on screen.
- `storedCount`, and `isStored(b)`.

`timeMap.ts` stays as it is for code that means "the stored counts" (conversion, exports, the
page converter). Code that draws, scrubs or plays moves to the grid. Consumers move one at a time,
and each move is a small, testable change.

### The write path

`ensureCountsInTransaction({ tx, through })` appends `max(0, through - beatCount)` counts with
`appendCountsInTransaction` (which already writes measure lines and runs inside
`withTimelinePageRipple`). It's called first by each write that can name a count past the end:

- `addPageFlagInTransaction` and the flag move in `pageFlags.ts` (today they refuse past the
  show's end with `show-end`); `planPageFlagInsertion` loses its `beat <= beatCount` limit.
- Setting `last_page_counts` (the last page's length).
- Timeline move create, move and resize (`TimelineClipResize`'s `beatCount` cap goes).
- Measure line and rehearsal mark edits (`measureLines.ts` refuses at `beatCount` today).
- Align drags, punch-in takes and tap, where they reach past the end.
- `Page` push and yank (`Page.ts`), where they need counts that aren't stored.

Timeline rows use plain count numbers (`start_beat`/`end_beat`), so no drill row moves. Pages
and measures point at beat ids, which is why their writes need the counts stored first.

### File format

No migration and no new stored field. Everything placed is stored, so an older app opens the file
and sees the same show. The page converter and the web editor read the same rows.

### Where the code assumes the counts end

From a read of this branch (2026-10-16). "Show end" below means rule 4.

| Area       | Where                                                                                                                                | Today                                                    | Change                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------- |
| Conversion | `timeline/timeMap.ts`, `timeline/timelineCanvas.ts` (`playbackBeat`)                                                                 | Clamp at `beats.length`                                  | Drawing and playback use the grid                       |
| Axis       | `timeline/timelineViewModel.ts:773`, `components/timeline/timelineAxis.ts`, `TimelineVariants.tsx`                                   | Width and `beatAt` are `beats.length`                    | Width from rule 6; `beatAt` from the grid               |
| Drawing    | `TimelinePrimitives.tsx`, `TimelineMeasureRow.tsx`, `timeline/timelineWaveform.ts`                                                   | Ticks and peaks from the stored beats; T-10 dimmed peaks | `countsIn` for the visible range; waveform in full      |
| Pointer    | `TimelineGeometry.ts:284–321`, `Timeline.tsx`, `TimelinePageFlagGrips.tsx`                                                           | Pointer and drags clamp to `[0, beatCount]`              | No clamp at the end                                     |
| Playback   | `useTimelinePlaybackDriver.ts`, `timelinePlayhead.ts` (`canPlayOn`, `playbackStep`), `TimelineSelectionStore.showEndBeat`            | Stop at `beats.length`                                   | `showEndBeat` becomes rule 5's stop point               |
| Transport  | `timelineTransport.ts:118`, `useNavigationActionHandlers.ts:37`                                                                      | Seek and beat steps clamp to `beats.length`              | Seek anywhere; Alt+E stays "last page"                  |
| Audio      | `AudioFile.ts:186` (`computePlaceholderAudioDurationFromPages`), `AudioPlayer.tsx`, `audioOffset.worker.ts`                          | Silent padding to the last page's end + 10 s             | Pad to rule 5's stop point                              |
| Pages      | `Page.fromDatabase.ts:142`, `timelineRipple.ts` (`readPageGrid`), `sourceTimelinePositions.ts:80`                                    | Last page clipped to the stored counts                   | Unchanged: rule 4 keeps the last page's counts stored   |
| Writes     | `pageFlags.ts`, `measureLines.ts`, `TimelineClipResize.tsx`, `Page.ts`, `drillEdits.ts` (`withLastFlag`)                             | Refuse or clip at `beatCount`                            | `ensureCountsInTransaction` first                       |
| E1         | `showLength.ts`, `db-functions/showLength.ts`, `TimelineModePanel.tsx:755–850`                                                       | Pills, note, extend                                      | See "What happens to E1"                                |
| Exports    | `videoRenderer.ts:196`, `videoOverlay.ts`, `videoExportAudio.ts`, `timelineKeyframes.ts`, `ExportCoordinatesModal.tsx`, drill sheets | Last page's end or the stored end                        | Unchanged (rule 4); check they agree after rule 4 lands |

The riskiest are the time map (every scrub, playhead and animation goes through it), the playback
stop chain, and the axis width: without a new extent, nothing past the stored counts can be drawn
or scrolled to, whatever the conversion does.

## Slices

1. **Count grid** (pure, with property tests: agrees with `timeMap.ts` inside the stored counts,
   monotonic, `beatAtTime(timeAtBeat(b)) = b` past the end, measure lines continue the meter).
2. **Write path**: `ensureCountsInTransaction` and each write in the list above, with database
   tests that a write past the end stores the counts and one undo removes them.
3. **Draw and scroll**: axis extent, visible-range ticks and measure lines, pointer without the
   clamp, full waveform. T-10's dimmed music and note go.
4. **Playback and transport**: rule 5's stop point, seek past the end, audio padding.
5. **E1 clean-up**: wizard (T-8), **+** past the last page, FB-7 to the end of the music,
   removing `extendCountsTo` and its strings. Update T-8, T-9, T-10 and FB-7 in
   [decisions.md](decisions.md) and their validation rows (V-404–V-406, V-437).

Slices 1 and 2 change no behavior on their own. Slices 3–5 replace E1's show-length parts
directly, with no Tempo lab flag.

## To validate

- E1 session task 2 again ("put a set at the very end of the song"): nobody should need to add
  counts first.
- A MusicXML show whose score ends before the recording: counts carry on at the last tempo.
- A long scroll past the end at the widest zoom: frame times stay even (count lines are drawn
  for the visible range only).
- Undo of a page flag placed far past the end removes the counts too, and the timeline looks the
  same as before.

## Decisions

Made by the owner, 2026-10-16:

1. **Playback goes on past the show's end** to the end of the music (rule 5).
2. **The wizard stores only the starter pages' counts** (T-8 changes).
3. **The readout past the end is "END +n"** (rule 7).
4. **It replaces E1 directly**, with no lab flag.
5. **Stored counts after the show's end stay** when the last pages are deleted. They look the
   same as counts that were never stored, so nothing needs trimming.
