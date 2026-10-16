<!-- cspell:disable -->

# Shape tools 02: prior art (drill software, formation apps, design tools)

Status: research, 2026-10-10. Web research only. It doesn't decide anything. Companion to
[03-shape-model.md](03-shape-model.md) (data model) and [04-user-voice.md](04-user-voice.md) (what
users have asked for).

**Question.** OpenMarch is about to build shape tools. The owner's framing is that a shape tool is
an **in-place** interface that positions the selected marchers **at one point in time**, not
motion across time. The list is lines, circles, arcs, curves or splines, boxes and blocks (with
variants and staggers), and more later. The owner said: "Tools like Pyware often have a little
popup window next to the shape that you can drag around, some tools keep stuff in the inspector.
I'm open to each, we just need a system that is consistent and we can extend on. Pyware feels like
a ton of unrelated tools rather than one cohesive interface." This report looks at how other tools
house, activate and parameterize shape tools.

**Evidence labels.**

- **[V]** verified: read on the cited page during this research.
- **[I]** inferred: follows from verified facts, or from screenshots and product structure, but no
  page says it outright.
- **[K]** general knowledge of a widely used product. It was not re-read for this report, so check
  it before quoting it as fact.

Some sources were not reachable. Adobe's help pages returned HTTP 403 to the fetcher, and the
Drill Pirate listing host didn't resolve. Search snippets for those are marked as such. **No
first-hand Reddit or Facebook-group complaint threads turned up** in searches (the same result as
04). The user-voice material for drill tools below comes from the Box5 (EnVision) forum.

---

## Summary

1. **Every drill tool studied uses the same core loop:** pick a kind of shape, click a few defining
   points on the field, adjust with handles plus a per-tool numeric panel, choose how marchers map
   onto the shape's dots, then commit. They differ in **where the panel lives**, **whether the shape
   persists** after commit, and **whether timing (motion) is tangled into the tool**.
2. **Pyware 3D (classic)** is the "many tools" model the owner dislikes. It has 10 drawing tools and
   8 editing tools, each with **its own Control Panel** and its own Accept button [V]. Every drawing
   tool is also a **transition tool**, needing red and yellow Count Track anchors [V]. Position and
   motion are fused into one gesture.
3. **Pyware 3DX** (the new product, 2025-26 beta) is in effect Pyware's own answer to that
   complaint. All draw tools share **one Tool Inspector** with the same sections (tool-specific
   options, Spacing, Handle Widgets, Assign, Sequencer, Display, Advanced Assignment), and **Draw
   and Assign are two modes of one tool** [V]. It's the closest prior art to the "consistent,
   extendable" system the owner describes.
4. **EnVision (Box5)** is the only drill tool found with **persistent forms**. A form is "a shape
   that can have Performers attached to it." Its dots each hold one performer, and attached
   performers follow when the form is edited [V]. Its forum shows the cost: performers **silently
   detach** when moved directly [V], there's **no visible "this dot is filled" state** [V], and
   **separate lines and curves can't be merged** into one compound form [V].
5. **Spacing vocabulary is settled across drill tools:** a **Positions** count and an **Interval**,
   each lockable, with the unlocked one recomputed when handles move [V, Pyware 3D and 3DX]. Pyware
   adds **mixed intervals** (`5x3,10x2,5x3`), **rise over run**, **alignment** when both are locked,
   **omit overlaps** and a **staggered interval** for blocks ("windowed block instead of a cover
   down block") [V]. Blender's Array modifier and Illustrator's Blend use the same "count vs.
   distance vs. fit" idea [V].
6. **Assignment (who goes to which dot) is a first-class step in every serious tool:** group/draw
   order with a flip arrow, proximity (closest first), and manual click-to-match with swap and shift
   [V, Pyware]. EnVision orders by "Sort by Form", Sort Horizontal or Vertical, Reverse, and similar
   [V].
7. **From general design tools, three patterns stand out:**
   - a **declarative parameter schema that generates the panel UI**, as in Onshape FeatureScript
     preconditions [V] and Figma plugin parameters [V];
   - a **single docked properties panel** rather than floating panels: Figma reverted floating
     panels in UI3 because "they slowed people down" [V];
   - **live, persistent parametric objects** that can be **expanded** (baked) on demand, as in
     Illustrator Repeat and Blend [V, via Adobe help snippets] and Blender modifiers [V].
8. **Recommendation input (section C):** one **Shape** tool with a kind picker, parameters in **one
   docked inspector section** generated from each kind's schema, **on-canvas handles** for geometry,
   and typed fields for anything measured in steps. Treat a small **near-selection HUD** (Fusion- or
   Blender-style) as an optional accelerator that shows the same schema, not as a second home for
   parameters.

---

## A. Drill and formation software

### A.1 Pyware 3D (classic, v7.2 to v11)

Pyware has been the de facto standard since 1982 (vendor claim). Its User Guide is public and per
topic. The 9.0 and 11.0 versions were read.

**Tool inventory [V].** [Tool Palette groups](https://www.pyware.com/guide/3d/11.0/en/topic/tool-palette):
Selection, Regrouping, Drawing, Editing & Maneuvering, Extras. The v11 table of contents
([sketch mode page, nav](https://pyware.com/guide/3d/11.0/en/topic/turn-sketch-mode-on-off)) lists:

- **Drawing:** Line, Circle, Point, Arc, Curve, Free Form, Filled Shape, Block, Bezier Curve,
  Polygon.
- **Editing & Maneuvering:** Push, Fixed Interval Float, Rotate, Morph, Follow the Leader, Resize,
  Track, Stagger.
- **Selection and regrouping:** 13 more tools (Pointer, Box, Lasso, Spotlight, Profile, Selection
  History, Glue, Knife, Snap To, Adjuster, Pace, Facing, Set Reference).

That's about 31 palette tools. v11 added a "Customizable tool palette … Add/Remove tools from the
tool palette" ([Bandshoppe v11 feature list](https://www.bandshoppe.com/img/Pyware3DFeautres.pdf),
search snippet), which is a symptom of the palette being too big.

**Activation and timing [V].** From the [Drawing Tools overview](https://www.pyware.com/guide/3d/9.0/en/topic/drawing-tools):
drawing tools have two uses.

- **First Time:** The red and yellow anchors sit on the same count and nothing is selected, and the
  shape is filled with _new_ performers.
- **Transition:** The red anchor marks the count where the shape is hit, the yellow anchor marks
  the start of the transition, and the performers are selected _before_ choosing the tool.

So the user **selects marchers, then picks a shape tool, then draws**. Every shape tool is
inherently a transition editor. **This is the fusion of position and motion that the owner's "in
place, one point in time" framing rejects.**

**Drawing gestures [V].**

- **Line:** two clicks.
- **Arc:** three clicks: endpoint, endpoint, then a point on the edge, as in the
  [Arc tool](https://www.pyware.com/guide/3d/9.0/en/topic/arc-tool).
- **Block:** set the "P1 to P2" and "P1 to P3" counts, then click P1, P2, P3. That gives a
  parallelogram, so blocks and rhombuses come from the same tool
  ([Block tool](https://www.pyware.com/guide/3d/9.0/en/topic/block-tool)).

Every click becomes an **editing handle** (red square). A **Reposition Handle** at the midpoint has
an inner circle (move), a Rotator arm (rotate) and an outer circle that moves the point of rotation
([Line tool](https://www.pyware.com/guide/3d/9.0/en/topic/line-tool)).

**Parameters: a per-tool Control Panel [V].** "Clicking on the Arc tool will display the Arc Tool
Control Panel." Each tool has its own panel, though many options are shared ("Clone, Alignment,
Symbol, Color, Editing Handles, and Reposition Handles work as they do in the Line tool"). The
guide doesn't say where the panel docks [I: screenshots suggest a panel region in the main window,
not a popup at the cursor]. The owner's memory of "a little popup window next to the shape" may be
the 3DX inspector, which is movable ("inspectors, the tool palette and movable dialogs can be
dragged onto any monitor", [3DX beta notes](https://www.pyware.com/?p=45572) [V]), or another tool.

**Spacing model [V]** (Line tool page; the Arc and Block tools reuse it):

- **Positions:** typing a value locks it, and "the line then grows or shrinks by changing the
  interval."
- **Interval:** typing a value locks it, and the line grows or shrinks by changing the number of
  positions.
- **Padlocks:** "When locked, the value cannot be recalculated by the computer if the size or shape
  of the form is modified."
- **Mixed Intervals:** `value x count` runs, for example `5x3,10x2,5x3`, entered before Accept.
- **Rise over Run:** spacing as a vertical and horizontal step pair (diagonals on the grid).
- **Alignment** (Left, Center, Right): needs _both_ locks. It places a fixed-interval set of dots
  inside a longer drawn line.
- **Omit Overlaps:** skips dots on top of existing performers, checking endpoints only or every
  position.
- **Restrict Horizontal/Vertical:** 0, 45 and 90 degree constraint.
- **Clone:** N copies, Linear or Radial, with a movable Cloning Handle.
- **Arc "Data Points":** "3 data points will create a wedge." The arc is a polyline approximation
  whose point count is a parameter.

**Assignment, via Matching Lines [V]** ([Matching Lines](https://www.pyware.com/guide/3d/9.0/en/topic/matching-lines)):
lines are drawn from each selected performer to its new dot. The options are:

- **Flip:** reverse the order.
- **Predict Next:** click one match and 3D infers the rest.
- **Clear:** match manually by clicking performers in dot order. Arrow keys move the "red bubble".
- **Proximity Match:** closest first.
- **Swap:** drag one performer onto another to exchange their dots.
- **Shift:** Shift-drag to insert one performer and slide the others along.

**Commit [V].** "The Accept button will commit the line to the drill page." Switching tools,
moving an anchor, right-clicking the field or pressing Esc **cancels** the shape.

**Persistence [I].** No page describes re-opening an accepted line as a line. Later edits go
through the editing tools, which rebuild handles from the performers' current dots:

- **Morph** starts with "one handle per selected performer", with a Fewer button to halve them
  ([Morph](https://www.pyware.com/guide/3d/11.0/en/topic/morph-tool)) [V].
- **Fixed Interval Float** turns the current form into a handle outline with a "Lock Intervals"
  option ([FIF](https://www.pyware.com/guide/3d/11.0/en/topic/fixed-interval-float-tool)) [V].

So the shape **bakes to points on Accept**, and re-editing a shape means re-deriving one.

**Why it feels like "unrelated tools" [I, from the above].**

1. Each tool has its own panel, so the same concept (interval, clone, symbol) appears in many
   places, with tool-specific gaps. For example, Block has P1-P2 and P1-P3 counts but the 3D page
   documents no interval for them.
2. Shape kind and operation are both separate tools. Line, Arc, Morph and Fixed Interval Float can
   all produce "a curve of evenly spaced dots", but each through a different tool.
3. Timing anchors must be set before any shape tool is enabled, so creating a shape is a modal
   ritual.
4. Once accepted, the shape is gone, so the user re-creates instead of editing.

### A.2 Pyware 3DX (new product, beta 2025-26)

3DX runs on Windows, macOS, Android and iOS from one license
([3DX product page](https://dev.pyware.com/3dx/), search snippet). Its guide is at
[pyware.com/guide/3dx](https://www.pyware.com/guide/3dx/). Beta notes mention a **ribbon** that
"now appears on every View", "further changes to the inspector", and an "option to expand all
inspector panels" ([3DX beta](https://www.pyware.com/?p=45572), search snippets plus page) [V].

**One Tool Inspector shared by all draw tools [V].** The
[Line Drawing Tool](https://www.pyware.com/guide/3dx/1/en/topic/basic-draw-tool),
[Line Tool](https://www.pyware.com/guide/3dx/1/en/topic/line-tool) and
[Block Tool](https://www.pyware.com/guide/3dx/1/en/topic/block-tool) pages use the same section
list:

| Section             | Contents (line; block differences noted)                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tool specific       | Points (control-point count, lockbox for endpoints), Delete Half, Smooth, **Curved Shape** (turns a line into a curve), Continuous Draw, **Add a Shape** (continue the form with another draw kind: Line, Curve, Pencil, Arc, Bezier, Point)                                                                                                                 |
| Spacing             | Positions plus lock, Interval plus lock, **Interval Option** (Free, Horizontal, Vertical, Sketch Points, Mixed, Random), Enclosed/Filled, Omit Overlaps. _Block:_ Side A and Side B positions and intervals, each lockable, Aligned (L/C/R), **Staggered Interval** ("every other row … staggered, creating a windowed block instead of a cover down block") |
| Handle Widgets      | Resizer, Stretch, Slant, Skew, On Overall Form, Mirror (flip H/V across center or a point), **Cloner** (count, decrement per clone, Linear, Radial, Concentric), Drag on Axis, Snap to Angle, Handle Snap (rise/run)                                                                                                                                         |
| Assign (mode)       | Target: existing performers, **new performers** (color, symbol), or **Sketch**. Match: **Group Order** (with flip arrow), **Proximity**, **Customize**. Edit: Clear, arrows, NO symbol, Swaps, Shifts                                                                                                                                                        |
| Sequencer           | Step off, drop off every N, stride, pick new leader, group by shape or place, preview                                                                                                                                                                                                                                                                        |
| Display             | Dim Other Positions, Measures                                                                                                                                                                                                                                                                                                                                |
| Advanced Assignment | Filter new places or existing selection, Commit/Uncommit, Accept Uncommitted ("Unmatched performers in the new form will be deleted")                                                                                                                                                                                                                        |

Also verified: there's a **Mode toggle** between Draw and Assign, and the workflow can run either
way, "select performers and draw your form, or draw the form first and match it to existing
performers" (3DX marketing, search snippet).

**What 3DX changes relative to classic [I].**

- Parameters now live in **one consistently structured inspector**. A new draw kind only adds a
  "tool specific" block, while Spacing, Handle Widgets, Assign and Display are reused.
- **Add a Shape** lets one form be a chain of different kinds. This is the compound form that
  EnVision users asked for (A.3).
- **Draw then Assign** as two explicit modes separates geometry from mapping.
- Pyware still fuses in timing: the Sequencer lives inside the same inspector.

**Gaps.** The guide doesn't say where the inspector docks by default. The beta notes say inspectors
can be dragged to any monitor, so they float or are movable [V]. Whether a committed form stays
editable as a form is **not documented** [I: probably not, as in classic].

### A.3 EnVision (Box5 Software)

A 3D drill tool for Mac and Windows. Box5's stated design rationale: "The other programs have very
small buttons and need a lot of clicks. We tried to streamline the whole process", and undo was "not
implemented in most drill writing programs"
([Halftime Magazine](https://halftimemag.com/gear-up/envision-visual-performance-design.html)) [V].

**Model: persistent forms with dots [V]** ([EnVision Help Center](https://box5software.com/envision-help-center)):

- Form tools: **Line, Multi-Curve (Spline), Circle, Arc, Block**, from both the toolbar and a
  Forms menu. The menu also has **Save Forms / Load Forms**, a form library.
- "Every shape has what are known as Dots, these dots can each hold 1 performer." "Once attached to
  a dot, the performer will move where the dot moves if the form is edited."
- "You can only affect forms when you are in Form Mode." There's a selection-mode toggle between
  Form and Performer, with Ctrl+Tab to switch (forum
  [t=13907](https://forum.box5software.com/viewtopic.php?t=13907)).
- "The position and number of dots can be changed from the **form control panel**", shown on the
  left whenever a form is selected. Tools open a **Properties panel** on the left. There's also an
  **Information Panel** above the timeline that shows step sizes.
- **Assignment by drag and drop:** dragging a group of performers over a form highlights it blue,
  and releasing attaches them. Ordering is a separate **Selection Ordering Tool** with Sort by
  Form, Sort Horizontal, Sort Vertical, Reverse, A-B Straight, A-B Loop and Slide Order.
- Snapping to 1, 1/2 or 1/4 pace (1 pace = 22.5 in).

**User pain from the Box5 Suggestions forum [V]**
([index](https://forum.box5software.com/viewforum.php?f=3)):

- **Detach is silent.** "Performers … fell off their forms on numerous occasions." The CEO
  explains that performers "generally only detach from forms when their position changes from
  something other than the form moving". That includes direct moves, expand/contract, and rotating
  marbles in Performer mode. A warning was rated low priority, but the behavior "is not obvious"
  ([t=14045](https://forum.box5software.com/viewtopic.php?t=14045)).
- **No filled or empty dot state.** "There is no obvious visual indication of which form dots are
  populated", so it's "easy to drag the performers to the wrong dot". This was added to the backlog
  ([t=14044](https://forum.box5software.com/viewtopic.php?t=14044)).
- **No compound forms.** A user asked to "select all lines, curves which I've drawn and merge them
  to 1 form". The CEO replied: "not currently possible". Groups of forms can move and rotate
  together, but **not resize** together ([t=14012](https://forum.box5software.com/viewtopic.php?t=14012)).
- Other requests: lock resize "marbles" to horizontal or vertical only
  ([t=14054](https://forum.box5software.com/viewtopic.php?t=14054)), snap selected performers to
  the grid ([t=14048](https://forum.box5software.com/viewtopic.php?t=14048)), and "A real live
  manual" ([t=14031](https://forum.box5software.com/viewtopic.php?t=14031)).

**Lesson [I].** Persistent shapes help editing, but they need three things:

1. A visible link state, both on the shape and on the marcher.
2. An explicit, visible event when a marcher leaves a shape. OpenMarch's current "per-marcher edit
   converts to points" (Q-14, see 03) is the same silent detach.
3. A way to compose kinds into one form.

### A.4 Ultimate Drill Book (UDB), Drill Studio, DrillFlo, Drill Pirate, others

- **UDB** is a **performer-facing** app for learning drill. Pyware files export into it, and it
  isn't a drill-writing tool (search results; Box5 forum thread "Ultimate Drill Book"
  [t=1595](https://forum.box5software.com/viewtopic.php?t=1595) exists but wasn't read). No shape
  tooling is relevant here.
- **Drill Studio** is a Japanese formation design app (one-time $440 or $8-20 per month,
  [AlternativeTo](https://alternativeto.net/software/drill-studios/about/)). No shape-tool
  documentation was found.
- **DrillFlo** is a browser-based collaborative drill tool
  ([AlternativeTo](https://alternativeto.net/software/drill-flo/about/)). No tool documentation was
  found.
- **Drill Pirate** (Windows, MuseHub listing) claims "lines, arcs, curves, geometric shapes,
  imported SVGs, Follow-the-Leader routes, formation morphs, motion ribbons, and CAD-inspired
  editing tools" (search snippet only; the host didn't resolve, so this is **unverified**).
- **Field Artist** and **DrillQuest** were mentioned only in passing in SEO-quality pages. No
  documentation was found.

### A.5 Dance and formation apps

- **ArrangeUs** (iPad) v2.15 added "basic presets such as circles, semicircles and lines in
  seconds" plus **sliders to stretch and rotate positions**. v2.15.2 "improved presets positions
  matching", and v2.13.4 added a "circular swap" for a group of dancers
  ([App Store MX](https://apps.apple.com/mx/app/arrangeus/id1502182540)) [V].
  - **Pattern:** shapes are _presets_ applied to the selected dancers, adjusted with sliders, with
    automatic matching. They're not drawn. **This is the closest prior art to "select marchers,
    then apply a shape in place."**
- **StageKeep** is a mobile formation manager. It has drag-and-drop formation placement (v1.5) and
  an announced "Auto Algorithm" for spacing. Shape tools aren't confirmed
  ([Dance Current](https://thedancecurrent.com/article/toronto-born-choreography-app-levels-up/),
  search snippet).
- **Formation App** (iOS) has shapes (rectangle, circle, triangle) as **annotations** ("production
  notes"), not as marcher layouts ([App Store](https://apps.apple.com/app/id6773152511)) [V].
  It isn't relevant beyond that.
- **Academic** ([SciTePress 2012](https://www.scitepress.org/Papers/2012/38478/38478.pdf), search
  snippet): a dance simulation with three patterns, straight line, circle and curve. "The user
  draws an indication line and the system places the dancers." This is the draw-then-fill pattern.

### A.6 Cross-tool comparison

|                 | Pyware 3D                                             | Pyware 3DX                                           | EnVision                                  | ArrangeUs              |
| --------------- | ----------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------- | ---------------------- |
| Activation      | Separate tool per kind (10 draw + 8 edit)             | Separate draw tools, **one shared inspector**        | Toolbar or menu per kind, Form mode       | Preset picker          |
| Order           | Select, then draw (or draw new)                       | Either order                                         | Draw form, then drag performers on        | Select, then preset    |
| Geometry input  | 2-3 clicks, then handles                              | Clicks or continuous draw, then handles plus widgets | Draw, then "marbles"                      | None (preset), sliders |
| Params home     | Per-tool Control Panel                                | Tool Inspector (movable)                             | Left form control panel                   | Sliders                |
| Spacing         | Positions and Interval locks, mixed, rise/run, align  | Same plus interval options and stagger               | Dot count, pace snap                      | Stretch slider         |
| Assignment      | Matching lines: flip, predict, proximity, swap, shift | Assign mode: group order, proximity, customize       | Drag-drop, ordering tool                  | Automatic matching     |
| After commit    | Bakes to points [I]                                   | Undocumented                                         | **Persistent form**, dots hold performers | Bakes [I]              |
| Timing coupling | **Required** (anchors)                                | Sequencer in inspector                               | Separate                                  | Separate               |

---

## B. Cohesive tool-system patterns from general design software

### B.1 Figma

- **One docked properties panel on the right**, grouped by the current selection [V, third-party
  breakdown, Figma blog]. In UI3, Figma tried **floating panels** and reverted: users said they
  cramped the canvas, "especially on smaller screens", and "The nail in the coffin was learning that
  they slowed people down." Panels are now fixed but resizable
  ([Figma blog, UI3](https://www.figma.com/blog/our-approach-to-designing-ui3/)) [V].
  - **Directly relevant** to "popup next to the shape": laptop drill writers have the same small
    screens.
- **Extensibility through plugin parameters.** A plugin declares parameters in its manifest, and
  Figma renders the input UI in quick actions (Cmd+/): "in many cases you don't need to build a
  custom UI." It has typed suggestions and Tab between parameters
  ([plugin parameters](https://developers.figma.com/docs/plugins/plugin-parameters)) [V].
- **Relaunch buttons**: `setRelaunchData()` puts a "re-run with this plugin" button in the
  **Properties panel** of the node the plugin produced
  ([setRelaunchData](https://developers.figma.com/docs/plugins/api/properties/nodes-setrelaunchdata))
  [V]. A cheap form of "this object remembers which tool made it."
- **On-canvas:** bounding box handles, plus special handles for corner radius and arc
  (ellipse start, sweep and ratio are on-canvas handles on an ellipse) [K].

### B.2 Adobe Illustrator

Adobe's help pages returned 403, so these come from search-result snippets of helpx pages.

- **Live Shapes** keep their parameters (corner radius, polygon sides, pie angles) and expose them
  as on-canvas widgets plus the Properties and Transform panels. They stay live until expanded [K].
- **Repeat (Radial, Grid, Mirror)** is a persistent parametric object:
  - Radial has "Number of instances … Default value is 8".
  - Grid has on-canvas handles: "Drag the handle on the bottom to add more rows … on the right to
    add more columns", plus spacing sliders on the art.
  - Mirror has a draggable symmetry axis.
  - "To edit shapes independently, use the Expand option … that you cannot edit via the radial
    repeat option" ([Adobe help, iPad repeat objects](https://helpx.adobe.com/ca/illustrator/ipad/work-with-colors-and-patterns/repeat-patterns.html),
    snippet).
  - **Pattern: live object, handles on canvas, numbers in the panel, explicit Expand to bake.**
- **Blend** is the closest analogue to "N marchers along a path". Its spacing options are
  **Specified Steps** (count) and **Specified Distance** (interval), and **Replace Spine** swaps the
  path the steps follow while keeping the blend live
  ([Adobe help, blending objects](https://helpx.adobe.com/illustrator/using/blending-objects.html),
  snippet). These map one-to-one onto Pyware's Positions/Interval and onto "change the kind of
  shape without re-picking marchers".
- **Contextual Task Bar** (v27.9 and later) is a small floating bar near the selection with the
  next likely actions. It can be moved, **pinned**, reset or hidden from its "More" menu
  ([Adobe community](https://community.adobe.com/t5/illustrator-discussions/contextual-task-bar-in-illustrator-quick-actions-when-you-need-them/td-p/14081562),
  snippet) [V]. There are user complaints ("I hate this contextual task bar … I want my properties
  back across the top", forum title) and reports of it sticking on the wrong screen.
  - **Lesson:** a near-selection bar is fine for _verbs_, but users push back when it replaces the
    panel for _parameters_.
- **Transform Each**: one dialog applies move, scale and rotate to each selected object about its
  own origin [K]. It's relevant to "rotate each rank in a block."

### B.3 Blender

- **Adjust Last Operation** (redo panel): after an operator runs, a HUD panel appears at the bottom
  left. F9 opens it as a popup. "You can tweak the parameters of an operator after running it"
  ([manual, Undo & Redo](https://docs.blender.org/manual/en/4.0/interface/undo_redo.html), via
  search) [V]. Contents depend on the last operator.
  - **Strengths:** every operator gets a parameter UI for free from its property definitions [K],
    the parameters are always in the same place, and there's live re-execution.
  - **Limits [K]:** only the _last_ operation can be adjusted, and any other edit closes it.
- **Modifiers stack**: non-destructive, parametric, reorderable, and applied (baked) on demand [K].
  The **Array modifier** has the same spacing model as drill tools: Fit Type is **Fixed Count**,
  **Fit Length** or **Fit Curve**, with Relative, Constant or Object offset
  ([manual, Array](https://docs.blender.org/manual/id/4.2/modeling/modifiers/generate/array.html))
  [V]. Fit Curve, meaning "as many copies as fit along this curve at this spacing", is exactly
  "interval locked, positions computed."
- **Gizmos** are on-canvas handles for operator parameters (spin angle, bisect plane) [K].
- **Discoverability:** F3 operator search (a command palette), pie menus and the Shift+A add menu
  [K].

### B.4 Parametric CAD

- **Onshape feature dialogs:** one dialog per feature in a consistent location, with live preview
  in the graphics area. There's a **Final** button to view the end result while editing an earlier
  feature, and a **Preview slider** for before/after opacity
  ([Onshape help, Feature Basics](https://cad.onshape.com/help/Content/feature-basics.htm), via
  search) [V]. Features are listed in a persistent **Features list** and can be re-opened at any
  time [K].
- **FeatureScript:** "Onshape creates the feature dialog by doing a static analysis … of the feature
  declaration, primarily of the precondition"
  ([FsDoc UI spec](https://cad.onshape.com/FsDoc/uispec.html), via search) [V].
  - Parameter types (boolean as a checkbox, enum, length or angle with bounds, count) and
    **conditional parameters** (if/else in the precondition) produce the UI.
  - Third-party features look exactly like built-in ones.
  - **This is the strongest prior art for "add a new shape kind without adding UI clutter."**
- **Fusion 360 sketch:** while drawing, on-canvas **dimension input boxes** appear next to the
  cursor. Tab cycles fields and Enter locks a value. Dimensions can be added or edited afterward
  ([Autodesk forum](https://forums.autodesk.com/t5/fusion-support-forum/tab-key-won-t-lock-dimension/m-p/10356713),
  [Autodesk blog](https://www.autodesk.com/products/fusion-360/blog/dimensions-in-sketches-fusion/),
  via search) [V].
  - **Complaints:** Tab sometimes doesn't lock a value unless it was typed, and autocomplete steals
    focus ("Dimension input is very buggy and annoying" thread title).
  - **Lesson:** cursor-side numeric entry is fast but focus handling must be bulletproof.
- **Sketch constraints** (horizontal, equal, coincident) persist and re-solve [K]. This is the
  heavyweight version of Pyware's padlocks.

### B.5 Keynote, PowerPoint, Procreate

- **Arrange, Align and Distribute** in Keynote and PowerPoint: one menu or panel section, applied
  to the selection, no persistent state [K]. OpenMarch already has align and distribute in timeline
  mode (03, §0).
- **Procreate QuickShape:** draw a rough stroke and hold, and it snaps to a line, arc, polyline,
  ellipse, triangle or quadrilateral. A second finger regularizes (oval to circle) and dragging
  rotates in 15 degree steps. After release, an **Edit Shape** button offers alternates (Ellipse vs.
  Circle) and nodes for refinement
  ([Procreate Handbook](https://help.procreate.com/procreate/handbook/guides/quickshape), via
  search) [V].
  - **Pattern:** a _single_ gesture with the kind **inferred and then correctable**. That's
    interesting for trackpads and pens, but too imprecise as the only entry for field coordinates.

### B.6 Patterns distilled

| Need                     | Best prior art                                                                          | Pattern                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| One place for parameters | Figma properties panel, Onshape feature dialog, Pyware 3DX inspector                    | Docked, selection-driven panel; floating was tried and reverted (Figma)                       |
| Live preview             | Onshape (preview plus Final), Blender redo, Illustrator Repeat                          | Every parameter change re-renders the result, uncommitted, before commit                      |
| Extensibility            | Onshape FeatureScript, Figma plugin parameters, Blender operator properties             | **Declarative parameter schema produces generated UI**; a new kind adds a schema, not a panel |
| Persist vs. bake         | Illustrator Repeat/Blend (Expand), Blender modifiers (Apply), EnVision forms            | Live by default, explicit bake, visible link state                                            |
| Discoverability          | Blender F3 and Shift+A, Figma quick actions, Illustrator task bar                       | Command palette entries per kind plus one tool with a kind picker                             |
| Spacing                  | Pyware Positions/Interval locks, Blender Array Fit, Illustrator Blend steps or distance | Count _or_ interval, lock one and derive the other                                            |
| Typed precision          | Fusion cursor-side dimension boxes, Blender redo fields                                 | Numeric fields reachable without leaving the keyboard                                         |

---

## C. Candidate interaction architectures for OpenMarch

Drill-specific constraints that shape the choice:

- **Precision in field terms.** Steps (8 to 5), yard lines, hashes and intervals like "2 steps" or
  "4-to-5" must be typeable, and handles should snap to step or half-step.
- **Large selections (100-300 marchers).** Canvas handles must be per _shape_, not per marcher.
  Assignment should default to an optimal match: OpenMarch already has Hungarian matching (about
  30 ms at 500, per 03). Matching lines for 300 marchers are visual noise unless they're optional.
- **Laptops and trackpads.** Screen space is scarce (Figma's floating panel lesson), there's no
  middle mouse, and right-drag is awkward. Keyboard entry matters.
- **In place, one time.** No timing anchors in the shape UI, unlike Pyware. Motion stays in the
  timeline.
- **The owner's existing rules** (04): one edit per gesture, Esc cancels, nothing moves that you
  didn't touch, plain words, tooltips with keycaps.

### C.1 "One Shape tool + kind picker + docked inspector section" (3DX-style, unified)

Select marchers, then press the Shape tool (one key, for example `S`) and pick a kind from a
segmented picker or popover (Line, Arc, Circle, Curve, Box, Block, ...). The last-used kind is
remembered.

- A **preview** fits the shape through the current marchers using `newShapeThrough`, which already
  exists.
- The inspector shows **one "Shape" section** with these parts:
  - a header with the kind picker, so changing kind keeps the marchers, like Illustrator's Replace
    Spine;
  - **kind parameters** generated from the kind's schema;
  - **shared Spacing** (count or interval, lock, align, stagger where it applies);
  - **shared Order** (optimal, along selection order, flip);
  - Apply and Cancel.
- Canvas handles edit geometry. Enter applies and Esc cancels.

- **Pros:** one place, so it's consistent. A new kind adds a schema and handle definitions, not new
  chrome. It works with 300 marchers, since only shape handles appear. It's laptop friendly. It
  matches the existing inspector-based shape editor (P8.2).
- **Cons:** the eye moves between the field and the inspector. The kind picker adds a click unless
  it has per-kind shortcuts. Discoverability depends on the picker being visible.
- **Mitigations:** per-kind command palette entries (for example "Shape: Arc") that open the same
  tool. Keyboard shortcuts per kind can come later.

### C.2 "Near-selection HUD", the owner's Pyware-like popup, but schema-driven

Same as C.1, but the parameter UI is a small **floating card anchored next to the shape's bounding
box**. It's draggable and can be pinned, like Illustrator's task bar, and collapses to a chip.

- **Pros:** the eyes stay on the field, it's fast for drag-then-type, and it feels direct.
- **Cons:**
  - It occludes marchers in dense forms. It has to reposition as the shape moves.
  - It has a small-screen problem: Figma reverted floating panels because "they slowed people
    down", and Illustrator users complain about the task bar.
  - Two homes for parameters if the inspector also shows them, which is the inconsistency the owner
    wants to avoid.
- **Variant that avoids the cons:** the HUD shows only the **2-3 primary fields** of the kind's
  schema (for example count, interval, radius), marked `primary` in the schema. The full set stays
  in the inspector. Both are generated from the same schema, so they can't drift.

### C.3 "Blender-style Adjust Last Shape" (apply first, tweak after)

Picking a kind applies it at once with sensible defaults fitted to the selection. A redo panel
(bottom left of the canvas, or F9) shows its parameters. Each change re-runs the operation on the
pre-shape positions, and any other edit closes the panel.

- **Pros:** the fastest path for the common case (select, then "make a circle" from the palette,
  done). It suits a command-palette-first workflow, the parameter UI is free from the schema, and
  each tweak is one undo step.
- **Cons:** the shape is ephemeral. Once you touch anything else it's baked, which is Pyware's
  "re-create instead of edit" problem. It's hard to combine with canvas handles. It's weak for
  composite shapes. It also conflicts with persistent, re-editable shapes if 03 picks them.

### C.4 "Handles first, panel second" (Illustrator Live Shape / Repeat style, persistent)

A shape is a **persistent object** linked to its marchers at that time. Most editing is direct
manipulation:

- endpoint and rim handles;
- a **count handle** (drag along the shape to add or remove dots, like Illustrator grid rows);
- a **spacing handle** (drag the gap between two dots and every gap follows);
- a **stagger toggle** on a block corner.

The inspector mirrors every handle as a typed field. **Expand** (bake) detaches the shape on
purpose, and a per-marcher edit shows an explicit "left shape" state, unlike EnVision's silent
detach.

- **Pros:** the most direct option, the best trackpad story, and it re-edits later (owner pain:
  re-creating). The link state is visible.
- **Cons:** handle design per kind is real work, and handles collide on small or dense shapes.
  Persistence needs the data model in 03 and rules for detach. The interval handle is hard to
  make precise without typing.

### C.5 Comparison for drill writers

| Criterion                                | C.1 Inspector       | C.2 HUD                                    | C.3 Adjust-last | C.4 Handles first                  |
| ---------------------------------------- | ------------------- | ------------------------------------------ | --------------- | ---------------------------------- |
| Speed for a common shape                 | Medium              | High                                       | **Highest**     | High                               |
| Field-coordinate precision (typed steps) | **High**            | Medium (primary fields only)               | High            | Medium (needs inspector)           |
| 100-300 marchers                         | Good                | Occlusion risk                             | Good            | Good if handles are per shape      |
| Laptop and trackpad                      | **Good**            | Cramped                                    | Good            | Good, needs snapping               |
| Consistency (one home for parameters)    | **Best**            | Risky unless schema-shared                 | Good            | Good if the inspector mirrors      |
| Extensibility (new kind = schema)        | **Best**            | Good                                       | **Best**        | Handles cost per kind              |
| Re-edit later                            | Only if persistent  | Only if persistent                         | **Poor**        | **Best**                           |
| Closest prior art                        | Pyware 3DX, Onshape | Pyware classic popup, Illustrator task bar | Blender F9      | Illustrator Repeat, EnVision forms |

### C.6 Suggested composition (input for the decision, not a decision)

These aren't mutually exclusive. The prior art points to **C.1 as the backbone, C.4's handles as
the primary geometry input, and C.2's HUD as an optional accelerator** generated from the same
schema:

1. **One Shape tool, many kinds.** There's no palette button per kind. Command palette entries
   ("Shape: Circle") and a kind picker both open it. Changing kind keeps the selection and the
   assignment.
2. **A declarative kind schema**, in the FeatureScript and Figma-parameters style. Each kind
   declares:
   - its defining points (click order, handle roles);
   - its typed parameters (with units in steps, bounds and conditional visibility);
   - which parameters are `primary` (for the HUD);
   - how it samples N dots.

   Spacing (count or interval with a lock, align, omit overlaps, stagger) and Order (optimal,
   along, flip) are **shared sections**, not per kind. That avoids Pyware's duplicated per-tool
   panels.

3. **Live preview, explicit Apply.** This follows the Onshape and Pyware Accept pattern and the
   owner's "one edit per gesture, Esc cancels" rule.
4. **Assignment defaults to optimal** (Hungarian), with Flip and "follow selection order" as
   one-click alternatives. Manual matching (Pyware's swap and shift) is an advanced follow-up. It
   isn't needed for the first release.
5. **Persistence and detach** are deferred to 03. If shapes persist, show the link state on
   marchers and shapes and make detach visible, per the EnVision forum.

**Open questions for the owner.**

- Q1: Should a shape stay editable after Apply (C.4, EnVision) or bake to points (Pyware, C.3)?
- Q2: Is a near-shape HUD wanted at all, or should it be the inspector only to start?
- Q3: Should a single form allow mixed kinds (3DX "Add a Shape")?
- Q4: Should Pyware's mixed-interval syntax (`5x3,10x2`) or rise-over-run spacing be supported, or
  is plain count or interval enough at first?

---

## Sources

Drill and formation tools:

- Pyware 3D guide:
  - [Drawing tools](https://www.pyware.com/guide/3d/9.0/en/topic/drawing-tools)
  - [Line](https://www.pyware.com/guide/3d/9.0/en/topic/line-tool)
  - [Arc](https://www.pyware.com/guide/3d/9.0/en/topic/arc-tool)
  - [Block](https://www.pyware.com/guide/3d/9.0/en/topic/block-tool)
  - [Matching Lines](https://www.pyware.com/guide/3d/9.0/en/topic/matching-lines)
  - [Tool Palette](https://www.pyware.com/guide/3d/11.0/en/topic/tool-palette)
  - [Morph](https://www.pyware.com/guide/3d/11.0/en/topic/morph-tool)
  - [Stagger](https://www.pyware.com/guide/3d/11.0/en/topic/stagger-tool)
  - [Fixed Interval Float](https://www.pyware.com/guide/3d/11.0/en/topic/fixed-interval-float-tool)
  - [v11 table of contents (via sketch mode page)](https://pyware.com/guide/3d/11.0/en/topic/turn-sketch-mode-on-off)
- Pyware 3DX guide:
  - [Line Drawing Tool inspector](https://www.pyware.com/guide/3dx/1/en/topic/basic-draw-tool)
  - [Line](https://www.pyware.com/guide/3dx/1/en/topic/line-tool)
  - [Block](https://www.pyware.com/guide/3dx/1/en/topic/block-tool)
  - [3DX beta notes](https://www.pyware.com/?p=45572)
- [Bandshoppe Pyware v11 features (PDF)](https://www.bandshoppe.com/img/Pyware3DFeautres.pdf)
- EnVision:
  - [Help Center](https://box5software.com/envision-help-center)
  - [Halftime Magazine](https://halftimemag.com/gear-up/envision-visual-performance-design.html)
  - Box5 forum threads [13907](https://forum.box5software.com/viewtopic.php?t=13907),
    [14012](https://forum.box5software.com/viewtopic.php?t=14012),
    [14044](https://forum.box5software.com/viewtopic.php?t=14044),
    [14045](https://forum.box5software.com/viewtopic.php?t=14045) and the
    [Suggestions index](https://forum.box5software.com/viewforum.php?f=3)
- Formation apps:
  - [ArrangeUs App Store](https://apps.apple.com/mx/app/arrangeus/id1502182540)
  - [Formation App](https://apps.apple.com/app/id6773152511)
  - [Drill Studio on AlternativeTo](https://alternativeto.net/software/drill-studios/about/)
  - [DrillFlo on AlternativeTo](https://alternativeto.net/software/drill-flo/about/)
  - [SciTePress dance simulation](https://www.scitepress.org/Papers/2012/38478/38478.pdf)

General design tools:

- Figma:
  - [UI3 approach (floating panels reverted)](https://www.figma.com/blog/our-approach-to-designing-ui3/)
  - [Plugin parameters](https://developers.figma.com/docs/plugins/plugin-parameters)
  - [setRelaunchData](https://developers.figma.com/docs/plugins/api/properties/nodes-setrelaunchdata)
- Adobe (snippets only, the pages returned 403):
  - [Blending objects](https://helpx.adobe.com/illustrator/using/blending-objects.html)
  - [Repeat objects (iPad)](https://helpx.adobe.com/ca/illustrator/ipad/work-with-colors-and-patterns/repeat-patterns.html)
  - [Contextual task bar thread](https://community.adobe.com/t5/illustrator-discussions/contextual-task-bar-in-illustrator-quick-actions-when-you-need-them/td-p/14081562)
- Blender:
  - [Undo & Redo / Adjust Last Operation](https://docs.blender.org/manual/en/4.0/interface/undo_redo.html)
  - [Array modifier](https://docs.blender.org/manual/id/4.2/modeling/modifiers/generate/array.html)
- Onshape:
  - [Feature basics](https://cad.onshape.com/help/Content/feature-basics.htm)
  - [FeatureScript UI spec](https://cad.onshape.com/FsDoc/uispec.html)
- Fusion 360:
  - [Tab-lock forum thread](https://forums.autodesk.com/t5/fusion-support-forum/tab-key-won-t-lock-dimension/m-p/10356713)
  - [Sketch dimensions blog](https://www.autodesk.com/products/fusion-360/blog/dimensions-in-sketches-fusion/)
- [Procreate QuickShape](https://help.procreate.com/procreate/handbook/guides/quickshape)
