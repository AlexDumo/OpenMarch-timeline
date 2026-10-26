<!-- cspell:disable -->

# Draft: ADR 0001 amendment for holds

Not applied. This is the text proposed for `docs/adr/0001-timeline-motion-model.md` §2, after the
2026-10-16 amendments, for the owner to review. It lands in two parts, with tickets A and D in the
[README](README.md).

---

**Amendment (2026-10-2x, project owner): keyframes are stored move ends, and kept spots are
removed.** _(Part 1, ticket A/B.)_

- **A keyframe is the end of one of the marcher's own moves, where that move is in charge as it
  ends** (spec §6.2), whether or not the marcher moved. A span cut short by a higher layer is not
  one (fork #384, `SpanInfo.assignmentEnd`). This replaces the motion test of Set vs Following
  (fork #332): a stored move that goes nowhere is designer intent (amendment 2026-10-08), so it
  shows as one.
- **Kept spots are removed.** `timeline_kept_assignments` (migration 0018, unreleased) is dropped,
  along with the keep commands, chains and Follow again.
  - "Only this page" writes the old spots on the following pages as ordinary moves.
  - The follow-link chain's unlink (fork #297) is that command.
  - This reverses the 2026-10-09 amendment, whose purpose the stored move ends now serve: a later
    page with its own move never follows an earlier edit.
- **Set to previous page leaves the page with no move of the marcher's own.** For a marcher in a
  shared or longer move, the move is cut in time at the page's flags, and the marcher is removed
  from that page's part, compacting the slot. The Expert drag back in a shared move does the same.
  Shape and follow-the-leader members are refused, with a message naming them.
- **Migration:** a new migration (numbered after main's latest) drops the table and **prunes stored
  undo groups that name it**. Fork nightlies and the lab build already ship migration 0018, so
  testers' files may hold kept rows and kept steps in their history. An older nightly opening a
  migrated file errors on its kept queries.
- The 2026-10-16 amendment's list of page-move writers loses "kept spots".

**Amendment (2026-10-2x, project owner): Held holds are stored.** _(Part 2, ticket D.)_

A designer can mark a stretch where marchers stand still as **held**. Editing any count inside it
then moves the whole hold, by editing the move that arrives at its start. An unmarked stretch is
**following**: an edit inside it starts a new move there. Both are holds to the resolver (spec R-6),
so the mark is app data:

- A new table, `timeline_held_marks`:
  - `id INTEGER PRIMARY KEY`;
  - `marcher_id`, referencing `marchers` `ON DELETE CASCADE`;
  - `start_beat >= 0`, and `end_beat > start_beat`;
  - `UNIQUE (marcher_id, start_beat)`.
  - It isn't in `timeline_change_log`, and the resolver never reads it.
  - It is in `tablesWithHistory`. The id is the rowid, so undo restores the same row (C-2).
  - It is in `DISPLAY_TABLES` and the query invalidation map, so mark-only edits refresh the
    views.
- **Invariants,** checked at commit time beside `timeline_commit_violations`. They are plain SQL
  over `timeline_assignments` and need no layer derivation (H-2 was dropped 2026-10-26: a mark
  may start anywhere, and whether it is an arrival hold follows from the rows):
  - **H-1:** no row of the marcher overlaps the mark;
  - **H-3:** one marcher's marks don't overlap.
- **Holds are always explicit:** only Hold from previous page, a bar drag, hold over the window and
  Make all selected Held write marks. Nothing infers one from a selection or from positions.
- **Upkeep:** a shared step in `transactionWithHistory`, before the drain, snapshots the row ids
  ending at each mark's start. After the edit it trims marks that rows now cover, keeps marks that a
  row still ends at, moves marks whose row was retimed, and deletes marks whose arrival is gone
  (decision 17). It never runs during undo/redo replay (C-6). The rules are in
  `docs/timeline/research/holds/04-anchors.md`.
- **Page and beat edits:** an arrival mark's start takes its row's planned new end; a borrowed
  mark's start stays on its beat. This is computed in `planTimelineRipple`.
- **The rules per write path** are in `docs/timeline/research/holds/01-edit-rules.md`.
- **The converter writes no marks.**
- **File format:** the version stays 8 (unreleased). Files from earlier development builds get the
  empty table from the migration. A build without it shows held stretches as following.

The research is `docs/timeline/research/holds/`. The interaction is a new UI-row in
`docs/timeline/ui.md`.
