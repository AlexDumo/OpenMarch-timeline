# ADR draft: where synced counts are stored

Status: **draft** (prototype choice made; permanent choice open). 2026-10-06.

## Context

A **synced** count is one the user has put on the music. Retimes re-space up to it instead of
moving it (`moveCount`, `holdCount`, `applyTaps` in `apps/desktop/src/timeline/tempo/`). Synced
is per file, per count, and has to be undone with the retime that set it: if Ctrl+Z restores the
durations but not the synced marks, the next drag keeps the wrong counts in place.

A count is a `beats` row. Beat ids are stable across duration edits, which are the only edits the
tempo core makes. Inserting or deleting beats keeps the other ids.

## Options

| Option                                                       | For                                                                                            | Against                                                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A. `tempoSyncedBeatIds` in `workspace_settings` JSON         | No migration; easy to drop if the experiment fails                                             | No standing undo triggers (see below); ids of deleted beats linger until filtered; old app versions keep the key blindly |
| B. A column on `beats` (`synced INTEGER NOT NULL DEFAULT 0`) | Undo for free (beats has history triggers); deleted beats take their mark with them; one query | Migration and a file-format change; older apps drop nothing but ignore it                                                |
| C. A `tempo_synced_counts(beat_id)` table                    | Same undo and cascade as B; room for more per-mark data (who set it, a typed tempo)            | Migration, a new table with history triggers, a join for every read                                                      |

## Prototype choice: A

`tempoSyncedBeatIds` (ascending beat ids) in the workspace settings JSON, read with
`readTempoSyncedBeatIds` / `useTempoSyncedBeatIds` and written by `retimeBeats` (with
`syncedBeatIds`) or `setTempoSyncedBeatIds`.

`workspace_settings` is not in `tablesWithHistory`: many writers (the settings dialogs, the main
process) change it outside `transactionWithHistory`, and with standing triggers those writes would
join the last edit's undo entry. Instead it has **scoped history**
(`tablesWithScopedHistory`): a tempo write logs the row's undo statement itself
(`recordWorkspaceSettingsUndoInTransaction`), and undo/redo create triggers on it only while
replaying, then drop them. So a retime's durations, audio offset and synced counts are one undo
entry, and every other settings write stays out of history as before.

Known limits of A:

- Undoing a retime restores the whole settings row as it was, so a settings change made after the
  retime (a project name, say) is undone with it. Rare; acceptable for a prototype.
- Deleting a beat leaves its id in the list. Readers drop ids that no longer exist
  (`readTempoSyncedBeatIds`); the hook returns the raw list.

## To make it permanent

Pick B unless synced marks need their own data (then C). Either way:

1. Migration adding the column (or table), with history triggers via `tablesWithHistory`.
2. On open, move any `tempoSyncedBeatIds` into it and remove the key.
3. Replace `readTempoSyncedBeatIds` / the `syncedBeatIds` argument with beat reads and writes; the
   pure library doesn't change (it takes count indexes).
4. Decide what a page-mode or older app does with the marks (ignore is fine: they only steer edits).
5. Keep the audio offset question separate: it has the same undo problem and would move to
   `utility` (history-tracked) for the same reasons.
