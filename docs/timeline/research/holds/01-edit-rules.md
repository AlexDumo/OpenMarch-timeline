<!-- cspell:disable -->

# Edit rules: what each write path does to holds

Every path that writes timeline rows, with what it has to do once hold marks exist (decision 2)
and kept spots are gone (decision 1). The row ids, code locations and current behaviour are in
the appendix inventory, [../keyframe-model/01-write-paths.md](../keyframe-model/01-write-paths.md).
This note adds only the hold rules.

The invariants every path must keep, in the same edit (README, Storage):

- **H-1:** no row of the marcher overlaps the mark.
- **H-2:** a row of the marcher ends at the mark's start, or the start is 0 or a page flag.
- **H-3:** one marcher's marks don't overlap.

These are checked at commit time. A shared step trims and deletes marks, and paths that move an
arrival pass an old→new map (README, Storage; [03-review.md](03-review.md)). "Span" below means a
Held mark (table `timeline_held_marks`).

The general rules:

- **A new move in charge inside a span** trims the span at the move's start. If the move also
  ends inside the span, the move splits it and the part after the move is dropped. Excursions,
  which would keep that part, are deferred (decision 7).
- **The arrival moves** (its end beat changes): the span's start follows it, and the span's end
  stays where it is. A span left with no length is deleted.
- **The arrival is deleted:** the span is deleted (decision 17). This must be done **explicitly** by the path that deletes the arrival
  (Remove keyframe, Set to previous page, Delete move). The generic step can't catch it when the
  arrival sat on a page flag, because a flag start is valid under H-2.
- **Page and beat edits** (the ripple, flag drags, beat insert and delete, tempo edits, MusicXML
  import, endless counts) map a mark's **start like a row's end** (it is an arrival) and its **end
  like a row's start**, in `planTimelineRipple` (`db-functions/timelineRipple.ts:21-36`, 253). A
  mark left with no length is deleted (review, storage M3).
- **"Take out of a page"** (Set to previous page, Hold from previous page, hold over the window,
  Expert drag back in a shared move): cut the move in time at the page's flags, then remove the
  marcher from that page's part with Basic's tidy-up. Shape and follow-the-leader members: owner
  question R5.

| Path (inventory id)                                   | Today                                                                                     | With holds                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New marchers (A1)                                     | home only                                                                                 | unchanged; no spans                                                                                                                                                                                                             |
| Delete marchers (A2)                                  | rows deleted, shared moves compacted                                                      | spans cascade on `marcher_id`                                                                                                                                                                                                   |
| Keep / K, Follow again, Only Page N toast (C1–C3)     | stored kept spots                                                                         | **removed** (decision 1). Only-this-page writes ordinary moves (C3 already walks back); inside a Held span it first splits the span at that page                                                                                |
| Remove keyframe (D1)                                  | deletes rows ending on the count                                                          | if a span starts at that arrival, delete it (17). If the next move starts on the count and the whole membership is selected, **join** (14)                                                                                      |
| Remove keyframe's next-page moves (D2)                | ordinary moves                                                                            | unchanged (15); with 13 they always show a diamond                                                                                                                                                                              |
| …Pages follow back (D3)                               | delete only                                                                               | as D1, without the next-page moves                                                                                                                                                                                              |
| Add selected marchers (E1)                            | can write a move that goes nowhere                                                        | unchanged; it shows a diamond (13)                                                                                                                                                                                              |
| Expert drag, nudge, align (E2)                        | move ending at the playhead P, starting at the start flag S                               | **S inside a span: the window wins** (R2): trim the span at S, and the window becomes a move. **S at or before the span's start and P inside it:** edit the span's arrival (4). **The window covers a span:** trim or delete it |
| Expert drag back (E3)                                 | deletes an own page move; keeps a shared one going nowhere                                | the shared case is **taken out of the page** (as S1) instead of leaving a move that goes nowhere (review, storage M6)                                                                                                           |
| Isolation edit (E4)                                   | slot update                                                                               | if the isolated move is an arrival, its spans move with it for free (no copied spot)                                                                                                                                            |
| Keep Page N as a keyframe, pass-through toast (E5)    | restarts the window at the flag                                                           | trims any span the new move enters                                                                                                                                                                                              |
| Move them too (E6)                                    | shifts later own moves                                                                    | unchanged; a page inside a Held span has no own move to shift                                                                                                                                                                   |
| Basic point in a hold (F1)                            | writes the point plus a move back to the held spot                                        | **inside a span:** edit the arrival (4). Otherwise, the hold's start `g0` must be the later of the previous move's end and any span's end (leave early, 6)                                                                      |
| Basic point inside a move, onto a move's end (F2, F3) | split, or set the ending                                                                  | an arrival that moves carries its spans                                                                                                                                                                                         |
| Basic drag back / point remove, `planMerge` (F4)      | joins; also deletes the moves going nowhere that follow it                                | the join is unchanged. Basic keeps deleting the following moves that go nowhere: they are its own artefacts (review, storage m1)                                                                                                |
| Basic Set to previous page (F5)                       | deletes the box's rows                                                                    | delete spans starting at a deleted arrival (17)                                                                                                                                                                                 |
| Basic split on + / Split page (F6)                    | splits every simple move at the new flag                                                  | spans are gaps, so nothing to split. A span over the new flag stays one span                                                                                                                                                    |
| Converter (G1)                                        | slots only where a point changed                                                          | **no spans** (decided)                                                                                                                                                                                                          |
| Clip drag, resize (H1, H2)                            | retime whole moves                                                                        | arrivals that move carry span starts. A move that now starts inside a span trims it                                                                                                                                             |
| Delete move (H3)                                      | deletes every member's rows                                                               | delete spans whose arrival was in it (17)                                                                                                                                                                                       |
| Split by marcher, merge (I1, I2)                      | membership only; merge may refit                                                          | a refit moves arrivals, so their spans follow                                                                                                                                                                                   |
| Split at playhead (I3)                                | cuts a move in time                                                                       | spans are gaps, so the cut can't fall inside one. Members who stand still get no first-half row, so no keyframe they didn't make (review, storage m2)                                                                           |
| Ripple, delete page and its moves, flag drag (J1–J3)  | page and beat edits                                                                       | span edges on page boundaries follow the pages. Spans inside a deleted page box are clipped, or deleted when their arrival goes                                                                                                 |
| Add a page (J4)                                       | page rows only                                                                            | unchanged. A span over the new flag stays one span                                                                                                                                                                              |
| Set to previous page, Expert (S1)                     | deletes own one-slot page moves; **writes moves going nowhere for shared or longer ones** | **take the marcher out of the page** (cut in time, then remove) so the page is Following (16); delete spans starting at a deleted arrival (17)                                                                                  |
| Set to next page (S2)                                 | writes a move                                                                             | as E2                                                                                                                                                                                                                           |
| **Hold from previous page** (new)                     | –                                                                                         | take the marchers out of the page (as S1), then write a span over **this page only**, from the previous page's flag to this one (R3)                                                                                            |
| **Edit inside a span that starts at a flag** (new)    | –                                                                                         | write that previous page's own move (from the later of its start flag and the marcher's last arrival) ending at the span's start, so the hold follows; earlier pages untouched (R3)                                             |
| **Bar-start drag** (new)                              | –                                                                                         | move `start_beat` back to an earlier page flag or to the last arrival, never across a row                                                                                                                                       |
| **Make all selected Held** (new)                      | –                                                                                         | for the selected Following marchers, a span over the same counts as the Held one's, starting at the later of that start and their own arrival (R1)                                                                              |
| **Bar-end drag** (new)                                | –                                                                                         | set `end_beat`, never past the next move's start or the show's end                                                                                                                                                              |
| **Split hold here** (new)                             | –                                                                                         | **ends the hold** at the count; what follows is Following. H-2 stays strict (review, semantics m1)                                                                                                                              |
| Undo / redo                                           | history triggers                                                                          | the span table is in `tablesWithHistory`; spans restore with their rows                                                                                                                                                         |

## Also writes rows (added after review)

- **Shape placement in flight:** shapes host `placeShape`, #181 (box v1) and #288. These are
  ordinary move writers, so the general rules apply.
- **Repair** (`electron/database/repair.ts:48-75`) copies tables with foreign keys off. Add the
  marks table to its copy list.
- **The U-1 history-trigger count test** (`timelineTriggers.test.ts:418`) changes with the new
  `timeline_`-prefixed table.
- **Ticket A** keeps the stay-writing core of `keepMarchersOnPageInTransaction`, which Remove
  keyframe (`timeline/timelineUnset.ts:111-116`) and Only this page call.

## Open for ticket D

1. **The upkeep cost.** About 30 paths touch rows. The shared trim-and-delete step covers most of
   them; only the paths that move an arrival need the explicit old→new map: clip drag, resize,
   merge refit and Basic set-ending.
