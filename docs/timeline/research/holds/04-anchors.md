<!-- cspell:disable -->

# Hold anchors: arrival and count (proposal, 2026-10-26)

Status: proposed. The owner agreed in principle on 2026-10-26, subject to independent review. It
refines decisions 3, 17 and R3 in the [README](README.md), the rules in
[01-edit-rules.md](01-edit-rules.md), and the [ADR draft](02-adr-amendment-draft.md).

## Why

Holds can now start in three kinds of place:

- where a move ends (an **arrival**);
- at a page flag where nothing arrives (Hold from previous page, R3);
- at any count (Expert's **hold over the window** starts at the start flag).

With only a start count stored, the app can't tell "the move this hold started at was removed"
(decision 17: the hold goes too) from "this hold deliberately starts at a count". Each command
that deletes a move end would have to remember to delete the hold. A forgotten case leaves a
solid "decided" hold at a spot nobody chose. Storing the anchor removes that trap.

## The proposal

`timeline_held_marks` gains `anchor TEXT NOT NULL CHECK (anchor IN ('arrival', 'count'))`.

| Anchor    | Made by                                                                                                                                     | Invariant (H-2)                                       | When its start moves or goes                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arrival` | A hold made where a move ends (Hold from previous page when a move ends at the previous flag; bar edits that snap to an arrival), or beat 0 | a row of the marcher ends at `start_beat`, or it is 0 | Follows the move end when it's retimed. **Deleted with it** (decision 17), automatically, by the shared upkeep step, for every command.                                     |
| `count`   | Hold from previous page when nothing arrives at the previous flag; hold over the window; bar-start drag to a count; Make all selected Held  | `start_beat >= 0` (any count)                         | **Stays on its count.** A flag delete leaves it, as a flag delete leaves rows. A flag drag or ripple moves it by the same rule as a row edge at that count (`GridEdgeMap`). |

**What a count hold holds:** wherever the marcher already is at its start count, which it shows
because it follows an earlier set. So it **borrows** its spot:

- **An edit of that earlier set** carries into the hold. This is the Held rule: earlier edits
  carry in.
- **A drag inside the hold** writes a move ending at the hold's start count. That move starts at
  the later of the marcher's last arrival and the page flag before the count. The hold then sits
  on its own spot. The anchor stays `count`: the hold was made at a count, and deleting that new
  move later leaves it borrowing again, not gone.
- **Removing the arrival it borrows from** doesn't remove it. It borrows from the set before.

**Rules that change:**

- The explicit "delete the hold with its arrival" in each command (added 2026-10-25) is replaced
  by the shared upkeep step, which acts on `arrival` holds only.
- **A deleted page flag that a hold starts at:** the hold stays at the same count (owner,
  2026-10-26, after weighing extend and drop across workflows).
  - Extending would make earlier counts Held: in writing backwards that takes in sets not written
    yet, and in revision it silently changes behaviour.
  - Dropping would silently make later counts Following.
  - Keeping changes nothing but the page grid, which is what a flag delete promises (UI-18).
- **A move created over a hold's start** (it starts before the hold and ends inside it): the part
  it covers is trimmed. The hold's new start is that move's end, so its anchor becomes `arrival`.

## Display

The bar's **start** says which kind of hold it is:

```text
arrival hold:   ◆━━━━━━━━━━━━┃     grows out of its keyframe diamond
count hold:  ┄┄┄┄┄┄┄[━━━━━━━━┃     a bracket at its count, and a faint dashed line back
             ◆                      to the keyframe its spot comes from
```

- **Hover the bracket:** "Held from count 32 · standing at Page 2's spot".
- **On the field** the marcher draws solid (Held, decision 8). Its route has no square at the
  hold's start, because no coordinate is set there.
- **After the first drag inside a count hold:** a diamond appears at its start, and the dashed line
  goes.
- **The dashed line is a follow link:** the hold changes when the source page changes. The
  follow-link chain (#297, decision 12) can live on that line rather than on a separate
  page-box icon.

## Open (for review)

1. Is a borrowed Held hold distinguishable enough from Following? Both change when the earlier set
   is edited; they differ in what a drag inside does, and in the look (solid bar with a bracket,
   versus a dashed bar).
2. Should Hold from previous page choose `arrival` whenever a move ends at the previous flag? That
   makes deleting that move later remove the hold (17), rather than leaving it borrowing.
