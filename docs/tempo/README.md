# Tempo

How OpenMarch lines counts up with the music. This is not a DAW: tempo's only job here is to put
each count where it is in the recording.

## Three layers

| Layer      | What it is                                         | Stored as                                  | Can drill refuse it?                                              |
| ---------- | -------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| **Counts** | How many counts there are and where page flags are | `beats` rows and order, `pages.start_beat` | Yes: adding or removing counts ripples through every timeline row |
| **Timing** | When each count lands                              | `beats.duration`, plus the audio offset    | No: a duration-only edit is a no-op for the ripple (`sameGrid`)   |
| **Labels** | Measure lines and rehearsal marks                  | `measures`                                 | No: touches neither                                               |

Everything in the tempo core is in the timing layer.

## Where the code lives

| Piece                                  | Path                                                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pure retiming, tap tempo and read-outs | `apps/desktop/src/timeline/tempo/` (its [README](../../apps/desktop/src/timeline/tempo/README.md) lists every function)                                                                                |
| Show time to count and back            | `apps/desktop/src/timeline/timeMap.ts`                                                                                                                                                                 |
| Write path (one transaction, one undo) | `apps/desktop/src/db-functions/tempo.ts`: `retimeBeats`, `retimeBeatsInTransaction`, `setTempoSyncedBeatIds`, `readTempoSyncedBeatIds`                                                                 |
| React Query hooks                      | `apps/desktop/src/hooks/queries/useTempo.ts`: `useRetimeBeats`, `useSetTempoSyncedBeatIds`, `useTempoSyncedBeatIds`                                                                                    |
| Tempo map (E11)                        | `apps/desktop/src/components/timeline/TempoMapPanel.tsx`; typed rows in `tempoMapMarks` (workspace settings)                                                                                           |
| Synced counts (prototype)              | `tempoSyncedBeatIds` in the file's workspace settings ([ADR draft](adr-synced-counts.md))                                                                                                              |
| Audio offset                           | `audioOffsetSeconds` in the file's workspace settings; positive pads silence before the music                                                                                                          |
| Align view (E7, flag `alignView`)      | `apps/desktop/src/components/timeline/`: `timelineAxis.ts` (counts or seconds axis), `timelineAlign.ts` (drag, snap, chip), `TimelineAlignView.tsx` (handles, chip, ticks)                             |
| Punch-in tap (E9, flag `punchInTap`)   | `apps/desktop/src/components/timeline/`: `timelinePunchTap.ts` (targets, drafts, Backspace, amber), `TimelinePunchTap.tsx` (keys, Tap button, chip, drafts layer); app side in `TimelineModePanel.tsx` |
| Tempo lab flags                        | `tempoLab` in `apps/desktop/src/stores/UiSettingsStore.ts`; Settings → Tempo lab (experimental)                                                                                                        |

## Undo

A retime is one `transactionWithHistory` entry. The audio offset and synced counts live in
`workspace_settings`, which has no standing history triggers; a retime logs that row's undo
statement itself, so one Ctrl+Z puts the durations, the offset and the synced counts back together
(`tablesWithScopedHistory` in `db-functions/historyTriggers.ts`). Settings changed elsewhere (the
Music modal, the workspace settings dialog) are still not undoable.

## Tempo lab flags

Per user, all off by default (`useTempoLabFlag(flag)` reads one):

| Flag             | Values                 | Turns on                                                                                       |
| ---------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| `tapTheBeat`     | boolean                | Tap a few counts to set the tempo and where count 1 starts (E6)                                |
| `alignView`      | boolean                | Counts over the real waveform on a seconds axis; drag a flag onto the music (E7)               |
| `alignDragScope` | `"page"`, `"toSynced"` | What an Align flag drag re-spaces: its page (default), or back to the last synced count (FB-2) |
| `punchInTap`     | boolean                | In Align, T taps the next page flag (or count) onto the music, from any page (E9)              |
| `tapApply`       | `"stop"`, `"drafts"`   | Punch-in taps apply on stop, or stay drafts until Enter                                        |
| `tapUnit`        | `"page"`, `"count"`    | Punch-in taps mark page starts or every count                                                  |
| `tempoMap`       | boolean                | A table of tempo marks at measures (E11)                                                       |
| `snapToAttacks`  | boolean                | Drags and taps snap to attacks in the music (E5)                                               |
| `drillChoices`   | boolean                | Cuts and inserts ask what the drill does, with a preview (E10)                                 |

## Test-show kit

Shows, audio and MusicXML with known count times, plus a scorer, for the experiments and hands-on
sessions: [apps/desktop/tempo-kit](../../apps/desktop/tempo-kit/README.md). Make it with
`pnpm --dir apps/desktop run tempo-kit` (writes to `~/om-capture/fixtures/tempo/`) and score a show
with `node apps/desktop/tempo-kit/score.mts <show.dots> <truth.json>`.

## Decisions

- [decisions.md](decisions.md): the log of choices made while building.
- [adr-synced-counts.md](adr-synced-counts.md): where synced counts are stored.
- Feel-based defaults to check by hand are rows V-37 onward in
  [VALIDATION.md](../timeline/research/ownership/VALIDATION.md).
