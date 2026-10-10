<!-- cspell:words Onshape -->

# Shape tools: research and proposal

Status: research, 2026-10-10. Nothing here is decided until the owner answers the questions at the end.

## The brief

- **Shape creation happens in place.** A shape tool positions the selected marchers at one point
  in time and nothing else. Motion stays in the timeline.
- **Needed now:** lines, circles, arcs, curves (splines), and boxes or blocks with variations and
  staggers.
- **Needed later:** kinds we don't know yet.
- **One consistent, extensible system** for where tools live, how they are activated and how
  their parameters are edited. Adding a kind must not add UI. Pyware classic is the example to
  avoid: it has about 31 palette tools, each with its own panel.

## Reports

| File                                   | What it covers                                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [01-codebase.md](01-codebase.md)       | What exists in timeline mode, the write path, actions layer, canvas tool modes, UI pieces, risks                                                                              |
| [02-prior-art.md](02-prior-art.md)     | Pyware classic and 3DX, EnVision, formation apps, Figma, Illustrator, Blender, Onshape. Four candidate architectures (C.1 to C.4) with a comparison table                     |
| [03-shape-model.md](03-shape-model.md) | Taxonomy of formations, the `ShapeKind` contract (line, arc, block with stagger and spline declared in full), storage options, assignment algorithms, a suggested build order |
| [04-user-voice.md](04-user-voice.md)   | GitHub issues and discussions, today's shape bugs, and the owner's UX rules with references                                                                                   |

## What the research agrees on

1. **One Shape tool with many kinds, not one tool per shape.**
   - Users asked for this in #572 and #567.
   - Pyware's own next product (3DX) moved all draw tools into one shared Tool Inspector.
   - ArrangeUs, the formation app, applies presets to the selected people.
2. **Kinds are declared by data, and the UI is generated from them.** Each kind declares:
   - a parameter schema;
   - how it fits the current selection;
   - its handle roles;
   - `generate(params, n)`, which returns the slots;
   - validation.

   The panel and canvas handles are built from this declaration, the same pattern as Onshape
   FeatureScript and Figma plugin parameters. A new kind is one file, with no new chrome and no
   schema migration (see 03 §2).

3. **Spacing and Order are shared sections, not per-tool features.**
   - Spacing is "Fit" (spacing derived from length) or "Interval in steps" (length derived), with
     an anchor and stagger where it applies. Every drill tool uses this Positions/Interval
     vocabulary, and users asked for typed step spacing (#566, #697, #728, #162).
   - Order is Nearest (Hungarian on squared distance), Keep order, Drill number, Reverse.
     Assignment is fixed when the tool opens and kept while you drag. Reassign is explicit.
4. **Select first, then shape.**
   - Selecting fits a default shape through the current positions (`newShapeThrough` exists).
   - A live ghost preview shows the result.
   - Enter applies as one undoable edit, and Esc cancels. Cancel must restore the canvas listeners
     cleanly, which is today's #930 bug.
5. **In place maps onto the existing write seam.**
   - Apply calls `transformMarchersInSelection` (`timelineCoordinateWrites.ts`), which ends in
     `moveMarchersInTarget`.
   - That writes the move ending at the playhead.
   - It already handles the edit window, isolation, skip-if-unchanged, toasts and one undo step.
6. **Rotate, scale, mirror and distribute go in the same system** as identity-assignment kinds
   that use the selection's existing order. #257 asks for a chosen origin.

## Proposed architecture (for discussion)

This is prior-art C.1 as the backbone, C.4 handles as the main geometry input, and an optional C.2
pop-up.

- **Entry points.** These are the only new chrome:
  - one Shape tool, with a single key and toolbar button that replaces today's `ShapeSelector`;
  - per-kind command palette entries ("Shape: Arc") that open the same tool;
  - a kind picker in the tool header that recalls the last kind. Changing the kind keeps the
    marchers and the assignment.
- **Home for parameters.** One "Shape" section, docked in the inspector, generated from the kind's
  schema:
  - Kind
  - Kind parameters (with a "More" disclosure for the rest)
  - Spacing
  - Order
  - Apply and Cancel

  Typed values are in steps, using `UnitInput`, `DragInput` and `Slider`.

- **On the field.** Each shape gets handles by role (endpoints, rim, a count/spacing handle, a
  stagger corner), plus ghost slots and a min-spacing or off-field warning. There are no handles
  per marcher.
- **Optional pop-up:** a small card by the shape that shows only the fields marked `primary`, from
  the same schema. Figma reverted floating panels in UI3 because "they slowed people down", so this
  should be an A/B question, not a default (see the owner's simulated-user study practice).
- **Storage (03 §3, option c).**
  - Apply bakes individual positions through the existing seam, so the resolver and file rules
    don't change and older builds still play the show.
  - It also saves a re-editable **recipe**: kind, version, parameters, marcher ids in slot order,
    timeline and beat.
  - Re-selecting those marchers at that beat offers "Edit shape".
  - A hand nudge marks the recipe "modified" visibly. Today the shape link is silently lost.
  - Storing parametric spec shapes per kind (option b) is rejected. It would need a spec, schema
    and resolver change per kind, and it breaks UI-9's one-move-per-marcher rule (01 §14).
- **Extensibility check.** Adding "diamond" or "wedge" means one `ShapeKind` file and one palette
  entry. Nothing else changes.

## Questions for the owner

1. **Re-editable shapes.** Bake plus recipe (recommended), bake only, or persistent spec shapes?
2. **Parameter home.** Inspector only, inspector plus a primary-field pop-up, or a pop-up first?
   This could be run as a simulated-user A/B.
3. **Mid-move playhead.** "In place" writes to the move ending at the playhead. When the playhead
   is inside a move, should the tool target that move's end (as canvas edits do now) or refuse?
4. **Transforms.** Should rotate, scale, mirror and distribute join the system in v1?
5. **Follow the leader.** Does it need a spec shape, and is it in v1 or later?
6. **Snapping.** Legacy shapes use Shift to stop rounding, and the timeline uses Alt. Which one
   rule should apply?
7. **v1 spacing.** Are mixed intervals (`5x3,10x2`) and rise over run needed in v1?
8. **Discussion #1009.** The "Shapes and transitions" slides deck couldn't be read. Does it already
   settle any of the above?

## Suggested build order (after decisions)

1. Contract, `pathSampler` and `lattice` helpers, and line and arc kinds, with pure unit tests.
2. The Shape tool shell: actions entry, canvas mode, inspector section generated from the schema,
   preview, Apply through the write seam, and Esc/undo.
3. Circle, block (with stagger and rotation) and spline.
4. Recipe storage and "Edit shape".
5. Transforms, then an A/B of the pop-up.
