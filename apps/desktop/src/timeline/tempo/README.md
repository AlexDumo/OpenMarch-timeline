# Tempo library (`@/timeline/tempo`)

Pure functions for lining counts up with the music. No React, no database. The write path is
`@/db-functions/tempo`; the map of the whole tempo system is
[docs/tempo/README.md](../../../../../docs/tempo/README.md).

## Model

- `durations[i]` is the length in seconds of count `i`, by beat ordinal as in `timeMap.ts`.
  Count 0 is the fixed zero-length beat; nothing here changes it.
- Count 1 always starts at show time 0. Moving it returns `originShift`; the write path turns it
  into an audio-offset change (`newOffset = oldOffset - originShift`).
- Ranges are half-open, `[from, to)`.
- **Synced** counts (a set or list of count indexes) are on the music already. Edits re-space up
  to the nearest synced count instead of moving it. Count 1 always acts as synced on its left.
- Nothing adds, removes or reorders counts, so writing the result to the same beat ids never
  ripples into drill.
- Re-spacing is proportional (holds and score tempo changes survive) unless said otherwise.
- Computed counts are clamped to `[MIN_COUNT_SECONDS, MAX_COUNT_SECONDS]` (0.15 s = 400 BPM, and
  30 s). A count already outside may stay but not get worse. Typed-tempo floors (40 BPM) are the
  caller's.

## Functions

`retime.ts`

| Function                                                      | What it does                                                                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `countTimes(durations)`                                       | Start time of every count plus the end of the show (length `n + 1`).                                                                                          |
| `durationsFromTimes(times)`                                   | Inverse of `countTimes`.                                                                                                                                      |
| `spanOf(durations, from, to)`                                 | Total length of a range.                                                                                                                                      |
| `respaceProportional(durations, from, to, newSpan)`           | Range lasts `newSpan`, relative lengths kept (even if all zero).                                                                                              |
| `respaceEven(durations, from, to, newSpan)`                   | Range lasts `newSpan`, all counts equal.                                                                                                                      |
| `scaleRange(durations, from, to, factor)`                     | Multiply a range's counts (2 = half tempo). Later counts shift.                                                                                               |
| `setRangeBpm(durations, from, to, bpm, { keepRelative? })`    | Typed tempo: every count exactly `60 / bpm`, or relative lengths kept with that average. Later counts shift.                                                  |
| `keepSyncedAfter({ before, edited, from, synced })`           | After an edit to counts before `from`, re-space up to the next synced count so it stays put.                                                                  |
| `moveCount({ durations, index, toTime, synced, after })`      | Count `index` lands at `toTime`: re-space back to the previous synced count; after it re-space to the next synced count, or shift ("scale left, move right"). |
| `holdCount({ durations, index, newDuration, synced, after })` | One count's length changes; the counts up to the next synced count absorb it, or later counts shift.                                                          |
| `applyTaps({ durations, taps, synced, after, unit })`         | Each tap pins a count's start; counts between taps re-space (`unit: "count"` spaces evenly); after the last tap as in `moveCount`.                            |
| `spanLimits`, `previousSynced`, `nextSynced`                  | Helpers the above use, exported for previews.                                                                                                                 |

`after` is `"respaceToNextSynced"` (default) or `"shift"` (shift past synced counts: an explicit
override). `moveCount`, `holdCount`, `applyTaps` and `keepSyncedAfter` return a `RetimeResult`:

```ts
{
    durations: number[];
    originShift: number; // seconds count 1 moved; 0 otherwise
    effect: {
        respaced: { from: number; to: number }[]; // ranges that got new lengths
        shifted: { from: number; bySeconds: number } | null; // from `from` to the end
        heldFrom: number | null; // synced count from which nothing moves
    };
    clamped: boolean;
    clampReason?: "minCount" | "maxCount";
    clampSide?: "before" | "after";
}
```

`moveCount` adds `time` (where the count landed); `applyTaps` adds `taps` (where each landed) and
`clampedTaps`.

`tapTempo.ts`: `tempoFromTaps(times)` returns `{ bpm, period, firstBeatTime, confidence, beats,
rejected }` or null. It ignores the first tap when there are four or more, counts a near-double
interval as a missed tap, drops double taps and rejects taps more than `TAP_OUTLIER_FRACTION` (¼)
of a beat off the fitted line.

`tempoReadout.ts`: `bpmOfRange(durations, from, to)` (average BPM or null),
`isEvenRange(durations, from, to)` ("=" vs "≈"), and `pageTempos(durations, pageStarts, end?)`.

`ramp.ts`: `rampDurations(weights, startBpm, endBpm?)` (a steady tempo or a rit./accel. whose
first count is at `startBpm` and last at `endBpm`, each count weighted by its note value),
`setRangeRamp(durations, from, to, startBpm, endBpm?, weights?)` (that over a range; later counts
shift) and `countBpms(durations, weights)` (the inverse).

`tempoMapParse.ts`: what the tempo map's cells accept and show. `parseTempoCell` ("152.5",
"♩=152.5", "q=152.5", "dq=176", "♩.=176", "e=352", "♩.=♩", "=prev"), `parseRampCell`
("rit. to ♩=100", "-"), `parseMeterCell` ("7/8 2+2+3", "12/8", "3+2"), `formatTempo` ("♩=152.5",
"♩≈131.4"), `formatMeter`, `convertBpm`, `meterWeights`, `defaultUnit`.

`tempoMap.ts`: the tempo map (Tempo lab `tempoMap`, E11).

| Function                                         | What it does                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `deriveTempoMap({ durations, measures, marks })` | One row per tempo or meter change at a measure: meter, unit, `steady`/`ramp`/`uneven`, start and end tempo, start time, counts |
| `inferMeter(durations)`                          | A measure's meter from its count lengths (2:2:3 is 7/8 2+2+3); n/4 otherwise                                                   |
| `editRowTempo`, `editRowRamp`, `editRowMeter`    | A typed cell as a `TempoMapWrite` (durations, marks, counts to sync), or an error                                              |
| `addRowAt`, `removeRow`                          | Split a row at a measure without changing counts; drop a typed row                                                             |
| `marksByMeasure`, `retimeArgsOf`                 | Stored marks (by beat id) to measure indexes, and a write to `retimeBeats` arguments                                           |

Typed rows are **marks** (a meter and beat unit at a measure) stored in `tempoMapMarks`, because
counts carry no note values. See [decisions TM-1 to TM-7](../../../../../docs/tempo/decisions.md).

## Example: drag page 3's flag onto the music

```ts
const { beatIds, durations } = await readCountDurationsInTransaction(db);
const result = moveCount({
  durations,
  index: page3StartOrdinal,
  toTime,
  synced,
});
// preview with result.effect; then
await retimeBeats({
  db,
  newDurationsByBeatId: durationsByBeatId(beatIds, result.durations),
  originShift: result.originShift,
  syncedBeatIds: [...syncedBeatIds, beatIds[page3StartOrdinal]],
});
```
