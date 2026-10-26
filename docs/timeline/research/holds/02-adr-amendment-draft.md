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
  shared or longer move, its slot is split out of the move first, as Split by marcher does.

**Amendment (2026-10-2x, project owner): Held holds are stored.** _(Part 2, ticket D.)_

A designer can mark a stretch where marchers stand still as **held**. Editing any count inside it
then moves the whole hold, by editing the move that arrives at its start. An unmarked stretch is
**following**: an edit inside it starts a new move there. Both are holds to the resolver (spec R-6),
so the mark is app data:

- A new table, `timeline_held_spans` (`id INTEGER PRIMARY KEY`, `marcher_id` referencing `marchers`
  `ON DELETE CASCADE`, `start_beat`, `end_beat`, with `end_beat > start_beat`).
  - It isn't in `timeline_change_log`, and the resolver never reads it.
  - It is in `tablesWithHistory`. The id is the rowid, so undo restores the same row (C-2).
- **Invariants,** kept by the write functions in the same edit, and checked by a test after every
  timeline command (as I-L1):
  - **H-1:** a span lies where the marcher has no move in charge;
  - **H-2:** it starts at the marcher's arrival (a visible move end, or beat 0);
  - **H-3:** one marcher's spans don't overlap.
    The rules per write path are in `docs/timeline/research/holds/01-edit-rules.md`.
- **The converter writes no spans.**
- **File format:** the version stays 8 (unreleased). Files from earlier development builds get the
  empty table from the migration. A build without it shows held stretches as following.

The research is `docs/timeline/research/holds/`. The interaction is a new UI-row in
`docs/timeline/ui.md`.
