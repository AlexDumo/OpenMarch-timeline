# Spec: endless counts

Status: **accepted** by the owner on 2026-10-16 (decisions at the end) and built. It was first
built on the tempo lab branch (fork #280, folded into #182) and then ported to `main` without the
tempo work. The choices made while building it are EC-1 onward, at the end of this file. A larger
change, storing a tempo map instead of beat rows, is a separate question
(AlexDumo/OpenMarch-timeline#264). This spec doesn't need it.

## Problem

A show's counts are its `beats` rows, and nothing after the last one can be planned, played or
flagged. The user has to make counts before using them. Creative tools with a timeline don't ask
for that: the grid just keeps going.

## Behavior

1. **The counts never end.** Past the last stored count, the timeline keeps drawing counts and
   measure lines. They continue the last stored count's tempo and the last measure's meter
   (`countContinuation`). Nothing marks where the stored counts stop: a count looks the same
   whether it's stored or not. Every count is treated the same, with a page or without: the
   show's end (rule 4) only matters to exports.
2. **The tempo after the end is the last measure as stored.** The endless counts repeat the last
   stored measure's count lengths, rit. or uneven counts included, not the last typed tempo mark.
   A tempo or meter change is an edit to stored counts, and the endless counts follow whatever
   comes last. Changing the last stored measure's timing changes everything after it.
3. **Counts are stored when something lands on them.** Placing anything at or past the stored
   end first appends counts up to it, in the same transaction and undo step: **+** or a page flag
   drag, the last page's length, and a timeline move's create, shift or resize. Undoing the edit
   removes the counts with it. Looking, scrolling, scrubbing and playing store nothing.
4. **The show's end is the end of the last page:** its flag plus its counts (`last_page_counts`).
   Those counts are always stored (rule 3). Exports end there, video included. The page row is
   shaded past it. It isn't a wall: you can place, drag, select, loop and play across it.
   Dragging the last flag's grip changes the last page's length, storing counts if needed, in one
   undo step.
5. **Moves can go past the show's end.** A timeline move can be placed or resized anywhere; the
   last page doesn't grow to cover it. Exports leave it out (rule 9).
6. **Playback goes on past the show's end.** It stops at the latest of the show's end, the end of
   the music (`musicEndSeconds`) and the end of the last move, so you hear what's left to plan and
   see every move you placed. Marchers follow moves past the end and hold where no move
   continues. Play from past that stop point plays on in silence until you stop it. The playhead
   can be dragged or stepped anywhere.
7. **The timeline scrolls a little past the stop point.** It draws and scrolls to rule 6's stop
   point plus half a screen (EC-9). Fit shows up to the stop point.
8. **Counts past the show's end belong to no page.** The readout names them by how far past the
   end they are: **END +1** is the first count after the last page ends, **END +5** the fifth. At
   the end itself the readout names the last page's last count.
9. **Exports warn about moves past the end.** When moves run past the show's end, each export
   dialog says so ("2 moves run past the end of the show (Pg 12) and won't be in this export"),
   offers **Add pages to the end** (pages every N counts up to the end of the last move), and can
   still export as it is.

### Pages after the last one

Two controls add pages past the last flag, each as one undoable edit that stores the counts it
lands on:

- **+ 16 counts**, a pill just after the last page's flag, adds a page of N counts, where N is
  the file's "Default new page counts" setting. Right-clicking it changes N (EC-16).
- **Create pages every 16 counts to the end**, in the pill's right-click menu, adds a page every N
  counts to the end of the music, with a shorter last page for the rest. It's offered only when
  the music runs on more than N counts past the last flag (EC-10).

The new show wizard is unchanged: it stores only the counts its starter pages need, or a MusicXML
file's measures, and the counts carry on after them.

## Design

### The seam: a count grid

One pure module, `apps/desktop/src/timeline/countGrid.ts`, owns "counts that go on forever". It's
built from the stored beats (with timestamps) and the measure starts, and answers:

- `timeAtBeat(b)` and `beatAtTime(s)` for any `b ≥ 0` and `s ≥ 0`, with no clamp at the stored
  end. Inside the stored counts they agree exactly with `timeMap.ts`. Past them they use a closed
  form over the repeating pattern `countContinuation` gives (one length, or one measure's
  lengths).
- `countsIn(fromBeat, toBeat)`: each count line and measure line in a range.
- `storedCount`, and `isStored(b)`.

`useTimingObjects` builds it as `countGrid`. `timeMap.ts` stays as it is for code that means "the
stored counts" (conversion, exports, the page converter). Code that draws, scrubs or plays uses the
grid. `timeline/endlessTimeline.ts` turns the grid into `Beat`s and `Measure`s past the stored
ones, with negative ids that nothing stores, so every lane draws them as it draws stored ones.
`timeline/countsPastEnd.ts` holds `countContinuation`, where the music ends, and where "pages to
the end" puts flags.

### The write path

`ensureCountsInTransaction({ tx, through })` (`db-functions/endlessCounts.ts`) appends
`max(0, through - beatCount)` counts with `appendCountsInTransaction`, which writes measure lines
and runs inside `withTimelinePageRipple`. It's called first by each write that can name a count
past the end:

- `addPageFlagInTransaction` and `movePageFlagInTransaction` in `pageFlags.ts`;
  `planPageFlagInsertion` no longer stops at the show's beats.
- Timeline move create, shift and resize (`timelineMoves.ts`, `timelineCommands.ts`,
  `timelineResize.ts`).
- **+ 16 counts** and pages to the end (`db-functions/appendPages.ts`), through
  `addPageFlagInTransaction`.

Timeline rows use plain count numbers (`start_beat`/`end_beat`), so no drill row moves. Pages and
measures point at beat ids, which is why their writes need the counts stored first.

### File format

No migration and no new stored field. Everything placed is stored, so an older app opens the file
and sees the same show. The page converter and the web editor read the same rows.

## To validate

- Put a set at the very end of the song: nobody should need to add counts first.
- A MusicXML show whose score ends before the recording: counts carry on at the last tempo.
- A long scroll past the end at the widest zoom: frame times stay even.
- A move past the show's end: it plays, and the export warns and offers pages.
- Undo of a page flag placed far past the end removes the counts too, and the timeline looks the
  same as before.

The rows for hands-on checks are V-301 to V-304 in
[VALIDATION.md](research/ownership/VALIDATION.md).

## Decisions

Made by the owner, 2026-10-16:

1. **Playback goes on past the show's end** (rule 6).
2. **The wizard stores only the starter pages' counts.**
3. **The readout past the end is "END +n"** (rule 8).
4. **It ships directly**, with no lab flag.
5. **Stored counts after the show's end stay** when the last pages are deleted. They look the
   same as counts that were never stored, so nothing needs trimming.
6. **Every count is treated the same**, with or without a page; only exports stop at the end
   (rule 1).
7. **Moves may go past the end** and exports leave them out; the last page doesn't grow (rule 5).
8. **Marchers follow moves past the end** and hold where none continues (rule 6).
9. **Playback stops at the latest of** the show's end, the music's end and the last move's end;
   Play from past that plays on until stopped (rule 6).
10. **The endless counts repeat the last stored measure** as it sounds, not the last typed tempo
    (rule 2).
11. **Video export ends at the show's end**, not the music's (rule 4).
12. **Loops and selections can cross the end** and store nothing (rules 3 and 4).
13. _Withdrawn:_ a quiet END line was built to mark the show's end, with a drag for the last
    page's length. The page row shaded past the last flag marks the end, and the last flag's grip
    changes the last page's length (EC-2).
14. **Exports warn about moves past the end** and offer pages to cover them (rule 9).

## Choices made while building

Where the spec left room or the code asked for one. Each is listed in the PR for the owner to
check.

### EC-1 One edit stores at most 20,000 counts

A write past the end stores every count up to it, so a bad beat number would make a runaway show.
`ensureCountsInTransaction` refuses (`E-ARGS`) more than `MAX_COUNTS_PER_EDIT` (20,000) new counts
in one edit, about an hour at 300 BPM.

### EC-2 No END line

An END line with its own drag was built first and removed at the owner's request: the page row
shaded past the last page's flag shows where the show ends, and the last flag's grip changes the
last page's length.

### EC-3 The last flag's drag has no end

`planPageFlagMoveLimits` used to stop the last flag at the show's last count (`show-end`). Now it
walks to just past the furthest timeline row's end; if nothing stops it there, `max` is `Infinity`
and the block is `{ kind: "open" }`. The move stores the counts it lands on.

### EC-4 Page.ts push and yank are left alone

They are page-era helpers with no callers in the timeline app.

### EC-6 The audio isn't padded to the stop point; the metronome is

The live clock is the AudioContext's time, which runs on past the end of the decoded buffer, so
playback goes on in silence without padding; padding would decode the audio again every time the
stop point moved. The metronome's buffer is built on the counts up to the stop point, so it counts
on past the stored counts. Past the stop point it is silent too.

### EC-7 Playing on stops where it crosses the stop point

The playback driver stops playing on when one frame is before the stop point and the next at or
past it. A cue (Play, a jump, a loop) resets the frame before, so Play or a click past the stop
point plays on in silence until stopped (rule 6), and a jump back before it stops there again.
V-302.

### EC-8 "END +n" in the readout

The readout past the show's end is "END +5"; screen readers hear "5 counts past the end of the
show". At the end itself it names the last page's last count. The 3D View's readout says "END +5" in place of
its page and count too. Move names in refusals and tooltips
still say "after Page 12, counts 1–4". V-303.

### EC-9 How far the timeline scrolls (owner, 2026-10-16)

The timeline draws and scrolls to the stop point (rule 6) plus half a screen and at least 32
counts, rounded up to 32 counts. It doesn't grow as you scroll; the playhead (playing on past the
stop point, say) keeps the end where it is but adds no room, so clicks at the far right don't
creep it out. Placing a page or a move further moves it on. A screen is rounded down to a power of
two counts, so a pinch redraws the lanes a few times, not every frame. V-301.

### EC-10 The pill after the last page

**+ N counts** always reads "+ 16 counts" ("Add a page of 16 counts after the last page").
"Create pages every 16 counts to the end" is the first entry of the pill's right-click menu
(EC-16), shown only with music that runs more than 16 counts past the last flag, and goes to the
music's end.

### EC-11 The waveform's loudness scale

The waveform draws in full, on the counts past the stored ones up to the music's end, and is
scaled to the loudest moment of the whole music.

### EC-13 Writes that store counts refresh the beats

Any move or page flag can store counts now, so after an edit that did, the app refreshes the
beats, pages and measures (`takeStoredCounts`, in `refreshAfterStoredCounts`), whatever queries
the edit itself refreshes.

### EC-14 Legacy show-wide layouts

A file with the pre-P9.10 show-wide layout fails every edit with E-T1 until it is converted again.
A move shifted past the end on such a file now fails at the row trigger (still E-T1) rather than
at the commit check, since storing the counts runs first.

### EC-15 The export warning

A warning sits at the top of the Coordinate Sheets, Drill Charts and Video tabs when any stored
move ends after the show's end: "1 move runs past the end of the show (Pg 6) and won't be in this
export." **Add pages to the end** adds a page every "new page counts" counts (16) up to the end of
the last move, with a shorter last page for the rest, as one undoable edit; export works as it is
either way. The Mobile tab doesn't warn (it exports the whole file). The video preview ends at the
show's end too, as the video does.

### EC-16 Right-click **+ N counts** to change N (owner request, 2026-10-16)

Right-clicking the pill opens a small menu: "+ Create pages every N counts to the end" (when the
music runs on, EC-10), then "New pages [16] counts" with the number selected. A whole number
(1–999) is saved on Enter or when the menu closes (a click outside it included), never when focus
moves within the menu, so hovering its action mid-typing keeps the box; Escape cancels; anything
else is ignored. The action follows the box: while a whole number is typed it reads "Create pages
every 12 counts to the end" and makes pages of 12, and picking it saves 12 as well (the menu
closes); with anything else typed it reads and makes the saved N.
It writes the file's "Default new page counts" workspace setting, so it isn't an undo step; pages
already made keep their length. The pill's tooltip says it can be right-clicked. V-304.

### EC-17 Main's playback rules

Reaching the stop point stops as Stop does, back to where Play was pressed (UI-24), and the
playhead isn't held at the show's end anywhere: a start flag released on the playhead at the
show's end pushes the playhead a count past it (UI-21), as it does elsewhere. The 3D view and the
three.js field follow playback on the count grid too, so marchers follow moves past the end there
as well.

EC-5 (measure line edits past the end) and EC-12 (the Align view) belonged to tempo lab features
that aren't on `main`.
