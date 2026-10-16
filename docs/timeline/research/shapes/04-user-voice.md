<!-- cspell:disable -->

# 04: What users and the project have already said about shapes

Status: research, 2026-10-10. Input for the timeline-mode shape tool system. It doesn't decide
anything. Sources: GitHub issues, PRs and discussions on `OpenMarch/OpenMarch` and the fork
`AlexDumo/OpenMarch-timeline` (read with `gh`, read-only), the docs site in `apps/website`, the
timeline docs in `docs/timeline`, and a public web search.

The owner's framing, for reference: a shape tool is an **in-place** interface that positions the
selected marchers at one point in time. It doesn't describe motion across time. Lines, circles,
arcs, splines, and boxes or blocks with staggers are needed now, with more later, all under **one**
consistent, extensible system. The owner dislikes Pyware's "ton of unrelated tools" feel.

## Summary

- Users ask for the same few things again and again: a **circle**, a **block** and **even, typed
  spacing** (an interval in steps). After those come curve control and fill or scatter. Nobody has
  asked for _more tools_. They ask for the shape they want and a number they can type.
- The page-mode shape UI's pain points are **discoverability** (where's the button, why is it
  disabled), **fragile state** (cancel, undo, nudge and swap break shapes) and **spacing that
  drifts** when handles move.
- The owner's established UX rules are strict: one edit per gesture with Esc to cancel, nothing
  moves that you didn't touch, no marks without a selection, no new Alt shortcuts, contextual keys
  that don't leak, plain words (no "pin"), tooltips with keycaps, and simulated-user A/B tests
  before feel-based choices.
- The public web has almost no OpenMarch shape discussion and no first-hand Reddit or forum threads
  turned up. Pyware's own guide confirms the "many tools" structure the owner wants to avoid:
  10 drawing tools plus 8 editing tools, each a separate tool.

## (a) User requests and pain points

Reaction counts are low across the board (0 to 2). This is a small user base filing issues, so
treat **recurrence across different reporters** as the signal, not votes.

### A1. "Give me a circle" (and other standard shapes)

- [#669](https://github.com/OpenMarch/OpenMarch/issues/669) (Asheryboom, 2025-10): "I want to
  make a perfect circle shape but it's extraordinarily hard … half circles are frustrating."
  They ask for a circle option, or "an option to change how steep the slope is on curves". The
  context is copying someone else's drill.
- [#572](https://github.com/OpenMarch/OpenMarch/issues/572) (LluckDev, 2025-07): "I couldn't
  figure out how to make [a circle]." They propose a **"create shape" button next to "create
  line"** with a dropdown: circle, block, rectangle. That is a single entry point with a kind
  picker, not separate tools.
- [#300](https://github.com/OpenMarch/OpenMarch/issues/300) (owner, 2025-01): "Standard shapes
  like circles and rectangles … predefined dimensions and restrictions", as extensions of
  `MarcherShape`.
- [#116](https://github.com/OpenMarch/OpenMarch/issues/116) (owner, 2024-02): shapes are "a key
  feature to the success of OpenMarch, and its workflow will revolve around this"; "perhaps shapes
  should be stored as separate entities … and have marchers linked to them."

### A2. Blocks, rows and columns

- [#567](https://github.com/OpenMarch/OpenMarch/issues/567) (irishknots, 2025-07): "An easy way to
  form blocks (squares, rhombus, parallelogram, triangles)." The flow they describe: select
  marchers, the shape window opens, choose a block shape plus columns and rows, and the tool moves
  the selected marchers into the form. It "errors out when there are insufficient marchers" and
  fills rows and columns "based on relative location to shape". They call it an "addon to Shape
  Tab", which again means the existing shape panel, not a new tool.
- [#257](https://github.com/OpenMarch/OpenMarch/issues/257) (JGreenlee, contributor and author of
  drill-sequencer) lists "block / parallelogram" among the shapes to create instantly.

### A3. Spacing as a typed number (the most specific pain)

- [#566](https://github.com/OpenMarch/OpenMarch/issues/566) (irishknots, 2025-07): "Adjust spacing
  (in steps) between dots … Allow user to specify a 'Starting point' … The forms currently require
  manual adjustments of the length of the form to ensure spacing is even. There is no snapping of
  spacing." Owner reply: set "the interval as the distance between each marcher", and "this should
  adjust the shape's scale so the marcher's distance matches". The reporter accepts the marchers
  leaving the endpoints: "Condense to the middle?"
- [#728](https://github.com/OpenMarch/OpenMarch/issues/728) (mkshel25, 2025-11, 1 thumbs-up): "In
  the curve the intervals should automatically be locked and not fluctuate based on the segment
  points."
- [#697](https://github.com/OpenMarch/OpenMarch/issues/697) (owner, 2025): "Setting the interval
  between marchers is difficult and requires manual calculation." The owner wants it "as simple
  as possible": X and Y interval buttons in the right sidebar beside the alignment buttons, with
  a preset value and an arrow to change it, "kind of like how we have coordinate rounding". Since
  implemented, but "the order of the marchers changes when the button is pressed".
- [#162](https://github.com/OpenMarch/OpenMarch/issues/162) (owner, closed): evenly distributing
  "happens in a random order. It should happen in a way where it always makes a straight line."
- [#262](https://github.com/OpenMarch/OpenMarch/issues/262) (owner + JGreenlee): how to distribute
  along a path. JGreenlee: "I would prioritize even spacing; it is ok to not always put a marcher
  on every significant feature … trust that the designer will adjust the shapes … PyWare does it
  well."

### A4. Curve control and editing points

- [#236](https://github.com/OpenMarch/OpenMarch/issues/236) (owner): the shape editor was "very
  bare bones … horrendously ugly with many missing features". The checklist includes showing each
  point's coordinates, applying the shape to the previous or next page, and changing marcher order
  "in the canvas" by dragging. Owner: "this issue should focus on making the individual points
  editable."
- [#259](https://github.com/OpenMarch/OpenMarch/issues/259) (trevorschachner, co-founder):
  "Instead of navigating out of your workflow to add another segment, you can create a new segment
  … by clicking the center point between two control points" (the Miro pattern). Direct
  manipulation on the canvas instead of inspector buttons.
- [#230](https://github.com/OpenMarch/OpenMarch/issues/230): curves shouldn't grab clicks through
  their bounding box ("blocks moving on the canvas").
- [#632](https://github.com/OpenMarch/OpenMarch/issues/632) (mkshel25): the shape outline should
  hide during playback (fixed). Shape chrome is only for editing.

### A5. Transformations and the origin

- [#257](https://github.com/OpenMarch/OpenMarch/issues/257): move, scale, flip, skew and rotate
  apply to any selection or to a shape. Proposal: a shape or transformation creates a **Group**;
  a shape group's marchers are "controlled by the properties of the shape"; a free-form group
  keeps individual positions but transforms as a unit. trevorschachner: "these are common across
  other drill design platforms but have problems … the rotate tool rotates the entire shape from
  the center (not a specific point) and then goes off the grid." JGreenlee: "`origin` should be an
  intrinsic property of any Group"; the default is the center. Owner: "Completely agree."
- [#465](https://github.com/OpenMarch/OpenMarch/issues/465), [#631](https://github.com/OpenMarch/OpenMarch/issues/631):
  rotate and scale side effects on the selection box and the dots (closed).

### A6. Who goes where (assignment)

- [#258](https://github.com/OpenMarch/OpenMarch/issues/258) (JGreenlee): "select a number of
  marchers and instantly organize them into a certain shape … with OpenMarch figuring out the
  logical paths". This is the assignment problem: Hungarian algorithm on squared distance, which
  was fine for dozens of marchers. trevorschachner: designers "fold a line to a curve and match in
  a certain way". JGreenlee is wary of AI "design ideas" for art. Timeline mode already answers
  this with nearest-slot casting (ui.md UI-7).
- [#236](https://github.com/OpenMarch/OpenMarch/issues/236): the owner wants marcher order changed
  by dragging on the canvas. [#712](https://github.com/OpenMarch/OpenMarch/issues/712): swapping
  marchers across shapes errors.

### A7. Fill and scatter

- [#869](https://github.com/OpenMarch/OpenMarch/issues/869) (trevorschachner, 2026-02): a Scatter
  tool that fills a prop or a drawn area (rectangle, circle, polygon, freehand) with fill modes
  **Even / Grid / Scatter / Perimeter**. Note its shape: one tool, an _area_ source, and a _mode_
  parameter. That is the parametrized model, not four tools.
- [#262](https://github.com/OpenMarch/OpenMarch/issues/262): "what if we want to _fill_ these
  shapes?"

### A8. Reliability and discoverability of the page-mode shape UI

These are bugs, but they show what users hit:

- [#930](https://github.com/OpenMarch/OpenMarch/issues/930) (2026-05): cancelling Create Line
  "breaks the cursor"; marchers can't be clicked afterwards. A modal tool state that leaks.
- [#931](https://github.com/OpenMarch/OpenMarch/issues/931) (same reporter): nudging a line in a
  shape doesn't save across pages.
- [#903](https://github.com/OpenMarch/OpenMarch/issues/903) (2026-03): "created a line, and then
  created shape, the marchers did not move to the shape", only in a large file.
- [#537](https://github.com/OpenMarch/OpenMarch/issues/537): dragging endpoints does nothing.
  [#234](https://github.com/OpenMarch/OpenMarch/issues/234), [#241](https://github.com/OpenMarch/OpenMarch/issues/241),
  [#306](https://github.com/OpenMarch/OpenMarch/issues/306): undo during or after shape creation is
  buggy or crashes. [#256](https://github.com/OpenMarch/OpenMarch/issues/256): creating shapes
  sometimes creates pages.
- [Discussion #321](https://github.com/OpenMarch/OpenMarch/discussions/321) (btmtiger27, a band
  director, 2025-03): "OpenMarch would not let us align our marchers … the side tool bar … do[es]
  not work when you press on them. I can't even begin to drill." The cause: the alignment buttons
  need a selection and give no hint why they're disabled. They also asked "Where are the segment
  buttons?" Owner: "select multiple marchers, then a button will come up on the side that says
  'create shape'"; the director still couldn't get it to work. They also asked for Follow the
  Leader and Step-2 (HBCU) drill.

### A9. Related motion requests (out of scope, but they share the tool surface)

- Follow the leader: [#514](https://github.com/OpenMarch/OpenMarch/issues/514),
  [#894](https://github.com/OpenMarch/OpenMarch/issues/894), Discussion #321. Curved and edited
  pathways: [#292](https://github.com/OpenMarch/OpenMarch/issues/292),
  [#617](https://github.com/OpenMarch/OpenMarch/issues/617). These are _across-time_ tools. The
  owner's framing keeps them out of the shape system, but users ask for them in the same breath.
- [#977](https://github.com/OpenMarch/OpenMarch/issues/977): "similar to PyWare but I don't love
  their app".
- [Discussion #680](https://github.com/OpenMarch/OpenMarch/discussions/680) (owner, 2025-10,
  "Power Mode"): Vim-like composable commands, e.g. `3-i-x` = 3-step interval on x, `30-r` =
  rotate 30°. "Once you learn how to navigate … you don't need to re-learn how to delete, select,
  or copy those lines. The base commands remain the same." Composability is the owner's stated
  ideal for power users.
- [Discussion #1009](https://github.com/OpenMarch/OpenMarch/discussions/1009) (owner, 2026-08,
  "Shapes and transitions"): links to a Google Slides deck only, which wasn't readable here. The
  owner should point to it if it holds shape-UI decisions.

### A10. History of the page-mode design

- [Discussion #206](https://github.com/OpenMarch/OpenMarch/discussions/206) (0.0.3): the line flow
  is select 3+ marchers, then **Draw Line** (or `L`), draw, drag marchers to reorder, then
  **Apply**/Enter. "This is the start of a new feature called an 'Alignment Event.' This will be
  how other shapes are created as well." `CanvasListeners` swap canvas behavior per event. The owner
  chose not to make lines editable: "users can just cancel and create a new line."
- [PR #235](https://github.com/OpenMarch/OpenMarch/pull/235) "Shapes and curves", [#764](https://github.com/OpenMarch/OpenMarch/pull/764)
  "Consistent marcher distribution in curves", [#744](https://github.com/OpenMarch/OpenMarch/pull/744)
  "Set marcher interval", [#676](https://github.com/OpenMarch/OpenMarch/pull/676) flip, [#519](https://github.com/OpenMarch/OpenMarch/pull/519) lasso.
- Blog, December 2024 (`apps/website/src/content/blog/2024-12-03-update`): shapes are SVG paths,
  so "the only limit to the shapes OpenMarch can create is my ability to create a UI that allows
  users to draw it." "Curves were real hard to do."
- Fork: [#34](https://github.com/AlexDumo/OpenMarch-timeline/pull/34) (P8.2, draw and edit
  timeline shapes from the inspector) and [#36](https://github.com/AlexDumo/OpenMarch-timeline/pull/36)
  (P7.11, shapes on the canvas). These are the spec-shape editor described in ui.md "Shapes (P8.2)".

### A11. How the docs explain shapes to users today

`apps/website/src/content/docs/guides/writing-drill.mdx`:

- **Toolbar alignment tools:** lock X/Y, align vertical/horizontal, evenly distribute
  vertical/horizontal, copy from previous/next page.
- **Group editing:** Create Line ("Draw a line in the inspector, then apply coordinates or group
  into a Shape"), rotate handle, scale handles. Tip: `1` snaps to the nearest whole step after
  editing, but "does not work for shapes yet".
- **Shapes:** copy to previous/next page, Ungroup, segments **Line / Single curve / Double curve /
  Move / Close**; delete removes the _last_ segment; handles follow coordinate rounding and Shift
  turns rounding off.
- The workflow it teaches: select → line or shape in the inspector → fine-tune with alignment
  tools → `1` to snap → copy to other pages.

The model it teaches users is SVG segments. Users think in **circle, block, arc, interval**, and
the docs have no word for those.

### A12. Public web

- No Reddit, Discord or YouTube posts about OpenMarch shapes turned up in search. Third-party
  pages (AlternativeTo, a school tutorial list) only say that OpenMarch exists and that tutorials
  cover "shapes". The project's own pitch: "free and easy … enough for 90% of ensembles … skip a
  steep learning curve."
- No independent drill-writer threads on Pyware shape-tool pain turned up. Pyware's own
  [3D user guide](https://www.pyware.com/guide/3d/) lists **10 drawing tools** (Line, Circle,
  Point, Arc, Curve, Free Form, Filled Shape, Block, Bezier Curve, Polygon), a separate **Sketch
  Mode**, and **8 editing and maneuvering tools** (Push, Fixed Interval Float, Rotate, Morph,
  Follow the Leader, Resize, Track, Stagger). Each is its own tool, and the vendor's guide says
  learning 3D "will take a minimum amount of time … work through the Tutorial". This is the
  structure the owner calls "a ton of unrelated tools". Stagger and fixed interval are separate
  tools there; in OpenMarch they should be parameters.
- Competitors' marketing (DrillFlo: "clean lines, curves, arcs, and complex forms without the
  friction"; Drill Pirate: "lines, arcs, curves, geometric shapes") shows that the same shape list
  is table stakes.
- A follow-up worth doing by hand: ask on the OpenMarch Discord and r/marchingband, since search
  engines don't index those threads well.

## (b) The owner's established UX principles

Each rule is from a decision in the docs or a recorded owner preference. Owner-preference notes
that aren't in the repo come from the lead's project memory (marked _memory_).

1. **A gesture never moves a dot the user didn't touch.** `research/ownership/06-authoring-ux.md`
   §1, rule 1. Also UI-15 "what you don't touch keeps its counts". Watch-for signal in
   `VALIDATION.md` "How to check": "a dot moving that you didn't touch; motion you didn't draw".
2. **One gesture is one undoable edit, committed on release; Esc, a lost pointer or a drag brought
   back writes nothing.** ui.md UI-15 "One edit, Esc cancels"; P8.2 "each change is one undoable
   edit … a change that writes nothing is skipped".
3. **Never a silent no-op, and refusals say why.** ui.md UI-15 "the edge waits on the nearest
   allowed beat … the readout says why"; P8.2 "what the database would refuse is disabled with the
   reason". The opposite of Discussion #321's mute buttons.
4. **Direct manipulation on the field and the timeline first; the inspector names and explains.**
   UI-14's Move card: "To change where they end up, drag marchers on the field". The owner asked
   for canvas reordering (#236) and the trevorschachner midpoint-add (#259).
5. **No marks without a selection.** Chips, chains and kept marks appear only for what is selected
   (`VALIDATION.md`: "none without a selection (owner)"; _memory_ defined-coordinates: "no marks
   without selection on timeline"). Chrome is hidden while playing, scrubbing or isolating
   (`VALIDATION.md` hold mark; #632).
6. **No new Alt shortcuts.** Alt already means "no snap" (UI-12, UI-15) and pans; _memory_
   defined-coordinates: "no Alt shortcut". Alt, not Shift, turns snapping off (_memory_
   calmer-timeline).
7. **Contextual keys that don't leak.** Keys work on the focused thing and stop there:
   `data-timeline-own-keys`/`isTimelineOwnKey` (ui.md UI-14 "Keys on the move controls"). Enter on
   the Move card must not reach "the app's shape shortcut"; Delete on a clip mustn't delete a
   shape. Typing in a field keeps its keys. `K` is contextual (_memory_ defined-coordinates).
8. **Shortcuts are taught, not hidden.** Tooltips with keycaps after 500 ms (at once on focus) plus
   a hint line; no keycaps drawn inside buttons; `?` lists every shortcut from the action registry
   (ui.md UI-17 "Communicating the shortcuts"; V-155, V-158). Registered through the #1031 actions
   layer and ⌘K palette.
9. **No global mode that silently changes what a key does.** The UI-17 survey found that "what
   confuses people is a global mode that silently changes what Space does". The owner dropped the
   second Play and From start mode. A shape tool that is a sticky mode is suspect.
10. **Plain designer words, one vocabulary.** "Page 3, counts 1–4"; "through set 2" instead of
    "passes through page 2's set" (UI-17); developer words (D-REBASE, founding span) are bugs
    (UI-14). Don't use "pin" for anything new: the start flag owns it (_memory_ defined-coordinates).
    Readouts follow one pattern (UI-15 "Readouts").
11. **Decide feel-based defaults with evidence.** Simulated-user blind A/B studies decided UI-17
    (V-162: 4/4; V-169: 4/4), and the owner "wants studies with simulated users before deciding UX"
    (_memory_). Every feel-based default gets a V-row in `VALIDATION.md` for a hands-on check
    (`VALIDATION.md` intro).
12. **Calm, compact chrome.** The owner found the timeline "intimidating and clunky" and the side
    card "took over half the screen in fullscreen" (UI-12; _memory_ calmer-timeline). Prefers
    choosing between mock-ups (UI-12 layout A, hold-mark mock-up D).
13. **Model wins over presentation; edits are in absolute field coordinates.** ui.md header ("the
    spec still wins on the model; this file decides presentation"); P8.2 "absolute field
    coordinates (D-5)". A change to a shared shape "moves every marcher heading to it", so the
    editor names who is affected.
14. **Composability over tool count.** Discussion #680: learn a verb once and it works on
    everything ("the base commands remain the same"). The owner's dislike of Pyware's many tools
    is the same idea.
15. **Simple first, power behind it.** #697: "as simple as possible for now"; a preset button with
    an arrow to change the value, "like coordinate rounding". Discussion #206: "users can just
    cancel and create a new line" rather than building an editor too early.

## (c) Implications for the shape tool system

### Must-haves

- **One entry point with a kind picker**, not a tool per shape. Users proposed it themselves
  (#572: "create shape" + dropdown; #567: "addon to Shape Tab"; #869: one tool with modes). Line,
  arc, circle, spline, box and block are _kinds_, and new kinds plug in with a parameter schema.
- **Parameters, not tools, for variants.** Stagger, interval, rows×columns, fill mode
  (perimeter/grid/even/scatter), direction, start point and closed/open are parameters of a kind.
  Pyware's separate Stagger and Fixed Interval Float tools are the anti-pattern.
- **Typed interval in steps, as a first-class parameter of every kind** (#566, #697, #728), with
  the shape resizing to fit and a choice of anchor (start, center or end; "condense to the
  middle"). Spacing stays locked while handles move (#728).
- **Stable, sensible order.** Applying a shape keeps the marchers' relative order, or casts
  nearest-slot (UI-7), and is never random (#162, #697 regression). Reorder by dragging on the
  canvas (#236).
- **Seeded from the selection, applied in place at the playhead.** Matches the owner's framing and
  P8.2's "drawn through the selected marchers where they stand". Only selected marchers move
  (principle 1).
- **Live preview, then one commit.** Handles and parameters preview on the field; Enter or
  pointer-up commits one undoable edit; Esc reverts to the exact starting positions, the cursor and
  selection included (#930). Undo mid-shape must be safe (#306, #234).
- **Explain why it's unavailable.** With no selection or too few marchers, say so in place ("Select
  2 or more marchers"), not a mute button (Discussion #321). Block with too few cells: say how many
  are needed (#567 "errors out").
- **An origin for transforms** (#257): rotate, scale and flip about a chosen point, defaulting to
  the center, so rotating doesn't "go off the grid".
- **Keyboard path through the action registry** (#1031): every kind and parameter reachable from ⌘K
  and a contextual key, with keycap tooltips and a `?` entry. Leaves room for #680's composable
  "number + verb".
- **Snapping that follows the app's rules:** handles follow coordinate rounding; Alt turns snapping
  off (not Shift; page-mode Shapes use Shift today, which needs reconciling); `1` snap works on
  shapes too (the docs' "does not work for shapes yet").
- **User-facing names users already use:** line, arc, circle, curve, block, box, interval, stagger,
  rows, columns. Not "segment", "slot", "transition", "cast" or "pin".

### Must-avoids

- **A palette of unrelated tools** (Pyware's 10 + 8). Each new shape must not add a toolbar button
  or a new mode.
- **Sticky modal tools that capture the canvas.** Discussion #206's `AlignmentEvent` listeners are
  the source of #930-type bugs. Prefer a transient in-place session that ends on commit or Esc, or
  make the mode visible and impossible to leave half-applied.
- **Shape chrome visible without a selection or during playback** (principle 5, #632).
- **Alt bindings, global shortcuts that leak into fields or clips,** and keycaps drawn inside
  buttons.
- **Moving marchers outside the selection**, or silently re-timing anything. A shape edit is
  in-place at one beat. If a shape is shared by transitions (P8.2), say who else moves.
- **Bypassing the timeline write path.** #931 (nudge not saving across pages) and #903 (shape not
  applied on big files) are what happens when shape state and positions diverge.
- **Exposing SVG segment mechanics as the primary UI** ("Move", "Close", "delete last segment").
  Keep them for a freeform/spline kind only.
- **Auto-"design ideas" or ML assignment** as a default (JGreenlee's caution on #258). Deterministic
  nearest-slot is enough.

### Open questions this raises for the owner

1. Persistent, re-editable shape objects (#116, #257 "Group", spec shapes) vs. baked positions
   (Discussion #206's "cancel and redo"). Users ask for re-editing (#236, #566), and this is the
   decision already noted as open.
2. Floating popup next to the shape vs. inspector parameters. The users' proposals point at the
   existing panel (#567 "Shape Tab", #572 next to "create line"). The calm-chrome rule (12) argues
   for a small popup. A simulated-user A/B fits here (principle 11).
3. Whether transforms (rotate, scale, flip, skew) belong to the same system as a "kind-less" shape
   (#257 free-form group), so there is one surface for everything that positions a selection.
4. What the Slides deck in Discussion #1009 already decided.
