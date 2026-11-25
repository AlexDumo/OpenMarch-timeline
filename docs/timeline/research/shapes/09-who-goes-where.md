# Who goes where: options, picking by hand and Swap

When marchers move into a new shape, the writer decides which marcher takes which spot. Before
this change the floating editor offered Least travel, Keep order (only when every marcher was on
one placed Line) and Reverse order. This change adds more ways to choose, and a way to pick by hand.

The design was settled with the owner on 2026-11-25 through an interactive prototype (line to
arc, line to two arcs, two lines to an arc, 32 in a line, block to circle, and two moves where
the shapes overlap).

## Change log

Every change on this branch is listed here, with how to see it. Nothing else changes.
Status: **done** (built and checked), **building**, **planned**.

| #   | Change                                                                                                                                                                                                                                                                                              | How to see it                                                                                                                                    | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 1   | Keep order follows an order set by hand (Set order, Reverse), not only a placed Line's order.                                                                                                                                                                                                       | Set order on a line of marchers, open the Arc tool on them, draw: Keep order is picked and the first marcher you set takes the arc's first spot. | planned |
| 2   | The Who goes where menu lists every option. One that doesn't fit is greyed out and says why, instead of being left out.                                                                                                                                                                             | Open the Arc tool on marchers with no order: Keep order is greyed, with "These marchers have no order yet…".                                     | planned |
| 3   | New option **Inside out**: the middle of the line goes to the ends of the shape (each half of the order flipped).                                                                                                                                                                                   | On a line with an order, pick Inside out: the middle marchers walk to the arc's ends.                                                            | planned |
| 4   | New option **Zipper**: two lines merge into one, taking turns. Offered when the marchers come from exactly two lines with an order.                                                                                                                                                                 | Two placed Lines into one arc: Zipper alternates them.                                                                                           | planned |
| 5   | New option **Within sections**: each section takes a run of spots together, Least travel inside each.                                                                                                                                                                                               | Mixed sections into an arc: each section stays together.                                                                                         | planned |
| 6   | **Pick by hand**: pick marchers and spots in any back-and-forth order; the 1st marcher picked takes the 1st spot picked. A Marchers / Spots toggle (Tab) says which you're picking from; the other fades. Everyone not picked keeps the option's spot; anyone bumped goes to the nearest free spot. | Open a shape, Pick by hand, click a marcher's start ghost then a spot.                                                                           | planned |
| 7   | **Swap two**: click two marchers to trade their spots.                                                                                                                                                                                                                                              | Open a shape, Swap two, click two marchers.                                                                                                      | planned |
| 8   | Readout under the Who goes where options: the biggest step and how many paths cross.                                                                                                                                                                                                                | Open the Who goes where menu.                                                                                                                    | planned |
| 9   | Saved data: a shape's `order_mode` can also be `inside`, `zipper` or `sections` (ADR 0006 note). No migration.                                                                                                                                                                                      | —                                                                                                                                                | planned |
| 10  | User guide: the shape tool page describes the options, picking by hand and Swap.                                                                                                                                                                                                                    | Guide page.                                                                                                                                      | planned |

## Not in this change

- Different count structures per marcher (staggered starts, holds inside the move).
- Picking by hand and Swap on a placed shape. They work while a shape is open in the shape tool.
  A placed shape keeps everyone's spot when it is reshaped; picking Least travel, Keep order or
  Reverse on it works it out again, as before.
- Translations other than English (the translation agent fills them later).

## Saved data

A placed shape already saves who goes where as `order_mode` (free text) and `reverse`, and each
member's spot as its slot. The new options save `order_mode` as `inside`, `zipper` or `sections`.
Hand picks and swaps are saved only as the members' slots: the shape remembers where everyone
stands, not how they were picked. An older build reads an unknown `order_mode` as Least travel
when it next works the shape out; until then everyone keeps their saved spot.
