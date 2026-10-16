<!-- cspell:words scrub scrubs scrubbing unstar rebindable -->

# The shape system: UX spec

Status: owner decisions, 2026-10-15 and 2026-10-16, from two rounds of clickable prototypes. This
spec covers how every shape is reached, drawn, edited, transformed and shown. Each kind's own
geometry and parameters are specified separately, shape by shape, like
[06-box-v1.md](06-box-v1.md).

Builds on [06-box-v1.md](06-box-v1.md), [07-placed-boxes.md](07-placed-boxes.md) and
[ADR 0006](../../../adr/0006-shape-recipes.md). Where this spec and those disagree, this one wins
for the UI; their storage and membership rules stand.

## Prototypes

Both are single HTML files on the fork branch `proto/shape-ui-ideas`, in
`docs/timeline/research/shapes/prototypes/`. They are throwaway code, not a starting point.

- `shape-ui-ideas.html`: v1, 17 variants across four questions (focus, controls, palette,
  transforms). The owner picked from these.
- `shape-ui-v2.html`: v2, the picks combined into one system, then refined hands-on. **This is
  the reference for this spec.** Where the two differ, v2 wins.

## What a shape is

- **A shape is a tool for placing the selected marchers at one moment**: the playhead, which is
  the end of the move being edited. It doesn't shape the motion before that moment; motion
  stays in the timeline. (Follow the leader, which would use a shape's path for the motion, is
  out of scope.)
- Placing writes ordinary positions through the same path as a canvas drag, and saves a recipe
  beside them (ADR 0006), so a placed shape can be selected and edited again
  ([07-placed-boxes.md](07-placed-boxes.md)).
- **Every kind shares one frame**: a center, a size (width and depth), a rotation and a flip.
  Moving, rotating, flipping and resizing work the same way on every kind. A kind decides only
  what its own parameters are and how its spots sit inside the frame.

## Lifecycle

A shape session moves through these states. The field styling for each is in
[Marcher styling](#marcher-styling).

| State                | How you get there                                         | What's on screen                                                                           |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Idle**             | Nothing open                                              | The normal field                                                                           |
| **Armed**            | A kind is picked and marchers are selected; nothing drawn | A hint ("Drag on the field to draw a box"), and the cursor badge for Sketch                |
| **Drawing**          | Pointer down on the field while armed                     | The new spots under the cursor; marchers stay put                                          |
| **Open**             | Pointer up after drawing, or a shape made another way     | The new spots, the walks, the outline, the handles and the floating editor                 |
| **Gesture**          | Dragging a handle, the center dot or a number             | As Open, with who goes where held still until release                                      |
| **Placed**           | Enter or Place                                            | Marchers on their spots. The shape stays selectable as a placed shape                      |
| **Placed, selected** | Clicking a member of a placed shape (07)                  | The outline, handles and floating editor again; every edit saves on release, with no Place |

- **Enter** or **Place** places an open shape as one undo step. **Esc** cancels it.
- Esc closes the innermost thing first: a number being typed, then the typed-steps box or the
  favorites ring, then the open shape.
- A press on the empty field outside an open shape draws a new one that replaces it (06).
- Changing the selection, or scrubbing the playhead, while a shape is open drops the open shape.
  A toast offers to bring it back. (The first shape tool had this toast; box v1 doesn't yet.)

## Getting a shape

There are five ways in, all opening the same tool session. They differ only in how the kind and
its first size are chosen.

### 1. The Shapes tab

- A **Shapes** tab in the top toolbar, next to the other tabs.
- Its ribbon, left to right:
  1. **Type**, **Sketch** and **Library**.
  2. Every basic kind, each with an icon and its name.
  3. The user's starred saved and custom shapes, after a divider.
- Picking a kind arms it. Then drag on the field to draw. If a shape is already open, picking
  another kind converts it and keeps its frame.
- Box keeps its existing **B** key.

### 2. The favorites ring

- Holding a key, or pressing and holding the right mouse button on the field, opens a ring of
  the user's starred shapes around the cursor. Slide toward one and release to arm it.
- The ring holds up to 8 shapes. Starring a ninth asks the user to unstar one first.
- **Key:** the prototype used S, but S is the nudge-down key. **F** (for favorites) is unbound
  and is the proposed default. It goes through the shortcut system, so it can be rebound.

### 3. The library (the inspector's Library tab)

- Shapes are grouped as **Basic**, **Saved** and **Custom**. Each row has a star, an icon, a name
  and a note ("Line · 1.5 apart"). Saved and custom rows can be deleted.
- A star puts the shape in the favorites ring and the Shapes tab.
- **+ Save current shape** saves the open shape's kind and spacing as a saved shape, already
  starred.
- **+ New custom shape** opens an editor in the panel:
  - a square grid; each click adds a corner, and clicking the first corner closes the outline;
  - Undo corner, Clear, and an Open/Closed switch;
  - a live preview of the selected marchers spread evenly along the outline;
  - a name, then **Save to library**, which stars it and arms it.
- A custom shape draws, resizes and transforms like any other kind, inside the same frame.

### 4. Typed steps (/)

- **/** opens a box at the top of the field that asks one question at a time:
  1. **What shape?** A list filters as you type (↑ and ↓ move through it). It includes saved and
     custom shapes.
  2. Then each of the kind's primary parameters, for example for a box: how many across, steps
     apart side to side, then front to back.
  3. Last, **Rotate how many degrees?**
- Each step opens with a sensible default already typed, so pressing Enter accepts it.
- A breadcrumb shows the answers so far ("Box › 6 across › 1.5 apart › ? deep › ?°").
- A small preview of the shape with the selected marchers updates as you type. The field updates
  too.
- **Enter** goes to the next step. **Backspace** in an empty answer goes back one step. **Esc**
  cancels and restores whatever was open before.
- A one-liner fills later answers: "box 4x3 2" chooses Box and fills 4 across and 2 apart, so the
  user just presses Enter through them.
- The questions come from the kind's declared parameters, so a new kind gets typed steps for
  free.

### 5. Sketch

- **Sketch** (in the Shapes tab) turns the next drag into a freehand stroke. On release the tool
  guesses the kind and opens it, with the other likely guesses one click away in the floating
  editor ("Looks like: Circle · Box · Diamond · Keep as drawn").
- **Keep as drawn** keeps the stroke as a curve.
- A party trick: it doesn't need a default key (K, the prototype's key, is "Keep on page").
- Strokes are recorded so recognition can be tuned later.

The command palette also lists each kind ("Shape: Arc"), which arms it.

## The floating editor

A small bar under the open shape holds the numbers people change most. It's the main place for
editing a shape. Owner choice, 2026-10-15.

### Layout

- It sits under the shape's outline, centered, and moves with the shape. It flips above the
  shape when there's no room below.
- For a box: `6 × 2 │ ↔ 2 ↕ 2 steps 🔗 │ ⋯ │ Place`.
- For a path kind (line, arc and others): `Line │ 2 steps apart │ ⋯ │ Place`.
- What appears is the kind's **primary** parameters, declared by the kind. Sizes read as across ×
  deep ("8 × 4"), never as files and ranks.
- **⋯** opens a second row with the less common actions: rotate 90° each way, flip, who goes
  where, and "More in inspector →".
- **Place** shows only while the shape is new. A placed shape that is selected saves each edit on
  release, so its editor has no Place.
- After a sketch, a row of guesses sits above the numbers.

### Numbers you can type or drag

Every number in the editor works the same way. Owner choice, 2026-10-16.

- **Click** a number to type over it. Enter applies it, Esc cancels, and clicking away applies it.
- **Drag** a number to change it. Each number has a drag direction:

  | Number                      | Drag                                                                                                        | Step            |
  | --------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------- |
  | Side-to-side spacing (↔)    | Right for more, left for less                                                                               | ½ step per 8 px |
  | Front-to-back spacing (↕)   | Up for more, down for less                                                                                  | ½ step per 8 px |
  | Any other single value      | Up for more, down for less                                                                                  | ½ step per 8 px |
  | A box's size (6 × 2)        | Sideways for more or fewer across, up or down for more or fewer deep. It locks to the first direction moved | 1 per 16 px     |
  | Rotation (in the inspector) | Right turns clockwise                                                                                       | 1° per 2 px     |

- **Alt** while dragging a spacing gives tenths of a step. **Shift** while dragging a rotation
  snaps to 15°.
- A number lights up while it's being dragged, and its cursor shows its drag direction.
- A drag that ends where it started changes nothing; it doesn't round the value.
- A size change keeps the spacing and the center. A box squashed to one rank and dragged back
  gets its old front-to-back spacing back.
- These pixel rates are first guesses, to be tuned by feel.

### The ratio lock (box)

- A link button at the end of the box's numbers locks its two spacings together. Off by default.
- While locked, changing one spacing changes the other by the same proportion, whether by
  dragging, typing or a handle.
- **Open question:** keeping the ratio exact can leave the second spacing off a half step
  (4.5 makes 5.14). The alternative is to keep both on half steps and the ratio approximate.

## On the field

### Handles and gestures

- **Corner and side handles** resize. What a resize means is the kind's choice, for example a
  box stretches its spacing (06). The inspector's "When I resize" rule can make a box keep its
  spacing and change how many across instead.
  - Shift on a corner keeps the proportions. Alt resizes from the center.
- **A rotate knob** sits above the shape's top edge on a short dashed stem.
  - It turns with the shape, so after a 90° turn it's on the side. (Open question: or always
    above on screen.)
- **Just outside a corner** also rotates, as in design apps.
- Both rotations turn **around the pivot** chosen in the inspector. While rotating, the pivot
  shows as a yellow dot with a dashed line to the cursor, and a tip shows the angle. Shift snaps
  to 15°.
- **A center dot** (white, with an accent ring) moves the whole shape in half steps. While
  dragging, a tip reads the position in drill terms ("3.5 in from S2 45 · 8 in front of back
  hash"). It matters most on crowded shapes, where pressing the body tends to land on a marcher.
  Dragging the body still moves the shape too.
- With a shape open, the nudge keys move the whole shape (07), and `[` and `]` step a box's
  count across.
- Snapping: positions and spacings snap to half steps; Alt turns snapping off, as in the rest of
  the timeline.

### Who goes where

- The default is **Least travel**: the assignment with the least total squared walking distance,
  with no walks crossing. A line moving into another line keeps its order because that's the
  least travel, not because of the old order.
- It's decided from where the marchers start the move, not from the spots being replaced.
- It's held still during any gesture, so marchers don't swap spots under the cursor, and worked
  out again on release (06).
- **Drill order** is the other choice, in the inspector and the editor's ⋯ row.
- The rule lives behind one replaceable function (`shapes/leastTravel.ts`, `LeastTravelSolver`),
  so it can change later without touching kinds or the tool.

## The inspector

The right panel has two tabs while the shape tool is in use: **Shape** and **Library**
([above](#3-the-library-the-inspectors-library-tab)). The Shape tab is for exact work; most
people won't need it. Owner choice, 2026-10-15: handles for most people, the panel for those who
want it.

The Shape tab, top to bottom:

1. **Summary**: the shape and its size ("6 × 2 · 2 across, 2 deep").
2. **Position**, in drill terms: side to side ("3 out from S1 45") and front to back ("7 in front
   of back hash").
3. **Pivot and rotation, on one row.**
   - Pivot: a 3 × 3 grid of the frame's corners, edge midpoints and center. The center is the
     default.
   - Rotate: one number you type or drag (see the table above). There are no preset rotate
     buttons. It turns around the pivot.
4. **Flip**: side to side, and front to back. Around the pivot.
5. **Scale**: ½, −, + and ×2, around the pivot, and the footprint in steps.
6. **When I resize** (box): **Stretch spacing** (default) or **Keep spacing**. Keep spacing makes
   the handles add or remove marchers across instead.
7. **Who goes where**: **Least travel** or **Drill order**, with the longest walk and the total
   walking distance underneath.
8. **Place**, **Cancel** and **☆ Save**.

With nothing open, the tab says how many marchers are selected and how to start a shape.

## Marcher styling

The marchers and marks at each stage. Owner choice for focus, 2026-10-15: fade everyone who isn't
selected.

| Stage                | Selected marchers                                                         | Everyone else                                                             | Marks                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Idle and armed**   | The normal selection style                                                | Normal                                                                    | None                                                                                                                                                                                                              |
| **Drawing**          | Stay where they are, drawn as hollow rings in the accent color, no labels | Faded to about 20%, no labels                                             | The new spots as solid accent dots with a white edge. The outline dashed. No walks yet (06)                                                                                                                       |
| **Open**             | Hollow rings at their start                                               | Faded to about 20%                                                        | The new spots, each labeled with the marcher that will stand there. A thin line from each marcher's start to its spot. The outline solid, with a faint fill on closed shapes. Handles, rotate knob and center dot |
| **Gesture**          | As Open                                                                   | As Open                                                                   | As Open, with spots and walks updating live but the assignment held                                                                                                                                               |
| **Placed**           | Normal, on their new spots                                                | Normal                                                                    | The placed shape's outline and label follow the View setting **Shapes: selected / always / off** (07)                                                                                                             |
| **Placed, selected** | As Open, but on their spots (nothing to walk)                             | Normal (proposed: selecting a placed shape is frequent, so nothing fades) | Outline, handles, knob, center dot and the floating editor                                                                                                                                                        |

- **Labels**: spot labels show for up to 24 marchers. Above that they're hidden, because they
  pile up. Crowded labels shrink rather than drop section letters, and field labels can be turned
  off (owner decision, 2026-10-11).
- **Setting**: the View tab offers **Fade the rest** (default) or **Fade only while drawing**,
  which keeps everyone at full strength except during the drag. Owner choice, 2026-10-16.
- **The replaced shape** (where the marchers stood before this edit, when that differs from their
  start) is hidden by default (owner decision, 2026-10-11).
- **Warnings** (from `validate.ts`) color the walk lines: orange for a step bigger than the step
  limit, red for walks that collide. Pointing at a warning shows only its walks. Off-field spots
  get a warning too.
- **Handles** are filled squares on the frame's corners and edge midpoints, the same style as the
  field's other handles (#208).

## Sizes and counts

Every kind must work, and be checked, from 1 marcher to a full band.

- **1 marcher**: the shape is a point at its center. **2 marchers**: its ends.
- **Odd counts**: a box puts the short rank at the back, centered (06). The editor's size says how
  many spots are empty ("· 1 short").
- **Dozens**: the box split prefers the fewest empty spots (06), so 13 is 7 × 2 with 1 short, 25
  is 5 × 5 and 64 is 8 × 8.
- **Hundreds**: Least travel is cubic in the number of marchers. Above `NEAREST_LIMIT` (500) it
  falls back to keeping order. In the prototype, 109 marchers update in under 10 ms.

## Keys

| Key                        | Does                                                   | Status                                                 |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| **B**                      | Box                                                    | Existing                                               |
| **Enter** / **Esc**        | Place / cancel (innermost first)                       | Existing                                               |
| `[` / `]`                  | One fewer / one more across                            | Existing                                               |
| **/**                      | Typed steps                                            | Unbound today; proposed                                |
| Hold **F**, or right-press | Favorites ring                                         | Unbound today; proposed (S is nudge down)              |
| Nudge keys (WASD, arrows)  | Move the whole open or selected shape                  | 07                                                     |
| Kind letters               | Pick a kind, only inside the ring or the Shapes ribbon | Needs shortcut contexts; deferred (README decision 10) |

All of these go through the shortcut system and are rebindable.

## Out of scope here

- Each kind's geometry, parameters, handles and resize rules: specified shape by shape.
- Filled shapes, staggers and interval locks beyond the box's ratio lock.
- Follow the leader.
- Copying a placed shape to other marchers.

## Open questions for the owner

1. **Ratio lock:** an exact ratio, or both spacings on half steps?
2. **Rotate knob:** turns with the shape (as built), or always above on screen?
3. **Pivot on the field:** should the pivot dot be draggable onto any marcher (for example a
   pinwheel on T1), perhaps by Alt-dragging the center dot?
4. **Custom shapes:** marchers spread evenly along the outline (as built), so a corner gets a
   marcher only if the spacing lands on it. Should corners always get one?
5. **Where saved and custom shapes live:** in the show, in the user's library across shows, or
   both? Stars feel like a user preference.
6. **Stars:** one star puts a shape in both the ring and the Shapes ribbon. Keep them together?
7. **The editor's ⋯ row** still has rotate 90° buttons, and the inspector still has scale
   buttons. Keep them?
8. **Basic mode:** which of the five ways in (tab, ring, library, typed steps, sketch) show in
   Basic mode?
