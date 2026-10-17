# Which count, measure and beat a moment belongs to

Decision for the owner, from experiment E2 (tempo experiment plan). Status: **recommended rule
implemented on `tempo/count-parity` as a separate commit**, pending the owner's choice.

## The problem

Take a 4/4 show at ♩=176 and a 16-count page whose first beat is m5's downbeat. Its box runs from
the m5 line to the m9 line. On timeline-try-2 (a4d42cd1), four surfaces described that page in
four ways. The test checked each claim on the real code (`countParity.test.ts`, run before the
fix):

| Surface                                 | What it said                                                                                              | Claim from 25-persona-sam.md                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Timeline readout (`getPlayheadReadout`) | count 1 = "m5 beat 2"; the flag = "ct 16/16 m9 beat 1"                                                    | **True**                                                                                                              |
| PDF drill sheet (`measureRangeString`)  | "5 - 8": the beats the page spans, not its counts                                                         | **True**                                                                                                              |
| Video overlay (`OverlayTimeline`)       | on m5's downbeat, "Set 1 → 2, Count 1, m. 5"; at that moment the readout said "Pg 1 · ct 16/16 m5 beat 1" | **True**: one count apart at every moment, in every show                                                              |
| Readout between two beat lines          | the count was rounded and the measure floored, so 8.6 read "Pg 2 · ct 1" with page 1's last beat          | **True**                                                                                                              |
| Overlay tempo                           | `Math.round(60 / duration)`: 152.5 read 153, and a 7/8 (2+2+3) bar at 176 read 117 on its long beat       | **True**                                                                                                              |
| Go-to box (`parseTimelineGoTo`)         | "m5.2" goes to the line the readout calls m5 beat 2                                                       | Agreed with the readout already; it disagreed with the PDF and the video only because they disagreed with the readout |

How marchers move is not in question and does not change. A page's set is reached at the end of
its last beat, which is the next page's first beat: page mode puts each page's keyframe at
`timestamp + duration`, and the timeline draws the flag there (`pageEndBeat.ts`). For the page
above, marchers leave set 1 on m5's downbeat and reach set 2 on m9's downbeat. Only the labels
differ.

## How Pyware counts

- Sets sit **on** counts. "Setting the Yellow Anchor at count 0 and the Red Anchor at count 16
  will start the next set at count 16 and create a 16 count transition between counts 0 and 16"
  ([Pyware 3D guide, Count Track](https://www.pyware.com/guide/3d/8.0/en/topic/count-track)). The
  opening set is count 0, and charts print "at 0, 16 and 40".
- A count is a beat in the music. To sync audio "by set", you tap "on the 1st count of every
  transition" ([Sync music to drill](https://pyware.com/guide/3d/11.0/en/topic/sync-music-to-drill)).
- The Production Sheet's Measures column is typed by the designer ("which measures the set is
  referencing"); Pyware doesn't compute it
  ([Production Sheet](https://www.pyware.com/guide/quickstart/9.0/en/topic/production-sheet-overview)).
  Coordinate sheets list cumulative counts: set 1 at 0, set 2 at 16, set 3 at 24
  ([Dot book](https://en.wikipedia.org/wiki/Dot_book)).

So in Pyware, count 16 of a transition is a beat, and the set is reached on it. A Pyware designer
who writes "set 2, m5–8, 16 counts" means count 1 is m5 beat 1 and the set is reached on m8 beat 4.

## Candidate rules

**A. Counts are beat lines; the flag is the last count (recommended).** Count k of page P is the
k-th beat line after P's start flag, so P's flag is its count N. A line is named by the beat that
starts on it. A moment between two lines belongs to the line at or before it.

- Readout: count 1 is "m5 beat 2", the flag is "ct 16/16 m9 beat 1". **UI-13's examples stay true.**
- PDF: the range names the page's first and last counts: **"5(2) - 9(1)"**.
- Video: on m5's downbeat, the previous transition's "Count 16/16" (its set is reached there);
  this page's count 1 one beat later.
- This is Pyware's model (sets on counts, counts are beats), applied to OpenMarch's motion. It
  also says honestly when marchers arrive: on m9's downbeat.

**B. Counts are the beats a page spans.** Count k is P's k-th beat, so count 1 is "m5 beat 1" and
count 16 is "m8 beat 4". The PDF stays "5 - 8" and the video is unchanged.

- The readout on P's flag would name the next page's count 1 ("Pg 2 · ct 1/16 m9 beat 1"). This
  reverses UI-12 ("the playhead on page 3's flag is count 8 of page 3") and UI-13 ("on a flag it
  reads ct 16/16 m7 beat 1"). A selected page box puts the playhead on its flag, so it would show
  the next page.
- It hides a one-beat difference from Pyware. "16 counts, m5–8" reads like Pyware's, but OpenMarch
  reaches the set one beat after m8 beat 4.

**C. Keep both: counts as beat lines, and the PDF as the measures a page spans.** The readout and
video follow A, and the PDF keeps "5 - 8", now defined as "the music the move covers". This is the
smallest change for printed sheets, but two numbers for one page is the trust problem Sam
reported. The sheet says 5–8 and the screen says m9 beat 1.

## Recommendation

Rule **A**, everywhere. It is the only rule that needs no change to the timeline (UI-12, UI-13 and
UI-13's count numbers, which already sit "just left of the beat tick [they land] on, so the last
count sits on the flag"). It matches Pyware's "a set is on a count", and it never names a moment
where the marchers aren't. The end of the show has no beat of its own, so it is named by the last
beat (as the readout already did).

What changes for users, all in one commit that the lead can drop:

1. **The PDF drill sheet and the inspector's measure range (owner decision).** Every page drawn
   from downbeat to downbeat changes from "5 - 8" to "5(2) - 9(1)". This will surprise designers
   who think in Pyware's "m5–8". It is correct for OpenMarch's motion. A designer who wants the
   Pyware reading (set on m8 beat 4) should put the flag on m8 beat 4, and the sheet then reads
   "5 - 8". If the owner prefers the sheet to keep "5 - 8", rule C is a one-line revert of
   `Page.fromDatabase.ts`, but the sheet then needs a printed note that the set is reached on the
   next downbeat.
2. **Video overlay counts** move one count later at every moment, so they match the timeline. The
   opening set before the first count shows "Set 1" with no count.
3. **Readout between beat lines** names the count it has passed, not the nearest one (a paused
   playhead off a line, or a live one mid-beat).

Not changed: motion, the go-to box (it already agreed), UI-13's text.

Separately (a fix, not part of the rule): the overlay writes tempos to two decimals ("152.5"),
and a mixed-meter measure reads its short beat's tempo, so 7/8 at 176 stays 176.

## Open questions for the owner

- Accept "5(2) - 9(1)" on the drill sheet, or keep "5 - 8" with a note (rule C)?
- Should the readout say which beat of a 2+2+3 bar is the long one ("m5 beat 3 (long)")? Sam's
  percussion counts eighths; "beat" here counts counts.
- The end of the show is named by the last beat. "End of m20" would be clearer than repeating
  "m20 beat 4" for the last two counts.

## How it stays true

`apps/desktop/src/components/timeline/__test__/countParity.test.ts` generates shows in 2/4, 3/4,
4/4, 5/8 (2+3), 7/8 (2+2+3), 12/8 and 3/2. It uses decimal tempos (176, 152.5, 117.333 and random)
and random page flags, and builds them through the app's own `fromDatabaseMeasures`,
`fromDatabasePages` and `createTimelineViewModel`. For every count of every page it checks that:

- the readout, on the line and halfway to the next, names the same page, count, measure and beat;
- the go-to box parses the readout's "m.b" back to that line;
- the video overlay names the same set, count and measure, on the beat and halfway to the next;
- the PDF's range names the page's first and last counts.

300 shows run in about 1 s.
