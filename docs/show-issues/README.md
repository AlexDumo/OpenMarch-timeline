# Issues: one place for everything wrong with the show

- Status: design agreed with the owner 2026-11-01. Not started.
- Decision record: [ADR 0009](../adr/0009-show-issues.md) (proposed)
- Replaces: the Collisions toolbar tab (fork #226, #242)

## Intent

A designer can do whatever they want. Problems with the show are collected in
one place they can work through when they choose, like the grammar review in
a word processor. Nothing blocks or interrupts an edit.

v1 builds the framework with two checks (collisions, then step size). More
checks plug into the same interface later.

## Where things stand today

- Collisions show as a top-toolbar tab that only appears when the selected
  page has one (`components/toolbar/tabs/CollisionsTab.tsx`). Its "Review"
  popover lists pairs. Detection checks only the selected page and its move
  into the next page (`hooks/useCollisionDetection.ts`,
  `global/classes/CollisionDetection.ts`). The radius is one fixed number in
  field units, while the tab says "steps".
- Collision markers are switched off app-wide (`UiSettingsStore`,
  `showCollisions` forced to `false`). The View tab still has the toggle.
- Step size has a separate red badge in the inspector
  (`StepSizeWarningBadge.tsx`) and warning paths on the field
  (`stepSizeWarnings`, toggled in Settings › Field). The threshold is
  `stepSizeWarningThresholdInches` in field properties.

## Words

- **Issue**: one thing wrong with the show, found by a check. The UI word is
  "Issues", never "Collisions" or "Warnings".
- **Check**: a kind of test, e.g. collisions or step size.
- **Level**: **Problem** (red) or **Heads-up** (yellow). Each check sets a
  default.
- **Incident span**: the counts an issue covers. Issues are spans, not
  moments.
- **Rule**: a check setting, either the show default or an override for a
  section, a tag or one performer.

## Where it lives

- A **left-sidebar entry, "Issues"**, beside Marchers, Shapes and Music. It
  opens a panel like the other sidebar entries. The Collisions toolbar tab is
  removed, so the toolbar never changes shape based on what the show
  contains.
- The icon has a **badge**:
  - the **count of open issues** in the current scope (dismissed issues
    excluded)
  - a **dot** when something new has appeared since the panel was last
    opened. Opening the panel marks everything as seen.

## The panel

- **Scope switch: Whole show · Here.** Whole show is the default. "Here" is
  the selected page, or the loop region when one is set. The badge follows
  the scope. This solves the full-inbox problem: someone working on one page
  isn't drowning in 100 issues from elsewhere, so the one that just appeared
  stands out. The choice is remembered per user, not saved in the show.
- **Grouped by page in show order**, sorted by count within a page. A page
  header reads like "Page 4 · 2 problems, 1 heads-up". When the panel opens,
  the page at the playhead scrolls into view.
- **Rows**: an icon for the check type, a level color, the performers, a
  short message and the span, e.g. "12 and 15 within 0.8 steps · counts 3–5".
  Spans crossing a page flag read "page 4, count 7 → page 5, count 2". New
  issues are bold with a dot.
- **Filter chips**, one per check type.
- **Freshness**: while the whole-show sweep is behind, a line reads
  "Checking… 12 of 60 pages". Rows in parts of the show that are out of date
  stay visible but greyed until rechecked. Rows never blink out and come back.
- **Dismissed (n)** at the bottom lists every dismissed issue with a way to
  bring it back.
- **Checks** at the bottom lists each check with an on/off switch and its
  rules (below).

### Clicking an issue

It moves the playhead to the issue's worst moment, selects the performers
involved and glides the field to frame them (reusing `zoomToCollisions`).

### Keyboard

Next and previous issue shortcuts, in the command palette like every action,
shown as keycaps.

## Dismissing

Each row's ⋯ menu:

| Action                                     | Effect                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| **It's intentional**                       | Hides this one occurrence.                                                     |
| **Allow for 12 and 15** / **Allow for B3** | Hides this check for these performers anywhere in the show. Wording per check. |
| **Stop checking for collisions**           | Turns the check off for this show. Turned back on in the Checks section.       |

There is no snooze. The scope switch covers "not now".

### What counts as "this occurrence"

Shows are edited constantly, so an occurrence's identity is **check +
performers + incident span**. When the show is rechecked, an issue stays
dismissed if the same check and the same performers have a span that
overlaps or touches the dismissed span. A nudge that shifts a collision by a
count stays dismissed. The same pair colliding somewhere else is a new
issue.

### Where dismissals are kept

In the **show file** (a new table, see the ADR). They travel with the show to
staff and collaborators, because a dismissal is a judgement about the show,
not a personal preference. They are **left out of undo**, so Ctrl+Z never
brings back warnings someone just cleared. The Dismissed section is the way
back.

## Never in the way

- No toast, modal or sound while editing.
- **Soft blink**: when the live check finds an issue that an edit just
  caused, the badge pulses once and the field briefly flashes a marker where
  the issue is. Existing issues never pulse. This lets a designer notice a
  problem they just made before building a whole page on top of it.
- **Exports**: when Problems are open, the export dialogs (PDF, video,
  mobile) show one dismissible line, "3 problems remain · Review". It never
  blocks the export. Heads-ups aren't mentioned.
- The same in Basic and Expert modes. Hidden in Preview mode. Field markers
  are hidden while playing.

## Field markers

The owner looked at three options on a busy page (five collisions and six
big steps among 46 performers):

- **A, explain everything** (today's approach: a disc for collisions, a path
  for step size): clearest for one issue, a tangle for eleven.
- **B, plain rings**: calm, but you can't tell what's wrong.
- **C, ring plus a check glyph, full explanation on focus**: chosen, with a
  condition (below).

So:

- **At rest**, every issue at the playhead draws a **ring** around each
  performer involved, red for Problem and yellow for Heads-up, plus a mark
  that says which check it is.
- **On focus**, the focused issues get their full explanation (the collision
  disc, the step-size path, a label like "B3 · 9-to-5 step, limit 8") and the
  rest dim. Focus means hovering a ring, selecting a performer with an issue,
  or picking a row in the panel. The owner liked this part specifically.
- One toggle, **Show issues on field**, replaces the separate collision and
  step-size toggles.
- Each check supplies both drawings (its rest mark and its focus
  explanation), so every new check gets the same calm look.

**Open, settle in the prototype:** the rest-state check mark must be obvious
at a glance. The tiny glyph in the mock-up was not. Try a larger mark, e.g.
a filled badge with the check's icon attached to the ring, at normal zoom on
a busy page.

## Checks and rules

### The check interface

A check is a pure function in core, so the live tier and the worker run the
same code and can never disagree.

```ts
interface Check {
  id: string; // "collisions", "step-size"
  name: string; // Tolgee key
  defaultLevel: "problem" | "heads-up";
  unit: "counts" | "move"; // what one incident is, for stitching
  inputs: "positions" | "positions+show"; // what invalidates it (see ADR)
  rules: RuleSchema; // settings, each with a show default
  run(window: CheckWindow): Hit[];
  rest: MarkSpec; // field mark at rest
  focus: MarkSpec; // field explanation on focus
}

interface Issue {
  checkId: string;
  level: "problem" | "heads-up";
  performers: number[]; // may be empty
  span: { fromBeat: number; toBeat: number };
  worstBeat: number;
  location?: { x: number; y: number };
  message: MessageSpec; // Tolgee key + values
}
```

- **Stitching**: checks report hits over the time window they were given.
  The framework merges hits for the same check and performers into one
  incident by the check's natural unit:
  - `counts`: hits in touching counts merge, across bucket and page
    boundaries (collisions).
  - `move`: one incident per move, from the resolver's `spanInfos`, showing
    the worst value (step size). A 16-count move with too big a step is one
    row covering the whole move, even when the move crosses page flags.
- **Issues with no performers** are allowed, for future checks like "page
  with no music" or "show runs past the end of the audio". They have no field
  ring, and clicking one just moves the playhead.

### Rules

- Every check setting has a **show default** plus **overrides** for a
  **section, a tag or one performer**, e.g. "Tubas: personal space 0.75
  steps" or "Tag _Vets_: max step 8 to 5".
- The most specific rule wins: performer, then tag, then section, then show
  default. When two tags on one performer disagree, the more lenient rule
  wins, because these are warnings, not limits.
- Rules are edited in the panel's **Checks** section. Each check expands to
  show its default and overrides, with **+ Rule for…** to pick a section, tag
  or performer. A selected performer's inspector shows a read-only line,
  "Personal space 0.75 · from Tubas", linking to the rule.
- Thresholds and messages are in **steps**, never field units.

### v1 checks

**Collisions (phase 1).** Each performer has a **personal space** radius.
Two performers collide when the circles overlap: distance < rA + rB. A tuba
(0.75) beside a clarinet (0.5) collides inside 1.25 steps. The default radius
reproduces today's threshold (`COLLISION_RADIUS`). Only performers count, not
props. Unit: `counts`. Default level: Problem.

**Step size (phase 2).** Rebuilt on the framework. Unit: `move`. The
field-properties threshold becomes the show-default rule, keeping its value.
The inspector badge reads from the check, and the old warning paths become
this check's focus explanation.

## How checking runs

Summary. The mechanics, and why, are in the ADR.

- **Live tier** (main thread): checks only the selected page's window after
  edits settle, as detection does today. It drives the soft blink.
- **Sweep tier** (a worker with its own resolver copy, fed the same committed
  change batches): checks the rest of the show, nearest the playhead first.
- **What's out of date** is found from positions, not the model: a
  fingerprint per (marcher, 4-count bucket). An edit re-samples only the
  marchers the resolver rebuilt. Anything fingerprints can't see (tags,
  sections, rules, props, marchers added or removed) reruns that check on the
  whole show.
- **Pacing**: driven by out-of-date work, never by a timer. An idle show uses
  no CPU. No sweeping during playback, scrubbing or a drag. Pauses while the
  window is hidden. Waits about 2 s after the last edit, or about 10 s and in
  smaller chunks on battery.
- **Setting**, "Check the whole show": **Automatically** (default) · **When
  Issues is open** · **Never** (live tier only).

## Plan

### Before any code

1. Owner accepts ADR 0009.
2. **Performance spike** on the 2,000-marcher benchmark show: fingerprint
   build time and memory, re-sample cost for a 1-marcher edit and a
   200-marcher shape edit, the recheck cost per dirty bucket, and the cost of
   keeping the worker resolver in sync. Phase 1 waits on the results.
3. **Throwaway prototype** of the panel, the badge (count, dot, scope) and
   the field markers, especially an obvious rest-state check mark, published
   to the lab.

### Phase 1: framework and collisions

- Issues sidebar entry, badge and dot. The Collisions toolbar tab is removed.
- Panel: groups by page, spans, filter chips, freshness line, greyed stale
  rows, Dismissed section, scope switch.
- Check interface, issue model and stitching in core.
- Live tier, worker sweep, fingerprints, pacing, the setting.
- Dismiss actions with span-overlap identity. The show-file table and
  migration, left out of undo.
- Soft blink, click to jump, field markers.
- Collisions on the framework: personal space, rules, steps everywhere.
- Same in Basic and Expert, hidden in Preview.

### Phase 2: a second check proves the framework

- Step size on the framework, with its limit moved into rules.
- The export dialog line.
- Next/previous issue shortcuts.

## Later

Not part of v1. Recorded here so the v1 design leaves room for each.

- More checks: equipment changes (time to swap), interval and spacing, out
  of bounds, facing, tempo too fast to march, a page with no music, the show
  running past the audio.
- Changing a check's level (Problem ↔ Heads-up) per show.
- Automatically explaining every issue when only a few are on screen.
- Editing rules from the inspector. v1 shows a read-only line.
- Saving check rules as Library presets to reuse across shows.
- Showing who dismissed an issue, once collaboration lands.
- Issues in the 3D View, and an issues report in PDF and print exports.
