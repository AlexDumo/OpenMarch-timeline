# 0004: Shapes are stored as recipes beside the positions they place

- Status: proposed
- Date: 2026-10-10

## Context

The Shape tool (docs/timeline/research/shapes/README.md) places selected marchers on a shape at
one moment: the end of the move being edited, or their homes. It writes the positions through
the same path as a canvas drag (`moveMarchersInTarget`), so playback, the resolver, the file
format and older app versions see ordinary positions.

The owner wants shapes kept as re-editable records: "an equation that lays out how the marchers
are distributed, but we can have overrides". Reopening a placed arc should show the arc, with
its settings, and changing its radius should move its marchers again, keeping any marcher the
designer has since nudged by hand where it is relative to its spot.

The spec's own shapes (`timeline_shapes`, `dest_shape_id`) can't carry this. They have five
fixed kinds checked by the database, every new kind would be a spec, schema and resolver change,
and a group transition into a shape breaks UI-9's one-transition-per-marcher rule
(01-codebase.md §6). Shape kinds are meant to grow without schema changes (03-shape-model.md §3).

## Decision

1. **Positions stay the source of truth for motion.** Placing a shape writes positions exactly
   as today. Nothing the resolver reads changes.
2. **A recipe is stored beside them**, in two new app tables (not spec tables, no change-log
   triggers, with history triggers so undo and redo restore them with the positions):
   - `timeline_shape_recipes`: `id`, `timeline_id` (the move whose end it shapes, `NULL` for
     homes; deleted with the move), `kind` and `kind_version` (the shape kind's id and generator
     version), `params` (the kind's JSON parameters), `order_mode` and `reverse` (who goes where),
     `created_at`.
   - `timeline_shape_recipe_marchers`: a surrogate `id` (ADR 0001 C-2), `recipe_id` (deleted with
     the recipe), `marcher_id` (deleted with the marcher), `slot` (the marcher's spot in the
     recipe's slot order) and `x`, `y` (where the recipe put it when last placed). One row per
     marcher and recipe.
3. **Overrides are the difference between where a member stands and where its recipe put it.**
   They are not stored separately: a member nudged after placement simply stands somewhere else,
   and reopening the recipe shows it as moved by hand. Editing the recipe moves each member to
   its new spot plus its override, unless the designer resets the overrides.
4. **A marcher belongs to at most one recipe per move.** Placing marchers with a new shape
   removes them from older recipes of the same move; a recipe left with no members is deleted.
   Both happen in the same edit as the positions, so it is one undo step.
5. **Kinds own their parameters.** `params` is whatever the kind declares, read by kind id and
   version. An unknown kind or version (a file from a newer app) is shown as a plain group of
   positions: the recipe can't be reopened, but nothing is lost.

## Consequences

- New kinds and parameters never need a migration.
- A file opened in an older app keeps every position; the recipe tables are ignored there.
- Recipes can go stale when other edits move the move's end: they belong to the move by id, so
  resizing or splitting a move keeps them attached to the move that holds those positions.
- Follow the leader can later use a recipe's path as its route (README decision 5).

## Verification

- Migration test: the tables exist after migrating an older file, with their foreign keys.
- History: placing a shape and undoing removes both the positions and the recipe; redo restores
  both, with the same ids.
- Deleting the move, or a marcher, deletes the recipe rows that hang off it.
- Unit tests for reopening: overrides computed from positions, edited recipes keep overrides.
