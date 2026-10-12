<!-- cspell:disable -->

# Basic and Expert modes (UI-19)

Started 2026-10-11 from the project owner's brief. Branch `timeline/basic-mode` (fork), off fork
main 30f2bf9c. Decisions marked _owner_ were answered by the project owner on 2026-10-11; the rest
are lead defaults and have V-rows in `../ownership/VALIDATION.md` (V-200 onward).

## The brief

Not every designer wants the full timeline. Make the page-box timeline a first-class **Basic**
mode, next to the full timeline (**Expert**), with:

1. **Holding across pages** (UI-18). Every kind of user asked for it.
2. **No moves across page flags, and no moves overlapping a marcher's other moves.**
3. **Positions in the middle of a page.** Editing at a count inside a page splits that marcher's
   move there: one move from the page's start to the count and one from the count to the page's
   end, so the page's end position is kept. Editing again splits again. Every move stays inside
   its page.
4. **Switching both ways.** Everything Basic makes shows up in Expert. Not everything Expert makes
   can be edited in Basic: it still plays and is still kept, but Basic can't change it. A show may
   need Expert for one passage only.
5. **A setting, Basic or Expert, with screenshots,** asked on first launch in a welcome flow
   before any show is created.

## What "the old timeline" is today, and why Basic isn't it

Today the page-box bar is **page mode**: files whose `workspace_settings.timelineMode` flag is off.
It has its own data (`marcher_pages`, `pathways`, `midsets`), its own write paths and its own
drawing (`renderMarchers`, keyframes for the selected page ±2). None of the timeline work reaches
it: not the resolver and its cache, idle warming, scrubbing, or holding. Old files only become
timeline files when the `OPENMARCH_CONVERT_ON_OPEN` gate is on.

So **Basic is not page mode.** Basic is a UI over timeline data. A Basic show is a timeline file
(`timelineMode` on), drawn and played by the resolver like Expert. What changes is the bottom panel
and which edits it can make. That gives Basic all the rendering and holding work for free, and it
makes switching modes free: no conversion, the same file.

- _Owner:_ when Basic ships, **convert on open is on for everyone** (existing backup and loss
  report). Page mode stays in the code as a fallback only and is removed later.

## The mode

- An **app setting**, not a file setting: electron-store key `editorMode`, `"basic" | "expert"`.
  Unset means the welcome flow hasn't run. It's in Settings → General as two cards with screenshots.
- It can change while a show is open, with no reload and no file write. The file doesn't record
  it.
- Playwright/CI, and the web build without a choice, default to **Expert** so existing tests and
  lab tests keep their behaviour (lead default).

## Basic's panel

The page-mode bar's layout (controls, the "Pages" row of page boxes sized by duration, the audio
row with its waveform), driven by the timeline stores:

- **Clicking a page box** puts the playhead on its flag (its end), so edits land on the page, as
  in page mode.
- _Owner:_ **free playhead.** Clicking or dragging inside a box puts the playhead on that count.
  A playhead line is drawn across the boxes. The field line says "Editing count 5 of page 3" when
  P is inside a box, and "Editing page 3" on a flag.
- **Mid-page positions show as ticks** in the page box (for the selected marchers, like the hold
  marks). Right-click a tick: **Remove this count's position** merges the two moves back into one.
- Kept: hold marks and their tooltip (UI-18), page delete options, add page, resize a page (its
  counts), subset toggle, Keep here/Follow again.
- Not in Basic: the start flag and pinning, the loop region, clips (moves off flags), isolation,
  resize-a-move and drag-a-flag grips, the moves inspector card's range editing, pass-through
  windows.
- The inspector hides the move card (path style, range, Delete move) and the Timeline section
  (timeline shapes, diagnostics): each makes moves Basic can't edit. **Open:** shapes in Basic
  (a shape move inside one page could count as simple), to decide with the shape-draw redesign.
- Play, Space and Shift+Space use the timeline playback driver. Space plays on from the playhead;
  Shift+Space plays the selected page once (UI-17).

## How Basic writes

Every Basic edit is "marcher m is at (x, y) at beat P" on the page box `[a, b)` holding P. It's a
new edit target, `{kind: "point", beat: P, box: [a, b)}`, alongside home/range/timeline. It's
chosen by `planCanvasEdit` in Basic, so canvas drags, the inspector, align/distribute, nudges and
set-to-previous/next all use it. Per marcher, with `R` = its moves inside `[a, b)` (all one-slot
shapeless moves on one layer, ordered, not overlapping; see "Simple"):

| Where P is                                                 | What's written                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| On a move's end (P = r.end, including the flag)            | r's destination is set (as today's page edit)                                      |
| Inside a move r (r.start < P < r.end)                      | r becomes `[r.start, P)` → (x, y) and `[P, r.end)` → r's old destination           |
| In a hold after the last move, before the flag (e < P < b) | `[e, P)` → (x, y) and `[P, b)` → the held position, so the flag keeps its position |
| On the flag (P = b) with no move ending there              | `[e, b)` → (x, y), with e = the last move's end, or a                              |
| Nothing changes for a marcher                              | nothing is written for it (UI-18)                                                  |

- The move after P always ends where it used to, so the page's end position and every later page
  are unchanged when editing mid-page (brief 3). An edit on the flag carries forward as in UI-18.
- New moves are written on the marcher's existing layer for the box (0 when it has none), never
  at `stealLayer`, so nothing overlaps.
- Dragging a marcher back onto the position it had at the previous point removes that point
  (the two moves merge), like UI-18's "back onto the start clears the move" (lead default).
- **Remove this count's position** merges `[s, P)` and `[P, e)` into `[s, e)` with the second
  move's destination.
- Timelines stay one per range (C-12). Marchers split at different counts get different timelines.
  The page timeline `[a, b)` stays for marchers that don't split.

## Simple: what Basic can edit

A marcher is **simple on a page** `[a, b)` when every one of its moves overlapping the box:

- starts and ends inside the box (`a ≤ start`, `end ≤ b`);
- doesn't overlap another of its moves in time, whatever the layer;
- is a one-slot transition with no shape (`dest_shape_id` null) and a direct path.

A marcher with no move there (holding or kept) is simple. This is computed from the stored
assignments (not the resolver's spans), per marcher per page, in one pure function shared by the
panel, the canvas and the writer.

- _Owner:_ **per marcher, not per page.** A marcher that isn't simple on the selected page is
  **locked** in Basic on that page: it can't be selected for editing, and dragging it shows a toast
  "Marcher B3 uses Expert moves on page 4 · Switch to Expert". The other marchers stay editable.
  The page box shows an Expert mark (a small ◆E badge, lead default) when any marcher on it isn't
  simple, with a tooltip naming how many.
- The writer refuses a non-simple marcher too (defence in depth), so no Basic path can create an
  overlap or a move across a flag.
- Locked marchers still play, scrub and draw exactly as in Expert.
- Opening a show with Expert data in Basic shows one dismissible banner: "Pages 4–7 use Expert
  moves. You can view them here; switch to Expert to edit them."

## Welcome flow

_Owner:_ mode plus analytics. On first launch (`editorMode` unset), the launch page opens a modal
before anything else:

1. **Welcome to OpenMarch** (one line, Continue).
2. **How do you want to work?** Two cards with screenshots: **Basic** ("Pages, like a drill
   chart. Set each page; marchers hold until you move them again.") and **Expert** ("The full
   timeline: moves that cross pages, overlapping moves, loop and start flag."). Neither is
   preselected. "You can change this any time in Settings."
3. **Help improve OpenMarch** (the analytics opt-in, moved here from its own modal). Skipped when
   `optOutAnalytics` is already set.

Existing users who upgrade see it once too (their `editorMode` is unset). The web build has no
launch page; there the choice comes from the URL (`?mode=basic`) or defaults to Expert.

Screenshots: captured from the real app with the headless harness (`/validate`), stored as webp
in `apps/desktop/src/assets/editor-mode/`, and used by both the welcome flow and Settings.

## Work packages

| ID  | What                                                                                                                                                                                                                        | Depends on         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| B1  | `editorMode` setting: store, hook, Settings row (no screenshots yet)                                                                                                                                                        | none               |
| B2  | Simple predicate + the point writer + Remove position, with tests                                                                                                                                                           | none               |
| B3  | Basic panel in timeline mode; `planCanvasEdit` returns the point target in Basic                                                                                                                                            | B1, B2             |
| B4  | Locks: canvas lock, toast, page-box Expert mark, open banner                                                                                                                                                                | B2, B3             |
| B5  | Welcome flow (mode + analytics), screenshots in welcome and Settings                                                                                                                                                        | B1, B3             |
| B6  | Convert on open on by default; page mode as fallback. This is P9.4 (phases/09-flip.md): its prerequisites (packaged smoke run, the owner's manual pass on a real show) still stand, so it ships as P9.4, not in this branch | P9.4 prerequisites |
