<!-- cspell:disable -->

# Roster changes 04: prior art outside drill tools, and whether a small LLM helps

Status: research, 2026-11-16. Web research plus a short look at the schema. It doesn't decide
anything.

**Question.** A performer leaves or joins partway through a season. For every set, the designer
must choose: leave a hole, close the gap, re-lay out the form, or hand the part to someone else.
Today that means walking every set by hand. Part A asks how competent tools in other fields handle
"a thing many timed or structured things depend on is removed or added, and the user must review
the consequences". Part B asks whether a small LLM (Claude Haiku class) earns a place.

By rule, no drill-writing software is used as a precedent.

**Evidence labels.** **[V]** verified on the cited page during this research. **[I]** inferred
from verified facts. **[K]** general knowledge of a widely used product, not re-read for this
report. Some pages (Steinberg archive, Blender manual, Deputy help, Blender issue tracker) returned
HTTP 403 to the fetcher. Claims from those rely on search-result quotes and are marked so.

---

## Summary

1. Good tools give "remove" **two named verbs**: leave a gap or close it. Final Cut Pro has Delete
   (ripple) and Replace with Gap. Excel has Delete (shift cells) and Clear Contents.
2. The safe verb, which moves nothing else, is always one keystroke away. Hole should be our default.
3. Tools that handle departures well **separate the role from the person**. Shifts go to
   OpenShifts, a play uses positions, and a retarget maps bones to named slots.
4. OpenMarch already has this split. A `marchers` row is a drill spot (`T12`) with an optional name.
5. Consequences are **found before the delete**, not after. IntelliJ's Safe Delete searches usages
   first. When I Work asks what to do with upcoming shifts while you archive the user.
6. Review is a **step-through queue with a batch escape**. Word has Next, Accept and Accept All.
   A git rebase stops at each conflict and offers continue, skip or abort.
7. **Policies are declared once and applied everywhere**, with per-instance overrides. Examples are
   Postgres `ON DELETE`, and Dorico's automatic condensing plus manual condensing changes.
8. **Procedural layouts reflow and explicit placements stay put.** OpenMarch shape recipes
   (ADR 0006) are the hook for this. Only recipe-placed sets can re-lay out on their own.
9. **Never destroy the leaver's data.** Dorico deletes a removed player's notes, and forum users
   call it unrecoverable. Blender keeps orphaned curves and flags them. Performers often come back.
10. **LLM verdict:** don't build one into v1. A deterministic engine and the Issues panel do the
    classifying, ranking and geometry better. The one job worth an LLM later is turning a sentence
    into rules ("holes in the closer, close up the ballad"). It is optional, BYO key, and outputs
    rules the designer can see and edit. Cost is not the blocker: about $0.02 per roster change on
    Haiku 5.5. The blockers are offline use, trust, and the missing structured show description.

---

## Part A: prior art

Each entry gives the default, the preview, the review style (one by one or batch), how to make a
per-instance exception, and undo.

### A1. Video editing: Final Cut Pro, Delete vs Replace with Gap

- **Default.** Delete ripples: "any clips to the right of the selection ripple to close the
  resulting gap" [V]. Connected clips are deleted with it, unless you hold the Grave Accent key [V].
- **The other verb.** Edit > Replace with Gap (Shift-Delete) swaps the clip for a gap clip.
  Duration stays the same, and connected clips attach to the gap [V]
  ([Apple: Delete clips](https://support.apple.com/guide/final-cut-pro/verc5d34129/mac)).
- **Preview.** None. You see the result straight away and undo it [K].
- **Review.** One edit at a time.
- **Undo.** Standard undo [K].
- **Lesson.** Hole vs close-up is the same decision as gap vs ripple. Editors name both verbs and
  bind both to keys. A gap is a real object (a gap clip) that other things can attach to. A drill
  hole could also be a real object: an "open spot" that keeps its motion.

### A2. Spreadsheets: Delete (shift) vs Clear Contents

- **Default.** The Delete key clears contents and leaves cells in place [V]
  ([Microsoft: Clear cells](https://support.microsoft.com/en-US/Excel/clear-cells-of-contents-or-formats)).
  Deleting cells asks which way to shift, left or up [V]
  ([XlDeleteShiftDirection](https://learn.microsoft.com/en-us/office/vba/api/excel.xldeleteshiftdirection)).
- **Consequence.** Formulas that pointed at deleted cells show `#REF!`. This is from third-party
  guides only, not a Microsoft page found here [I]
  ([thebricks.com](https://www.thebricks.com/resources/how-to-delete-cells-in-excel)).
- **Preview and review.** None. Breakage shows up later as errors.
- **Lesson.** The cheap key does the non-destructive thing. Closing up is an explicit choice that
  asks a question. The `#REF!` pattern is an anti-pattern for us: a broken result found later,
  in a place you weren't looking.

### A3. CSS grid and Figma auto layout: reflow vs pinned

- **CSS grid.** "The first thing grid will do is place any items that have a position." Then
  auto-placed items fill the rest. By default the fill only moves forward and leaves holes.
  `grid-auto-flow: dense` goes back and fills them [V]
  ([MDN: Auto-placement](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Auto-placement_in_grid_layout)).
- **Figma auto layout.** When "elements are added, removed, or resized, the layout adjusts" [V].
  A child set to Ignore auto layout "is excluded from an auto layout flow while keeping it in the
  auto layout frame" [V] ([Figma: auto layout](https://help.figma.com/hc/en-us/articles/360040451373)).
  A hidden child takes no space [K].
- **Instances.** On a swap, "Figma will try to preserve any overrides" when properties match [V,
  via search quote of Figma help]
  ([Figma plugin API: swapComponent](https://developers.figma.com/docs/plugins/api/properties/InstanceNode-swapcomponent/)).
- **Lesson.** Whether something closes up depends on **how it was placed**. Rule-placed things
  reflow. Pinned things don't. In OpenMarch, a set placed by a recipe (box, arc, circle, ADR 0006)
  can re-run the recipe with one fewer marcher. A hand-dotted set can't, so it gets a hole or goes
  to a person. Hand nudges are overrides that should survive the re-run, as Figma's do.

### A4. Notation: Dorico players, flows, layouts and condensing

- **Remove a player from a flow.** "If you remove a player from a flow, any notes you have already
  input for that player in that flow are deleted" [V, via search quote of Steinberg help]
  ([Dorico: Assigning players to flows](https://steinberg.help/dorico/v4/en/dorico/topics/setup_mode/setup_mode_flows_changing_players_t.html)).
  Forum users report losing music this way, and one says it can't be undone [I, forum]
  ([forum](https://forums.steinberg.net/t/request-removing-instrument-from-flow/138381)).
- **The safe alternative.** Untick the flow in a layout. The music is kept and just not shown
  (forum advice) [I].
- **Condensing.** It is automatic, and condensing changes override it from a given position.
  "Dorico Pro follows your manual condensing settings exactly". Deleting a change falls back to
  the previous change or the layout default [V, via search quote of Steinberg help]
  ([Dorico: Manually condensing](https://steinberg.help/dorico/v4/en/dorico/topics/page_formatting/page_formatting_condensing_changing_manually_t.html)).
- **Sibelius Explode/Reduce.** Rule-driven redistribution of parts across staves [V]
  ([Avid: arranging](https://www.avid.com/sibelius/music-arranging)).
- **Lesson.** There are three layers: the role (player), the content (notes), and what's visible
  (layout). Removing the role must not silently delete the content. Automatic results take dated
  manual overrides that hold until the next change. That maps well onto "policy from set N onward".

### A5. Animation: Blender orphaned F-curves, Maya HumanIK retargeting

- **Blender.** Deleting a bone leaves its F-curves in the action. Their paths no longer resolve,
  so they're disabled and underlined in red. Developers treat keeping them as working as designed
  [I, from bug reports via search]. Channel > Revive Disabled F-Curves clears the disabled tag.
  Renaming a channel to a new bone reconnects it [V, via search quote of Blender manual]
  ([Blender manual: channels](https://docs.blender.org/manual/en/3.5/editors/graph_editor/channels.html)).
- **Maya HumanIK.** Each character needs a definition that maps its joints to named slots. Fifteen
  are required, the rest optional. Animation moves between skeletons through the slots, not the
  bones [V] ([Autodesk: HumanIK character structure](https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-5DEFC6E5-033C-45D5-9A0E-224E7A35131B.htm)).
- **Houdini crowds.** Crowd Source "will create agents at those points" you wire in. The count
  follows the points [V] ([SideFX: crowd setup](https://www.sidefx.com/docs/houdini/crowds/setup.html)).
- **Lesson.** Orphaned motion stays visible and reconnectable. A departed performer's motion
  should stay as a ghost track that can be revived or given to someone. Slot mapping is the "hand
  the part to someone else" move: the part (slot) keeps its motion and the person changes.

### A6. Code tooling: IntelliJ Safe Delete, git rebase and rerere

- **Safe Delete.** IntelliJ "looks for usages" before deleting. If it finds any, it "lets you check
  them to make necessary adjustments" [V]
  ([JetBrains: Safe delete](https://www.jetbrains.com/help/idea/safe-delete.html)). Older docs name
  the choices View Usages and Delete Anyway [V, via search]
  ([2017.1](https://www.jetbrains.com/help/idea/2017.1/safe-delete.html)).
- **Rebase.** Stops at each conflicting commit. You resolve it, then continue, skip or abort [K].
- **rerere.** It records "conflicted automerge results and the corresponding hand resolutions".
  It reapplies them when the same conflict comes back, and rebase uses it too [V]
  ([git-rerere docs](https://sources.debian.org/src/git/1%3A2.51.0-1/Documentation/git-rerere.adoc)).
- **Lesson.** Count the consequences before committing ("this marcher is in 41 sets, 12 placed by
  a recipe"). Review is a stoppable queue with abort. A decision made once should replay where the
  same situation repeats. In drill, a form held across several sets is the same situation.

### A7. Documents: Word Track Changes

- **Review.** Next and Previous step through changes. Accept or Reject one and Word moves to the
  next. Accept All and Reject All finish in one go [V]
  ([Microsoft: Accept or reject tracked changes](https://support.microsoft.com/en-gb/word/accept-or-reject-tracked-changes-in-word)).
- **Pending state.** Changes are only resolved by accepting or rejecting them. "No Markup" only
  hides them [V].
- **Lesson.** Proposed changes are visible in place, not in a separate dialog, until resolved.
  Batch and one-by-one are the same queue at different speeds.

### A8. Scheduling: When I Work, Connecteam, Deputy

- **When I Work.** Archiving a user asks about upcoming shifts: "Delete Upcoming Shifts" or "Move
  Upcoming Shifts to OpenShifts" [V]
  ([When I Work: archiving a user](https://help.wheniwork.com/articles/deleting-a-user-iphoneipad)).
- **Connecteam.** Archived employees' past shifts stay, shown translucent. Future shifts become
  "unassigned shift[s]" at the top of the scheduler [V]
  ([Connecteam](https://help.connecteam.com/en/articles/9225998-what-happens-to-an-employee-s-shifts-when-i-archive-or-delete-an-employee)).
- **Deputy.** Find replacement recommends team members "who has the required training for that
  Area". When a rule warns, you can "Roster anyway" [V, via search quote of Deputy help]
  ([Deputy help](https://help.deputy.com/hc/en-au/articles/4688700112015)). Celayix ranks
  suggestions "by suitability" [V, via search]
  ([Celayix](https://help.celayix.com/en/article/shift-replacement-suggestions-in-celayix-assistant)).
- **Lesson.** The departure is asked about once, at the moment it happens. The work turns into
  **open slots** rather than vanishing. Suggestions are filtered by hard rules and ranked by soft
  ones, and a human can override with a visible warning.

### A9. Sports playbooks and staging apps

- **Football playbooks.** Plays are drawn by position. Tackle Football Playmaker offers "custom
  Personnel Groups. Great for play-specific position assignments, depth charts and mass
  substitutions" [V]
  ([App Store](https://apps.apple.com/us/app/id1466963180)). A cut player changes the depth chart,
  not the plays [I].
- **Stage Write (theatre and dance blocking).** You make an icon per performer and drag them into
  formations [V] ([App Store](https://apps.apple.com/app/id1004288568)). No documented
  roster-change workflow was found for it, ArrangeUs, or other formation apps. Absence of evidence,
  not evidence of absence.
- **Lesson.** The playbook world solved this by never binding plays to people. Drill is halfway
  there: drill numbers are spots, and names are optional.

### Anti-patterns seen

- **Silent destructive cascade**: Dorico deletes notes when a player leaves a flow, and Final Cut
  Pro deletes connected clips on ripple delete by default.
- **Breakage found later**: Excel `#REF!`.
- **Heuristic magic with no explanation**: forum threads on condensing that "mysteriously"
  hides staves [I, forum titles in search results].

### Database precedent (one line)

Postgres makes the policy a property of the relationship: `NO ACTION` (the default), `RESTRICT`,
`CASCADE`, `SET NULL`, `SET DEFAULT` [V]
([Postgres: constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)). That
amounts to "hole, block, delete, open spot", declared ahead of time.

---

## Transferable patterns

1. **Two verbs, safe one default.** Offer "leave a hole" and "close up" as named actions with keys.
   Make the hole the default, because it moves nobody else. (A1, A2, A3.)
2. **Role ≠ person.** A leaver frees a spot. The spot keeps its motion as an **open spot**, like an
   open shift. Hand it to someone, keep it as a hole, or remove it. (A5, A8, A9; `marchers` already
   separates drill number from name.)
3. **Ask once, at departure, with a count.** Like Safe Delete, show how many sets and transitions
   use this spot and how many are recipe-placed, before anything changes. Offer cancel, review, or
   apply the default. (A6, A8.)
4. **Policy by scope, overrides by instance.** Rules like "from set 20 on, close up" or "all boxes
   close up, hand-dotted sets keep the hole". Per-set exceptions hold until the next change, like
   Dorico condensing changes. (A4, Postgres.)
5. **How it was placed decides what it can do.** Recipe-placed sets can re-run with N−1, keeping
   hand nudges as overrides. Hand-placed sets can only hold a hole or be handed off. (A3, ADR 0006.)
6. **One queue, two speeds.** Show affected sets as a step-through queue: Next, Accept and next,
   Accept all remaining of this kind. Proposals show on the field in place until resolved. (A6, A7.)
7. **Replay a decision where the situation repeats.** A choice for one set flows through the sets
   where the same form is held or continues, unless they differ. (A6 rerere, A3 overrides.)
8. **Suggest with hard filters, rank with soft ones, allow override.** For a handoff, the filter is
   same section or instrument. The ranking uses step size added, travel, and nearness to the
   leaver's spot. "Use anyway" shows the warning. (A8.)
9. **Keep orphans, never purge.** The leaver's motion stays as a ghost that can be revived when
   the performer returns from injury. Removing is its own deliberate step. (A4 anti-pattern, A5.)
10. **Consequences land in the Issues panel.** New holes in a line, collisions from close-ups, and
    step-size jumps appear as issues (ADR 0009), not as `#REF!`-style surprises. (A2 anti-pattern.)

Every roster change should be one undo group, so the whole restage can be reverted at once.

---

## Part B: would a small LLM add value?

### What it would read

A per-set structured description. For each set: the leaver's spot, the shape recipe if any (kind,
parameters, the spot's role such as end of line, corner or interior), the neighbours, section, the
motion into and out of the set (step size, travel), and the Issues hits. The schema has most of
this: recipes (`timeline_shape_recipes`), drill numbers, sections, and measures with
`rehearsal_mark`. It has no **named show sections** like "opener", "ballad" or "closer", which a
sentence would refer to.

### Cost and speed (checked 2026-11-16)

Claude Haiku 5.5 costs $0.10 per million input tokens and $0.50 per million output tokens, for
prompts up to 100,000 tokens. Above that it's $0.50 and $2.50. Haiku 4.5 costs $1 and $5. The Batch
API halves the price [V]
([Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)).

| Job | Tokens per roster change (est.) | Haiku 5.5 cost |
| --- | --- | --- |
| Sentence to rules, 1 call | ~3k in, ~300 out | ~$0.0005 |
| Classify 60 sets, one call each | ~120k in, ~18k out | ~$0.02 |
| Same, all 60 sets in one prompt | >100k in, so the higher tier | ~$0.10 |

Keep each request under 100k tokens. Cost is negligible for a user with a key. For a hosted
"free" proxy run by the project, it's small but not zero, and it needs accounts and abuse
controls. One short call usually takes about a second to a few seconds [K]. That's fine for a
one-time restage, but too slow inside a drag.

### Job by job

| Candidate job | Deterministic alternative | LLM adds | Verdict |
| --- | --- | --- | --- |
| Classify each set: hole vs close-up vs re-layout | Rules on placement (recipe or hand), the spot's role in the shape, whether a hole is visible (interior vs end of line), Issues hits after a trial close-up | Little. It can't run the geometry and would guess at things code can measure. | **No.** Use heuristics plus a trial run of each option, scored by the Issues checks. |
| Re-lay out the form | Recipe re-run with N−1 (Close up exists in `shapes/`), distributor | Nothing. It can't place dots reliably. | **No.** |
| Explain consequences in words | Templates from the diff: "Set 14: box 8 × 4 keeps a hole at T12. Set 15: line closes up, T13–T16 move 1 step." | Smoother prose and summaries across many sets | **Not needed.** Templates are exact, translatable and offline. |
| Rank which sets need attention | Score by: hole visible, step size added, new collisions, hand-placed set, a feature or solo set (tag) | Weak. "Is this a feature moment?" is taste, and the model can't see the show either. | **No for v1.** Revisit with tags. |
| Sentence → rules ("keep holes in the closer, close up the ballad") | A rule editor: pick a range, a filter (shape kind or section) and a policy | Maps fuzzy names, ranges and intent to the rule schema in one step | **Yes, later, optional.** The only clear win. |
| Suggest who takes the part | Filter by section, rank by added step size and travel | Nothing measurable | **No.** |

### Why the sentence job fits

- Output is a **small, typed rule list**, not positions. Code validates it against the schema
  (structured outputs).
- The designer sees the rules as editable chips before anything runs. It is the same object the
  rule editor makes by hand. If the model is wrong, the cost is one visible, fixable chip.
- Deterministic code applies the rules in one undo group, so undo and replay don't depend on the
  model.
- It saves the most work for the designer who thinks in show sections, not set numbers.

### Constraints and failure modes

- **Offline desktop app.** Electron, often in a band room with no network. The feature must be
  optional, and everything must work without it. The rule editor is the primary UI.
- **Open source, BYO key.** No key is bundled. A user's own key, or a project-run proxy later.
  Settings must say plainly what is sent.
- **Privacy.** Shows contain student names. Send drill numbers and sections only, never names or
  notes. That also shuts out prompt injection through free-text fields.
- **Determinism.** The same sentence can parse differently on different days or model versions.
  Store the rules, not the sentence. Re-running reads the stored rules.
- **Ambiguity.** "The closer" may not exist as a named range. "Close up" may mean along the line
  or toward the centre. The model must return "couldn't resolve X" rather than guess. The UI
  shows unresolved parts.
- **Conflicts.** "Holes in the closer" and "close up all boxes" overlap. Rule priority is a
  deterministic engine concern, not a model one.
- **Silent override of hand work.** Rules must never rewrite a set the designer has already
  decided in the queue, unless they ask.
- **Refusals, outages, model retirement.** Treat each as "the feature is unavailable", not as an
  error that blocks the restage.

### What must exist first

1. **The deterministic roster-change engine.** Open spots, the four policies per set, a trial run
   of each option, and one undo group (patterns 1–7).
2. **A rule schema** for scope, filter and policy, with a rule editor. The LLM only fills this
   schema.
3. **Named show sections**, such as "opener", "ballad" and "closer" mapped to set or measure ranges.
   Without them, neither a person nor a model can say "the closer" to the app.
4. **A compact per-set description** that a test can produce, also useful for exports and
   debugging.
5. **The command registry** (ADR 0008, PR #373, open), so model output becomes validated commands
   rather than ad-hoc writes.
6. **An eval set.** Twenty or thirty real restage sentences with the rules a designer would write.
   Ship only if the model matches the hand-written rules often enough to save time.

### Verdict

- **Not worth it** for classifying sets, ranking, explaining, re-laying out, or picking who takes
  the part. Deterministic rules, recipe re-runs and the Issues checks do these exactly, offline,
  and repeatably.
- **Worth it later** for one job: turning a designer's sentence into the same rules the rule editor
  makes. It should be optional and BYO key, show its output as editable rules, send no names, and
  never move dots itself. It costs well under a cent per use on Haiku 5.5.
- **Order:** engine, then rule schema and editor, then named sections and the command registry,
  then eval, then the LLM.
