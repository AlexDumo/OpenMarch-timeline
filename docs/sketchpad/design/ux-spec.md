# Sketchpad: UX spec

Status: draft for owner review (2026-10-18). Mockups: [mockups.html](mockups.html) and the PNGs next to it.

Tags used below: **[MVP]** ships in the first version. **[Later]** is designed for but not built first. **[Q]** points to an open question at the end.

## 1. What it is

The Sketchpad is a piece of paper next to the drill. A designer sketches forms freely on a football field, with no marchers, counts or music. It should feel like Excalidraw or FigJam: one click to start, fast tools, single-letter shortcuts, nothing to set up first, and no wrong way to use it.

What makes it better than Excalidraw for drill design is that the paper knows the field. It can snap to yard lines, hashes and steps, measure in 8-to-5 steps, count the dots in a fill, mirror across the 50, and stamp common forms. Every one of those helpers is optional and stays out of the way. The default is free drawing.

Principles:

1. **Paper first.** A blank sketch opens ready to draw, with the pen already chosen. No dialog is required for the common path.
2. **Never block.** No validation, no required fields, no "you must select marchers first". The sketch can be messy.
3. **Drill helpers are opt-in and visible.** Snapping and readouts can be switched on and off from the bottom bar, and a modifier key bypasses snapping for one action.
4. **Separate from the show.** A sketch has its own undo history and never changes marchers, pages or counts. Using it as an overlay is a view setting only.
5. **Native look, playful content.** The chrome uses OpenMarch tokens (`bg-1`, `stroke`, `accent`, DM Sans, `rounded-6`, the floating `Panel` style from the 3D View). The content can be hand-drawn ("Sketchy" strokes), handwritten-style text and sticky notes.

## 2. Where it lives

### 2.1 Sketches menu in the left sidebar [MVP]

- A new sidebar button, below Field, with the Phosphor `PencilSimpleLine` icon and the tooltip "Sketches". It opens a `SidebarModal` panel, like Marchers or Music.
- The panel contains:
  - A header with "Sketches", a **New sketch** button (accent) and a close button.
  - A list of sketch cards, newest first. Each card shows a thumbnail of the field and the drawing, the name, "Edited 5 min ago", an **eye** toggle (show on field) and a `⋯` menu.
  - When any sketch is shown on the field, a compact **Overlay** section at the bottom of the panel (see 6).
  - A collapsible **Templates** section listing the user's templates, with "Manage..." [Later].
- Card actions:
  - Click or double-click: open the sketch in the Sketchpad window.
  - Eye: show or hide the sketch as an overlay on the main field.
  - `⋯` menu: Open, Rename, Duplicate, Save as template, Export..., Show on field, Delete.
  - Drag a card onto the field: show it as an overlay [Later].
- The command palette (⌘K) gets "New sketch", "Open sketch...", "Toggle sketch overlay" and "Export sketch..." [MVP]. These are actions in the actions layer, so their shortcuts can be customized.

### 2.2 The Sketchpad window [MVP]

- It opens in its own window, like the 3D View: a separate `BrowserWindow` in Electron and a pop-up bridged over BroadcastChannel in the web build.
- Recommended: one window per sketch. Opening a sketch that is already open focuses its window. [Q2]
- The window title is "<Sketch name> — <Show name>".
- Closing the window saves the sketch. The editor keeps running.
- If the show is closed while Sketchpad windows are open, they save and close with it.

## 3. User flows

### 3.1 Create a blank sketch from the sidebar [MVP]

1. Click **Sketches** in the sidebar, then **New sketch**.
2. The New sketch dialog opens with **Blank** focused. Pressing Enter creates the sketch right away.
3. The sketch is named "Sketch 4" (the next free number). It takes a snapshot of the show's current field layout and theme.
4. The Sketchpad window opens with the pen tool chosen and an empty-state hint (see 9).
5. The new card appears at the top of the list.

Fast path: Alt+click **New sketch** (or "New blank sketch" in ⌘K) skips the dialog. [MVP]

### 3.2 Create from a template [MVP]

1. In the New sketch dialog, pick a template card. The cards are Blank, built-in templates and "My templates".
2. Optionally type a name. If you don't, it is named after the template ("Company front 2").
3. Click **Create sketch**. The template's drawing and field display settings (grid, colors) are copied in. The field **layout** always comes from the show's current field. [Q4]
4. If the template was made on a different field layout (for example, a high school template in a college show), the dialog shows a note: "Made on a High school field. It will be placed on your College field by yard line." Content is anchored to the 50 and the front sideline, so yard-line positions stay correct and positions measured from the hashes may shift.

Built-in templates [MVP]: Blank, Grid paper (4-step grid, no numbers), Hash grid (hash and yard lines only), and Opener sheet (field plus a title block and a sticky note for notes). Form-starter templates such as Block or Company front [Later] become less important once form stamps exist (see 7.5).

### 3.3 Save as template [MVP]

- In the Sketchpad, open the menu and choose **Save as template...**, or use the card's `⋯` menu in the sidebar.
- A small dialog asks for a name, shows a thumbnail, and has a checkbox **Include drawing** (on) and **Include field style** (on).
- Templates are saved to the user's Library so that every show can use them. The web build saves them in the file instead. [Q3]

### 3.4 Open and reopen [MVP]

- Click a card to open it. The sketch reopens with its viewport, selected tool and panel state restored.
- The undo history is kept while the window is open and dropped when it closes. [Q5]
- When the show's field has changed since the sketch was made, a quiet info chip at the top of the window says "Field changed in the show since this sketch. **Use current field**". The chip never auto-migrates. Clicking it re-anchors content by yard line and can be undone (see 8.3).

### 3.5 Rename, duplicate and delete [MVP]

- **Rename:** double-click the name on the card, or double-click the title in the Sketchpad's top-left menu. Edit inline. Enter saves, and Esc cancels.
- **Duplicate:** creates "<name> copy" right below the original, including the field snapshot. It does not open a window.
- **Delete:** no confirmation dialog. The card disappears, and a toast says "Deleted 'Opener idea'" with an **Undo** button for 10 seconds. If the sketch is open, its window closes. Deleted sketches are kept in the file until the show is closed, so Undo is cheap. [Q6]
- Rename, duplicate and delete are not part of the main editor's undo history. Only the toast can undo a delete.

### 3.6 Use a sketch as an overlay on the main field [MVP]

1. Click the eye on a sketch card. The sketch is drawn on the main field, at the right yard lines, at 50 % opacity and below the marchers.
2. The Overlay section appears in the sidebar panel. When the panel is closed, a small floating chip at the bottom left of the field shows "Sketch: Opener idea · 50 % · eye".
3. Adjust it in the Overlay section (see 6).

### 3.7 View a sketch in another window [MVP]

- Opening the sketch is the "view in another window" path. The Sketchpad window can sit on a second monitor next to the editor.
- **Presentation mode** [Later]: View, then Present (or `Alt+R`, like Excalidraw zen/view mode), hides all chrome for showing a form to staff on a projector.
- **Show in the 3D View** [Later]: the overlay can be painted onto the 3D turf.

### 3.8 Export [MVP for PNG, SVG and PDF of one sketch]

1. Open the Sketchpad menu and choose **Export...** (`⌘⇧E`), or choose Export... on the card's `⋯` menu.
2. The Export dialog shows a live preview on the left and options on the right:
   - Format: **PNG**, **SVG** or **PDF**.
   - Area: **Whole field**, **Drawing only** (tight crop with padding) or **Selection** (only when there is a selection).
   - Include: Field (on), Grid (follows the sketch), Yard numbers (on), Background (on), Title block with the sketch name, show name and date (PDF only, on).
   - Look: **As drawn** or **Print** (black on white, fills kept as patterns, stickies kept as outlined boxes).
   - PNG: Scale 1×, 2× (default) or 3×, with the pixel size shown.
   - PDF: Paper Letter, Tabloid or A4, Landscape, and Fit to page.
3. Actions: **Copy to clipboard** (PNG), **Export**, which opens a save dialog with the file name "<show> - <sketch>.pdf".
4. Export all sketches as one PDF, one sketch per page [Later], from the sidebar's `⋯` menu.

## 4. Sketchpad window layout [MVP]

Everything floats over the field, like the 3D View overlay and like Excalidraw. Panels use the shared `Panel` look: `bg-modal`, `backdrop-blur-32`, `border-stroke`, `rounded-6` and `shadow-modal`.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [≡ Opener idea ▾]        [ tool bar (centered) ]          [Field] [Export] │
│ ┌ Properties ┐                                                            │
│ │ (selection │                 FIELD + DRAWING                            │
│ │  or tool)  │                                                            │
│ └────────────┘                                                            │
│ [− 82% + ⤢] [↶ ↷]     [Snap: Steps ▾] [Mirror 50]     4 out S1 35 · 12 bh FH│
└───────────────────────────────────────────────────────────────────────────┘
```

- **Top left: menu and title.** `≡` opens Rename, Duplicate, Save as template..., Export..., Field settings..., Show on main field, Keyboard shortcuts and Close. The sketch name next to it can be renamed by clicking it.
- **Top center: the tool bar** (see 5). The tool lock is on its left end and the form stamps on its right end.
- **Top right:** **Field** (opens the Field settings panel), **Show on field** toggle (eye) and **Export** (accent).
- **Left: the Properties panel.** It appears only when a tool other than Select is active or something is selected. It stays docked under the menu and collapses to a narrow strip in small windows.
- **Bottom left:** zoom out, a zoom % button (click to reset to 100 %, Shift+1 to fit the field), zoom in, then undo and redo.
- **Bottom center: drill helpers.** Snap menu (Off, Steps, Yard lines and hashes, Shapes) and Mirror across the 50 toggle. Measure is in the tool bar.
- **Bottom right: position readout.** It shows the cursor or selection position in drill language, using the show's coordinate settings, for example "4 out S1 35 · 12 behind FH". While dragging, it shows the size ("8 × 4 steps"). It can be hidden.
- **Collaborators** [Later]: avatars next to Export.

Canvas navigation follows Excalidraw: scroll pans, ⌘/Ctrl+scroll or pinch zooms, Space+drag or middle-drag pans, and the H tool pans. The field is not a boundary. You can draw in the stands around it.

## 5. Tools and shortcuts [MVP unless marked]

The single keys and number keys match Excalidraw where that is sensible. All shortcuts are actions in the actions layer, scoped to the Sketchpad window, so they appear in the shortcuts dialog and can be customized.

| Tool          | Key       | Excalidraw                  | Notes                                                                                                                                                                            |
| ------------- | --------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hand (pan)    | H         | H                           | Space held also pans.                                                                                                                                                            |
| Select        | V or 1    | V / 1                       | Click, Shift+click, marquee and lasso (drag on empty space).                                                                                                                     |
| Rectangle     | R or 2    | R / 2                       | Shift for a square. Alt draws from the center.                                                                                                                                   |
| Diamond       | D or 3    | D / 3                       |                                                                                                                                                                                  |
| Ellipse       | O or 4    | O / 4                       | Shift for a circle.                                                                                                                                                              |
| Arrow         | A or 5    | A / 5                       | Click-drag for a straight arrow. Click, click, click for a connected arrow, and Enter or Esc to finish. Sharp, curved or elbow style.                                            |
| Line          | L or 6    | L / 6                       | Same click-to-add-points behavior gives connected lines. Curved style turns the points into a smooth curve. Close the line by clicking the first point, which makes it fillable. |
| Free draw     | P or 7    | P / 7 (X in older versions) | Pressure-smoothed. Pen tablets work.                                                                                                                                             |
| Text          | T or 8    | T / 8                       | Click to type. Double-click the canvas with any tool to add text there.                                                                                                          |
| Image         | 9         | 9                           | Opens a file picker. Paste or drag-drop also adds images.                                                                                                                        |
| Eraser        | E or 0    | E / 0                       | Drag across elements to delete them. Alt+drag restores while erasing.                                                                                                            |
| Sticky note   | S         | (none; FigJam uses S)       | Square note with a pastel color. Type right away.                                                                                                                                |
| Curve (pen)   | C [Later] | (none)                      | Bezier pen for precise arcs. MVP covers curves with curved lines and the arc stamp.                                                                                              |
| Measure       | M         | (none)                      | See 7.4.                                                                                                                                                                         |
| Form stamps   | F         | (none)                      | Opens the stamp tray. See 7.5. [Later; Q8]                                                                                                                                       |
| Laser pointer | K [Later] | K                           | For presenting and collaborating.                                                                                                                                                |
| Tool lock     | Q         | Q                           | Keeps the current tool after drawing.                                                                                                                                            |

Editing:

| Action                                | Shortcut                                                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Undo / Redo                           | ⌘Z / ⌘⇧Z (Ctrl+Y on Windows)                                                                                                                  |
| Copy / Cut / Paste                    | ⌘C / ⌘X / ⌘V. Pastes at the cursor. Copied elements also paste into other sketches, and into Excalidraw as Excalidraw clipboard JSON [Later]. |
| Paste without style                   | ⌘⇧V                                                                                                                                           |
| Copy / paste style                    | ⌘⌥C / ⌘⌥V                                                                                                                                     |
| Duplicate                             | ⌘D, or Alt+drag                                                                                                                               |
| Delete                                | Delete / Backspace                                                                                                                            |
| Select all                            | ⌘A                                                                                                                                            |
| Group / Ungroup                       | ⌘G / ⌘⇧G                                                                                                                                      |
| Bring forward / back, to front / back | ⌘] / ⌘[, ⌘⇧] / ⌘⇧[                                                                                                                            |
| Flip horizontal / vertical            | Shift+H / Shift+V                                                                                                                             |
| Mirror across the 50 (copy)           | ⌘⇧M (drill helper)                                                                                                                            |
| Lock element                          | ⌘⇧L                                                                                                                                           |
| Nudge                                 | Arrow keys: 1 step with step snapping on, otherwise 1 px. Shift+arrow: 1 yard line (8 steps) or 10 px.                                        |
| Bypass snapping while dragging        | Hold ⌘/Ctrl (Figma convention) [Q9]                                                                                                           |
| Zoom in / out / 100 %                 | ⌘= / ⌘− / ⌘0                                                                                                                                  |
| Fit field / fit selection             | Shift+1 / Shift+2                                                                                                                             |
| Toggle grid                           | ⌘' (Excalidraw)                                                                                                                               |
| Toggle snapping                       | ⌘⇧'                                                                                                                                           |
| Export                                | ⌘⇧E                                                                                                                                           |
| Shortcuts help                        | ?                                                                                                                                             |
| Finish line or arrow / leave text     | Enter or Esc                                                                                                                                  |

## 6. The overlay on the main field [MVP]

The overlay is a view setting for the editor, like showing paths. It is never part of the drill, and the show's undo history does not track it.

Settings, in the sidebar's Overlay section and the floating chip's popover:

- **Sketch:** which sketch is shown. One overlay at a time in MVP. Several overlays [Later].
- **Opacity:** slider from 10 to 100 %. The default is 50 %.
- **Position:** **Below marchers** (default; drawn above the field lines and below paths and marchers) or **Above marchers** (drawn above marchers and below selection handles and the marquee).
- **Pages:** **All pages** (default), **Only these pages...** (a multi-select of page names with a "Current page" quick button), or **Pages 12–16** as a range. [Q1]
  - Alternative to decide: tie a sketch to a page by default when it is created from the editor with a page selected.
- **Show fills / Show stickies and text:** toggles to declutter. Stickies are hidden by default on the overlay.
- **Field layout mismatch:** if the sketch's field snapshot differs from the show's current field, the overlay is aligned by the 50 and the front sideline, and a small warning icon in the chip explains this.
- The overlay does not take clicks. Marcher selection and dragging work through it.
- Snapping marchers to sketch geometry (dots, lines, arcs) and **Place selected marchers on these dots** [Later; Q7]. This is the bridge from sketch to drill and probably the most valuable follow-up.
- Exports and prints of the drill leave the overlay out by default, with an "Include sketch overlay" checkbox in the drill export [Later].

## 7. Drill helpers: better than generic Excalidraw

### 7.1 Field-aware snapping [MVP]

- Snap modes in the bottom bar: **Off** (default for free draw), **Steps** (every step, following the grid interval), **Yard lines and hashes** (yard lines, half yard lines (4 steps), hashes and sidelines), and **Shapes** (endpoints, midpoints and centers of other elements, like Excalidraw object snapping).
- Free draw never snaps. Shapes, lines, arrows, stickies and text snap when a mode is on.
- While snapping, a thin accent guide line shows what you snapped to, with a label such as "35 yd line" or "Front hash".
- Hold ⌘/Ctrl to bypass snapping for the current drag.

### 7.2 Step-size ruler and drill readouts [MVP for the readout, Later for rulers]

- The bottom-right readout always speaks drill: "4 out S1 35 · 12 behind FH", using the show's side and hash naming.
- While drawing or resizing: "Rect 16 × 8 steps", "Line 24 steps", "Circle Ø 16 steps", "Arc r 12 steps · 90°".
- **Rulers** [Later]: optional edge rulers in steps, with yard-line labels on the horizontal ruler.
- **Step size** setting: 8-to-5 (default), 6-to-5, 12-to-5 and 16-to-5, used for all readouts and the measure tool.

### 7.3 Dot count on dot fills [MVP]

- A closed shape filled with **Dots**, **Staggered dots** or **Evenly distributed dots** shows a small badge, "24 dots", next to the shape when selected. The Properties panel shows the same count.
- For **Evenly distributed dots** the count is the input: type 24 and the dots spread evenly inside the shape (for lines and arcs, along them, end to end). The resulting average interval is shown ("≈ 2.1 steps").
- For **Dots** and **Staggered dots** the interval is the input (2 steps by default) and the count is the result.
- Lines and arcs get a **Dots along** stroke style with a count, such as "12 dots, 2 steps apart", because a dotted arc is the most common way to sketch a form.
- The total of the selection appears in the readout: "3 shapes · 64 dots". This answers "do I have enough people for this?" at a glance, without marchers.

### 7.4 Measure tool [MVP]

- Press M, then drag: a dimension line with "12 steps (7.5 yd) · 8-to-5" and its horizontal and vertical parts ("8 L-R · 9 F-B").
- Click two elements in turn to measure between their nearest points.
- Measurements are temporary by default. **Pin** turns one into a dimension element on the sketch [Later].

### 7.5 Form stamps [Later; Q8]

- Press F, or click the stamp button at the end of the tool bar, to open a tray of parametric forms: **Block** (rows × files, interval), **Line**, **Arc**, **Circle**, **Company front**, **Wedge**, **Diamond**, **Box** (hollow block), **Spiral**, **Scatter** (N dots in an area).
- Stamps come in dot-filled by default, with live handles: drag to change interval, rows or radius, and the dot count updates. "Convert to drawing" turns one into plain shapes.
- Rows and files are not shown in UI text. Sizes read "8 × 4" as dots across by dots deep, per earlier feedback.

### 7.6 Symmetry [MVP for mirror copy, Later for live symmetry]

- **Mirror across the 50** [MVP]: copies the selection to the other side, flipped. It is in the selection's Properties actions and on ⌘⇧M.
- **Live mirror** [Later]: a bottom-bar toggle that mirrors everything you draw while it is on, with a faint ghost on the other side. Choose the axis: the 50 (side to side) or the center of the field (front to back), or both for 4-way symmetry.

### 7.7 Smaller helpers [Later]

- Hash-to-hash and sideline references in the readout ("on the front hash").
- A "set" stamp that drops a small numbered flag, for labeling sketches as page ideas.
- Color presets per section (brass, woodwinds, guard) as stroke swatches.

## 8. Panels

### 8.1 Properties panel [MVP]

It shows what applies to the active tool or the selection, from top to bottom, in Excalidraw's order:

- **Stroke:** 5 swatches (ink, red, blue, green, accent violet) plus a custom picker. Section colors [Later].
- **Background / fill color:** transparent, plus 5 pastel swatches and a custom picker.
- **Fill pattern** (closed shapes): **None**, **Solid**, **Lines** (hatch), **Cross lines**, **Dots**, **Staggered dots**, **Even dots**. It is shown as a row of 7 icon toggles (`ToggleGroup`).
  - Lines and Cross lines: Spacing (steps, default 1) and Angle (default 45°).
  - Dots and Staggered dots: Interval (steps, default 2), Dot size (S, M, L) and an "Align to grid" switch (dots on the step grid rather than relative to the shape).
  - Even dots: Count (number input, `DragInput`) and the resulting average interval.
  - All dot fills show the dot count.
- **Stroke width:** thin, bold or extra bold.
- **Stroke style:** solid, dashed, dotted, or **Dots along** (with Count).
- **Sloppiness:** Clean or Sketchy. [Q10]
- **Edges:** sharp or round (rectangles, diamonds and lines).
- **Arrowheads** (arrows and lines): start and end. None, arrow, triangle, bar or dot.
- **Text** (text and stickies): size S, M, L or XL, font Hand (handwritten), Sans (DM Sans) or Mono, and alignment.
- **Sticky color:** yellow, pink, blue or green.
- **Opacity:** slider from 0 to 100.
- **Layers:** to back, back, forward, to front.
- **Actions:** duplicate, delete, group, lock, mirror across the 50, link [Later].

### 8.2 Field settings panel [MVP]

Opened from **Field** at the top right. It floats on the right side.

- **Layout:** a read-only label such as "College football · from the show on Oct 18", plus **Use current show field** (only when it differs) [MVP]. Changing a sketch to a different preset layout [Later].
- **Show:** switches for Yard lines, Yard numbers, Hashes, Grid, End zones and Sidelines.
- **Grid interval:** 1, 2 or 4 steps. Default 4.
- **Colors:** Field background (white paper, turf green, dark), Yard lines, Grid and Numbers. Each has swatches and a picker, and **Reset to show theme**.
- **Theme presets:** Show theme (default; the snapshot of the show's field theme), Paper (white with black lines, for printing), Turf (green with white lines) and Dark (dark field with dim lines, which keeps late-night sketching easy on the eyes).
- **Field opacity:** fades the whole field to make the drawing pop.
- All of these are part of the sketch and its undo history.

### 8.3 Field changes and snapshots [MVP]

- A sketch stores a copy of the field layout and theme from the moment it was made. Later edits to the show's field do not change existing sketches.
- New sketches always use the show's current field.
- Elements are stored in field coordinates (steps from the 50 and the front sideline), not pixels, so a sketch can be redrawn on a slightly different layout and stay aligned by yard line when used as an overlay or when a user chooses **Use current show field**.

## 9. Empty states [MVP]

- **Sidebar, no sketches:** a small line drawing of a field with a pencil, the title "Sketch a form", the line "Draw freely on the field, with no marchers or counts. Use sketches as an overlay while you write drill.", a **New sketch** button and a **Start from a template** link.
- **Sketchpad, empty sketch:** hand-written, Excalidraw-style hints with curved arrows: "Pick a tool and start drawing" pointing at the tool bar, "Field and grid settings" pointing at Field, and "Snap to yard lines" pointing at the Snap menu. They fade on the first stroke and never return for that sketch.
- **Templates, none yet:** in the New sketch dialog, the "My templates" row shows a dashed card: "Save any sketch as a template from its ≡ menu."
- **Overlay with no sketch chosen:** the Overlay section shows "Click the eye on a sketch to see it on the field."
- **Export with an empty drawing:** allowed. It exports the field, which works as blank drill paper.

## 10. Saving, history and collaboration

- **Storage** [MVP]: sketches live in the .dots file in their own tables (sketch metadata, field snapshot, scene elements as JSON, image blobs and a thumbnail). They are outside the show's undo triggers, like `view3d_cameras`. This touches persistent data and needs an ADR before building.
- **Autosave** [MVP]: about 2 seconds after the last change (debounced), at least every 30 seconds while editing, on window blur and on window close. The title bar shows "Saved" or "Saving..." quietly. The show's own save also flushes open sketches.
- **Undo history** [MVP]: separate per sketch window and in memory. ⌘Z in the Sketchpad never touches the show, and ⌘Z in the editor never touches a sketch. [Q5]
- **Images** [MVP]: pasted or dropped images are stored once per file and deduplicated by hash. Large images are downscaled to 4096 px on import, with a warning above 10 MB.
- **Copy and paste** [MVP]: elements copy as Excalidraw-like JSON on the clipboard, plus a PNG for pasting into other apps. Paste lands at the cursor. Pasting an image file or a URL to an image adds an image. Pasting plain text adds a text element.
- **Collaboration** [Later]: the element model follows Excalidraw's (each element has an id, a version and a version nonce, and is soft-deleted with `isDeleted`), so it can merge with the show-wide collaboration path from the collaboration research (SQL-trigger capture). Live cursors, laser pointer and avatars come with it.

## 11. Accessibility [MVP]

- All tools are reachable from the keyboard. The tool bar is a `ToggleGroup` with arrow-key navigation, and every tool has a tooltip with its shortcut.
- The Properties panel uses the shared base components (`ToggleGroup`, `Slider`, `DragInput`, `Select`), which have labels.
- Fill patterns are distinct shapes, not only colors, so they read in grayscale and for color-blind users.
- The canvas exposes a live region that announces the readout and dot counts when selection changes.

## 12. MVP summary

**MVP:** the sidebar list (create, open, rename, duplicate, delete with undo, eye overlay), the New sketch dialog with Blank and built-in templates, Save as template, the Sketchpad window with these tools: select, hand, rectangle, diamond, ellipse, arrow, line and connected lines with a curved style, free draw, text, sticky, image, eraser and measure. Also all 7 fills with dot counts, Dots along strokes, the Properties panel, the Field settings panel, snapping (steps, yard lines and hashes, shapes), the drill readout, mirror across the 50 (copy), copy and paste, autosave and per-window undo, the overlay (opacity, above or below marchers, pages), and PNG, SVG and PDF export of one sketch.

**Later:** form stamps, the bezier pen, live symmetry, rulers, pinned measurements, presentation mode, the overlay in the 3D View, several overlays at once, placing marchers on sketch dots, export of all sketches to one PDF, laser pointer, collaboration, the Excalidraw clipboard bridge, and template management.

## 13. Open questions for the owner

Each question has a recommendation.

1. **Which pages does an overlay show on?** Recommendation: All pages by default, with "Only these pages" one click away and a "Current page" quick button. A sketch is an idea, not a set. A page link that turns itself on would surprise people who sketched before writing the pages.
2. **One window per sketch, or one Sketchpad window with tabs?** Recommendation: one window per sketch, focused if it is already open. It matches the "paper next to me" idea, two sketches can be compared side by side, and it reuses the 3D View window plumbing. Tabs can come later if people open many sketches.
3. **Where do templates live?** Recommendation: the user's Library, so templates follow the designer from show to show, like camera profiles. The web build, which has no Library, saves them in the file. A "This show" section shows templates found in the file.
4. **What does a template carry?** Recommendation: the drawing plus field style (grid, colors, theme), but never the field layout. The layout always comes from the show at creation time, as the brief says. Content is placed by yard line.
5. **Should the undo history survive closing and reopening the window?** Recommendation: no for MVP. History is kept while the window is open, and autosave plus Duplicate covers "I want to go back". Persisting it adds storage and migration cost for little gain. Revisit with version history for working-copy saves.
6. **Delete: confirm or toast with Undo?** Recommendation: toast with Undo (10 s), no dialog. This matches the Excalidraw and FigJam feel. Sketches are kept in the file until the show closes, so a late regret is still recoverable within the session.
7. **Should a sketch be able to place marchers ("Place selected marchers on these dots")?** Recommendation: yes, but as the first follow-up after MVP, not in MVP. It is the strongest reason to sketch in OpenMarch instead of on paper, but it needs its own design (assignment order, which page, undo in the show).
8. **Are form stamps MVP?** Recommendation: Later. Even dots on a closed shape plus Dots along on lines and arcs already sketch blocks, arcs and lines with correct counts. Stamps are a polish layer, and the existing shape system (spec 08) may supply the parametric forms to reuse.
9. **Which modifier bypasses snapping?** Recommendation: hold ⌘/Ctrl, as in Figma and FigJam. Alt is taken by duplicate-drag and draw-from-center, and Shift by constrain. Note that the main field uses Alt for snapping re-anchor (#197). Aligning the two is worth a quick check.
10. **Clean or Sketchy strokes by default?** Recommendation: Sketchy for free draw and shapes (it signals "this is a sketch, not the drill" and makes the overlay easy to tell apart from paths), with dot fills always drawn crisp so counts are readable. Export "Print" look draws everything clean.
11. **Should sketches appear in the main editor's undo history (create, delete, overlay toggles)?** Recommendation: no. Keep the show's history about the drill. Overlay settings are view state.
12. **Does the overlay show in exports and on the mobile app?** Recommendation: not in the mobile app. In drill exports, off by default with an opt-in checkbox [Later].
