# 0001: Edit a private working copy and save shows atomically

- Status: proposed
- Date: 2026-10-07

## Context

A show is one SQLite file (`.dots`). The Electron main process opens it with
`node:sqlite`, and every edit commits straight into the user's file in
SQLite's default rollback-journal mode with `synchronous=FULL`. No code sets
`journal_mode` or `synchronous`.

- **Users keep shows in cloud-synced folders and copy them around.** iCloud
  Desktop & Documents and OneDrive Known Folder Move are on by default on many
  machines. A sync client that copies the file while the app writes it can
  upload a torn file. In a benchmark that copied the file during 60 s of edits,
  24% of copies were bad with today's scheme (some passed `integrity_check` but
  held half a transaction), 2% with WAL on the user's file, and none with a
  snapshot renamed into place.
- **No mainstream app makes cloud folders safe while editing its SQLite file in
  place.** Zotero, Anki, Calibre, Audacity and others warn against it. SQLite's
  documentation calls WAL "less appealing for use as an application
  file-format".
- **On Windows**, SQLite opens files without `FILE_SHARE_DELETE`, so OneDrive
  can't upload an open show; remote edits become conflict copies.
- **Edits pay for durability on every commit** (4–60 ms depending on disk).
- **Opening a show writes to it** even with no edits (a write probe, trigger
  rebuilds in the migration callback, the renderer's undo triggers), and
  migrations run in place, one statement per commit.
- **Nothing notices that the file changed on disk**, Close File left the SQL
  connection open, Save As Copy leaked a connection and deleted the target
  before renaming over it, and nothing closed the database on quit.
- **Every edit scans the undo history.** `history_undo` has no index on
  `history_group`, which every edit queries to bump and trim the undo stack.
  At the 500-group cap that costs about 30 ms per edit.

Options considered:

- **WAL on the user's file.** It adds `-wal` and `-shm` files that must travel
  with the show, leaves the `.dots` stale between checkpoints, and makes the
  cloud-sync problems worse. Rejected.
- **A private working copy, saved atomically.** This record's decision.

## Decision

The working copy is opt-in while it's tested on real machines: the
`workingCopySaves` setting ("Save shows through a working copy (beta)" in
Settings ▸ General), off by default. `OPENMARCH_WORKING_COPY=1` or `=0`
forces it on or off. With it off, shows are edited in place as before.

1. **Open.** Check that the show exists, is readable and writable, and that
   its folder accepts a new file (the old in-file write probe would write to
   the show). Copy the show into `userData/working-copies/<uuid>/show.dots`
   with SQLite's backup API on a connection to the show, which first applies
   any hot journal or leftover WAL. Close that connection. Run migrations and
   other open-time writes on the working copy only; the migration backup is
   still taken from the show. The working copy uses `journal_mode=WAL` and
   `synchronous=NORMAL`.
2. **Edit.** Every connection opens the working copy: the SQL proxy, the
   per-call connections for triggers and audio, and the save worker. Each sets
   `synchronous=NORMAL`. Nothing holds the show open while editing.
3. **Autosave.** About 1.5 s after the last commit (at most 30 s while edits
   keep coming), on window blur, before PDF and video exports, before repair,
   before switching shows, and on close or quit. Commits from any connection
   are noticed through `PRAGMA data_version` on a watcher connection, checked
   after each database IPC handler. Each save:
   - runs `VACUUM INTO` a temp file `.~<name>.<random>.tmp` beside the show, on
     a worker thread with its own connection, so edits continue;
   - flushes the temp file (on macOS libuv uses `F_FULLFSYNC`) and hashes it;
   - copies the show's mode bits, and on macOS its extended attributes (Finder
     tags) with the system `xattr` tool;
   - renames it over the show and flushes the folder (not possible on Windows).
   A symbolic link is resolved, so the file it points to is replaced. The show
   file stays a single rollback-journal SQLite file.
4. **Conflicts.** Before each rename, the show's size, modification time, inode,
   device and SHA-256 are compared with what was last loaded or saved, and its
   metadata is checked again just before the rename. Changed content, or a
   missing file, is never overwritten: autosave pauses and a dialog offers
   "Keep my version", "Use the version on disk" (reopen it, dropping unsaved
   changes) or "Save mine as a copy…" (the copy becomes the open show). When
   only metadata changed (a touch, or a sync client re-downloading identical
   bytes), the hash matches and the save proceeds.
5. **Failures and Windows.** A rename that fails with `EPERM`, `EBUSY` or
   `EACCES` on Windows is retried with backoff (10, 20, 30… up to 100 ms) for
   up to 5 s. Then, as for any other failed save (a missing folder, a full
   disk), the temp file is deleted, the working copy stays authoritative, a
   notice appears and the save is tried again after 30 s, 1, 2 and 5 minutes,
   and on the next blur or close. The show is never written in place. A
   read-only show (POSIX write permission, or the Windows read-only
   attribute, which Node's rename ignores) isn't saved over; a notice offers
   Save As.
6. **Close and quit.** Closing or quitting saves first. If that save can't
   happen, a dialog offers to retry or overwrite (as fits the problem), save
   elsewhere, close and recover later, or cancel. Quitting closes every
   connection, and the working folder is deleted once its changes are saved.
7. **Recovery.** A manifest beside each working copy records the show's path,
   its last known identity and whether there are unsaved changes. At startup,
   leftovers without unsaved changes are deleted; the rest are listed on the
   launch page ("Recover unsaved changes") instead of reopening the show.
   Recovering reopens the working copy (replaying its WAL) and saves it with
   the usual conflict check, so a show changed meanwhile asks first. Recovery
   works even with the setting off. Stale temp files beside a show are
   deleted when it's next opened, once they are an hour old.
8. **Identity.** The window title, the title bar, recent files,
   `setRepresentedFilename` (macOS), exports, migration backups, repair and
   `database:getPath` report the show's path, never the working copy's. On
   macOS `setDocumentEdited` shows the unsaved dot until the save lands; the
   title bar shows "Edited", "Saving…" or "Not saved".
9. **Fixes regardless of the setting.** Close File and quit close the SQL
   connection; opening closes the connection it migrates with; Save As Copy
   closes its connection and writes a flushed temp file renamed over the target
   (a copy over the open show is a no-op instead of deleting it).
10. **History index.** Migration `0017` adds indexes on
    `history_undo(history_group)` and `history_redo(history_group)`. It changes
    the persistent schema only by adding indexes; older releases ignore them.

## Consequences

- **The show file is always complete.** Sync clients, backups, email and USB
  copies never see a torn file or sidecar files.
- **Edits get faster.** A commit in WAL with `synchronous=NORMAL` takes about
  0.1 ms instead of several ms, and the history index removes the
  history-size-dependent cost.
- **Saves cost about 4 ms per MB written, off the editing thread**, plus
  hashing the show and the snapshot.
- **The show trails the app** by the autosave delay, about 1–2 s while
  editing. A power cut can lose those seconds; a process crash is recovered
  from the working copy. "OpenMarch automatically saves your changes" now
  means "within a couple of seconds".
- **Two copies of a show are on disk while it's open**, the second in the app's
  user-data folder.
- **The first open of a show that has never been edited in this version saves
  once,** because the renderer adds its undo triggers. Later opens without
  edits leave the file byte-identical.
- **Renaming replaces the file**, so on macOS its creation date and file ID
  change, and on Windows its ACLs, alternate data streams and hidden or system
  attributes aren't carried over.
- **New surface area:** recovery UI, conflict UI, the retry policy, quit waiting
  on a save that can fail, and cleanup of working copies.
- **Tests that read the live show during a session see it only after a save.**
  This is why the setting is off by default and the existing e2e suite runs
  unchanged.
- **The file format doesn't change.** A `.dots` file is still a plain
  single-file SQLite database in rollback-journal mode, readable by older
  releases.

## Verification

- Unit and integration tests in `electron/database/workingCopy/__test__/`,
  `electron/database/__test__/atomicFile.test.ts` and
  `database.services.test.ts`: open, autosave, edits during a save, conflicts
  (changed, missing, metadata only, re-downloaded), read-only shows, simulated
  Windows lock errors (retry and deferral), recovery, symbolic links, and that
  `getDbPath` reports the show while connections use the working copy.
- `e2e/tests/working-copy.spec.mts` drives the built app with the setting on.
- Kill, sync-reader and timing benchmarks against this implementation are in
  `~/perf-night/save/wal-bench/` (outside the repo), with results in
  `~/perf-night/save/wal-implementation.md`.
- Before turning the setting on by default, test on real machines:
  - Windows with OneDrive (Files On-Demand) and Defender: how often renames fail
    and how long retries take; whether version history and share links
    survive a rename-over;
  - macOS with iCloud Drive: whether tags, Finder aliases and recents survive,
    and whether the `xattr` copy works;
  - Dropbox and Google Drive, an exFAT USB stick, and a network share;
  - power loss during a save.
