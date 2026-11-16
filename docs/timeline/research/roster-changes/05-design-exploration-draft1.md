<!-- cspell:disable -->

# Roster changes 05: design exploration

Status: exploration for the owner, 2026-11-16. Nothing here is decided. It builds on reports 01 to
04 in this folder and on code read on fork main (`e5e2b3a30`) and `pathways/host` (`38be62da0`,
"PH").

**FACT** = I read it in code, an ADR or an issue. **INFERENCE** = reasoned, not run. No tests were
run for this document.

No drill-writing software is used as a precedent.

## The recommendation in one screen

1. **Stop making delete the first step.** Today the only answer to "Jordan quit" is to destroy
   the part. Make the first step **Mark as open**: the part stays, nobody marches it, and nothing
   on the field moves. It can be undone at any time, weeks later, without the undo stack.
2. **A marcher row stays the part.** Don't add a performers table. Add one stored state on the
   row: open. An open part is the placeholder dot for a whole show.
3. **Removing a part is a review, and delete is its last step.** The app lists every formation
   the part stands in. For each one the designer picks Keep the empty spot, Close up or Lay out
   again, with a preview. The app does the geometry. It never picks for the designer.
4. **Adding mirrors it.** Fill an open part (one step, no motion). Or add a part next to someone
   and walk the same list to join each formation.
5. **No LLM in the app.** Make every review action a command. An outside agent can drive
   commands later if that ever proves useful.
6. **Before 0.2.0, with no file change:** a list of empty spots to step through, a delete dialog
   that says what will happen, and Close up for the kinds that lack it. That is useful alone.
7. **After 0.2.0:** the open state (one new column), then the review, then joining, then pathways.

---

## 1. The problem, precisely

"Delete a marcher" hides at least five different jobs. Today's app has one tool for all of them.

### Jobs when someone leaves

| # | Job | What the designer wants | How common | Today |
| --- | --- | --- | --- | --- |
| L1 | **The person left, the part stays, nobody marches it** | Every set keeps its spacing. The band marches around a hole that travels with the part. The part can be given to someone later. | **Most common in season.** Rewriting learned drill costs rehearsal time. | Delete. The spacing does stay (nobody moves), but the part is destroyed. Nothing marks where it was in hand-placed sets. |
| L2 | **Someone else takes the part** | Same dot, same drill, new name. | Common (alternates, late joiners). | Edit the row's name in place. It works because the row is the part (**FACT**, `MarcherForm.tsx:158-170`). Nothing in the UI says so. |
| L3 | **A performer moves into the vacated part** | T7's person now marches T3's drill. T7's old part becomes the hole, because T7's hole is less visible. | Common. This is how designers choose *where* the hole is. | Nothing. Swap marchers trades one moment only (**FACT**, 01 §5). |
| L4 | **The part is removed and the drill restaged** | Set by set: keep the hole, close up, or lay the form out again. | Common **before** the season (written for 48, got 45). Rare in season, and then usually only for sets not yet taught. | Delete, then find every shape by hand, select it, and press Close up where it exists. |
| L5 | **Temporary absence** (injury, one contest) | Print and show the drill without that person. Change nothing. Bring them back later. | Common, short-lived. | Nothing. Deleting and undoing later is not possible once other edits exist (**INFERENCE**, undo is a stack). |
| L6 | **The part leaves the field partway through the show** | On in the opener, gone from the ballad on. | Rare. | Not possible. Every marcher is on the field for the whole show, in the model and in `.ompb` (**FACT**, schema#1 "Marchers off the field"). |

Today's delete is closest to L1, and it does L1 badly. L4, the job the owner described, is not
supported at all. L2 works by accident.

Two things follow:

- **L1, L2, L3 and L5 need no restaging.** They need the part to survive without a person. That
  is a small data change, not a workflow.
- **Only L4 is the hard problem.** And L4 often covers several parts at once (three people quit,
  or four parts are cut before camp). A design that removes one part at a time closes the same
  box three times.

### Jobs when someone joins

| # | Job | What the designer wants | How common | Today |
| --- | --- | --- | --- | --- |
| A1 | **Fill an open part** | The new person takes an existing part. | Common. | Edit a name, if the row still exists. If it was deleted, the Add form offers the old number (lowest free) and the new marcher stands at home with no drill (**FACT**, 01 §3). That looks like a restore and isn't. |
| A2 | **Insert into existing formations** | One more trumpet. Each form grows by one. | Common before the season. | Add, then re-place every shape over the old members plus the new one. |
| A3 | **A new part from scratch** | A soloist, a prop, a new feature. | Occasional. | Add. This is what Add does well. |

A1 is the reverse of L1. A2 is the reverse of L4. The design should make each pair one mechanism.

---

## 2. What a spot is made of, per set

The app can only do mechanical work where it knows the rule that placed the dot. So the unit of
review is not the page. It is **how that moment was authored**.

Words used below:

- **Keep**: leave an empty spot. Nobody else moves.
- **Close up**: the same shape and settings, laid out for one fewer.
- **Lay out again**: a new layout for the new count (a different file count, a re-split).
- **Hand over**: another marcher takes this spot here. Their old spot becomes the empty one.

| How the moment was authored | Keep | Close up | Lay out again | Hand over | What is impossible today |
| --- | --- | --- | --- | --- | --- |
| **Box, Files** | Mechanical. The recipe keeps `spots`; the spot at (row, col) reads empty (**FACT**, `placedBox.ts:117-121`). | Built. Takes the family's version for n, or Short back as a stand-in. **Judgment** at awkward counts. | Built as Re-split, but only from an 8-second toast, and it uses the user's last-used layout, not the box's (**FACT**, 02 §2). File count change also works. | Not built (#358 decision 3). | Choosing which spot is the empty one. |
| **Box, Outline or Spread; Circle** | Mechanical. | Built. Deterministic (same spacings; a circle's radius follows n). | Same as Close up in practice. | Not built. | — |
| **Closed Line or Arc** | Mechanical. | Built. | Fill mode change. | Not built. | — |
| **Open Line, Curve, Arc** | Mechanical. | **Not offered** (**FACT**, `placedBox.ts:289-296`). The math exists: Fit widens the interval, Keep shortens from the pivot. | Same gap. | Not built. | The hole is permanent. In an ordered line the designer cannot say "everyone shift up one". |
| **Group, "as is"** | Mechanical. | **No rule by design.** The spots are fixed points. | No rule. | Not built. | Anything but Keep. |
| **Hand-placed dot, or ungrouped** | Nothing to keep. After a delete there is **no trace** of where the dot was. | By hand only. | By hand only. | Swap marchers, one moment at a time. | Finding these moments at all after a delete. |
| **Converted v0.1.7 page** | As hand-placed. These shows have **no recipes**, so every set is hand-placed to the app (**INFERENCE** from 01: recipes come only from the shape tool). | By hand. | By hand. | By hand. | Any mechanical help, until the designer groups or re-places a form. |
| **Drawn path lane** (PH) | A delete removes the marcher's own transition and its lanes (**FACT**, AP-R3). The owner's "empty spot keeps path and Adjust" does not happen. | Refused when neighbors arrive on lanes: point moves on a laned row refuse (**FACT**, `timelinePointMoves.ts:251` on PH). | Same. | Casting into a laned move is refused (**FACT**, `timelineAssignmentEdits.ts:38-44` on PH). | Keeping the path, and handing it over. |
| **Group path** (PH) | Others keep their lanes. When the last occupant leaves, the route goes (AP-H3). | Same refusal as above. | Same. | Rejoin gives a marcher *a new* lane, not the empty one. | Taking over the vacated lane and its Adjust. |
| **Follow-the-leader trail** (PH) | Built: the member leaves a gap; order and end spots stay (**FACT**, AP-T6). | **Not built.** "Close the gap" would move everyone behind up one slot. Mechanical. | n/a | Recast is refused. | Closing the gap. |
| **Hold** | The leaver's Held marks go with the row. Others keep theirs. | n/a | n/a | n/a | After #1015: a shape missing one member's mark is "partly Held" and refuses edits (**INFERENCE**, 03 §3). This bites when a part is *added* to a held shape. |
| **Carried shape** (no own recipe on the later page) | Decided once, where the shape was placed. It shows through every page it is carried onto (**FACT**, `boxesAt`). | Same: one decision covers the carried pages. | Same. | Same. | A later page that has its own *copy* is a separate decision. |
| **Subset page** | An ordinary page with its own positions. No special case (**INFERENCE**). | — | — | — | — |
| **Prop or equipment item** | A `marchers` row of type `item`. Out of scope. The roster UI must filter them. | — | — | — | — |

Three points the table makes:

1. **"Keep" is the only option that works everywhere.** That is why it must be the default and
   why it must leave a visible, findable mark. Today it leaves neither: holes are counted in the
   shape's label ("N empty") but I found no code that draws one on the field (**INFERENCE** from a
   search of `shapes/placed`, `shapes/editor` and `field/three`).
2. **Mechanical Close up exists for closed shapes only.** Open lines and trails are the two gaps
   worth building. Groups and hand-placed dots will always need the designer.
3. **Judgment is narrow.** It is: Keep or not; which spot is the empty one; and the layout at
   awkward counts (31 in an 8 × 4; a lone back-rank marcher at 33). Everything else is geometry
   the app already has (`leastTravelOnto`, `closedUpParams`, `shape.generate`).

---

## 3. The central model question: performer vs part

**FACT:** a `marchers` row holds `drill_prefix`, `drill_order`, `section`, `home_x/y`, plus three
optional text fields about a person: `name`, `year`, `notes` (`schema.ts:152-188`). Everything in
the show hangs off the row id: assignments, Held marks, recipe members, tags, and soon cue
performers. So the row **is the part**, and the person is three optional text fields on it.

That is why L2 already works, and why delete is so destructive: it deletes the part to say the
person left.

### Options

**A. Keep delete; add a review after it.**

- The review needs to know where the part was. After the delete, hand-placed moments leave no
  trace, and a shape's empty spot must be recomputed from the recipe.
- A restage takes hours, over days. The review state has to live somewhere between sessions. A
  record of "the part that was removed and what is still undecided" is a part that outlived its
  delete. That is option B with worse data.
- L1, L2, L3 and L5 are still unserved.
- Verdict: fine as a **first step** on today's model (it can cover shapes), not as the design.

**B1. Split the tables: `parts` and `performers`.**

- Clean on paper. A person could hold several parts, and a part could record who had it.
- Nobody asked for either. It changes every reader of `marcher.name`, the CSV import, exports
  and the file format, for no behavior the designer sees.
- Verdict: no.

**B2. The row stays the part; add an "open" state.** (Recommended.)

- One new column on `marchers`. Open means: nobody marches this.
- "Jordan quit" becomes **Mark as open**. All data stays: moves, holds, shape membership, lanes,
  Adjust, cues, tags.
- **Fill** clears it and sets the name. **Swap parts** trades two rows' people.
- **Remove part** is the guided review of section 4, and the real delete is its last step.

**C. Parts with a time range ("on the field from count a to count b").**

- This is the only model that serves L6 and "remove from the ballad on" exactly.
- It needs marchers off the field: resolver, every export, `.ompb`, the 3D View, collisions.
- Verdict: out of scope. Name it, park it. B2 does not block it.

### B2 against each concern

| Concern | B2 |
| --- | --- |
| Data model | One nullable or boolean column, added with `ALTER TABLE ADD COLUMN` as `type` was in migration 0024. No table rebuild. |
| Undo | Mark as open, Fill and Swap parts are each one row update, one undo step. History triggers already cover `marchers` (**FACT**, `historyTriggers.ts:15-46`). And none of them *need* undo to be reversible. |
| File format | A new column, so it lands after 0.2.0 with a file version bump. v0.1.7 files open unchanged (no open parts). An older build reads an open part as an ordinary marcher: the hole shows as a dot. That is a safe failure. |
| Exports | Coordinate sheets, PDFs and the mobile export skip open parts by default, with a switch to include them marked as open. Owner decision 6. |
| `.ompb` | **Not a blocker.** The exporter leaves open parts out. Every marcher that is in the file is still on the field for the whole show. `.ompb` blocks option C, not B2. This corrects 03 §5. |
| Cues (ADR 0015 cue model) | `cue_marchers` rows stay with the open part. A person who fills it inherits its cues. That removes the "added marcher doesn't inherit cues" cost for the A1 case. |
| 3D View | Open parts are not drawn (or drawn as a faint marker; owner call). Camera subjects keep working because the id still exists. |
| Shapes | An open part is still a member. The shape has no hole, Recalculate works, and resizing keeps the spot. This is "keep the hole" with identity. |
| Pathways | The slot, lane and Adjust all stay, because nothing is removed. The owner's "empty spot keeps path and Adjust" holds **without** pathways step 12. Fill keeps the same start, so "recast start = where the new person stands" is trivially true. |
| Holds | Held marks stay. A Held-whole shape stays whole. |
| Checks | Collisions and step size skip open parts. |
| What the designer sees | A hollow dot with its label on every set. A count in the Marchers list ("48 marchers, 2 open"). Open parts sort to their section with an "open" chip. |

### How this relates to #358 and placeholder dots

There are **two kinds of emptiness**, and the design needs both. They must not share a word.

| | Empty spot | Open part |
| --- | --- | --- |
| What it is | A place in one shape that nobody stands on | A whole-show part that nobody marches |
| Lives in | The recipe (`params.spots` > members; #358, #504) | The `marchers` row |
| Has identity across sets | No | Yes: a label, moves, holds, cues |
| Made by | A member leaving, or (later) drawing a shape with spare spots | Mark as open, or adding a part with no person yet |
| Filled by | A marcher joining that shape (#358 decision 2 and 3) | Fill |

- "Placeholder dots" as the owner described them could mean either. A box of 16 spots drawn
  before anyone is assigned is the left column (#358). Writing a show for 48 before the names are
  known is the right column, and **it already works today**: a marcher with no name is a
  placeholder. B2 only adds the state that says "and nobody will march it".
- #504 says "an empty spot is a recipe slot with no marcher. It's not a separate concept." B2
  keeps that true. An open part standing on a spot is a marcher on a spot. Only when the part is
  *removed* does the spot become empty, and then #358 decision 4 applies as written.
- No decided position is reversed. "Leaving a shape leaves a hole, filling is an explicit
  command" is exactly what Remove does at each stop where the designer picks Keep.

### Risks of B2

1. **It can look too small.** It is one flag and a hollow dot. Its value is that it makes four
   of the six leave jobs safe, and gives the review something to work on across sessions.
2. **Designers may leave open parts forever** and keep placing ghosts in new sets. That is
   their call. The Marchers list count keeps it visible.
3. **Mixed outcomes need the review, not the flag.** "Keep the hole in sets 1 to 30, close up
   after" cannot be said with a whole-show part. Section 4 handles it as Remove with Keep chosen
   for sets 1 to 30. The identity is lost in those sets, as #358 already accepts.
4. **Wording.** "Open", "vacant", "unfilled", "empty", "hole" must be sorted out before any UI.
   The owner picks (decision 3).
5. **Every all-marchers loop must decide** whether open parts count. The `type = 'item'` filter
   is the precedent, and it took a sweep. This is the real cost of the feature.

---

## 4. The restaging workflow

### From "Jordan quit" to done

**Step 0. The designer selects T3 and chooses how it leaves.** In the Marchers list row menu, the
inspector, the field right-click menu and the command palette. No shortcut for the destructive
ones.

| Choice | What happens | Undo |
| --- | --- | --- |
| **Mark as open** (default, first in the menu) | T3 turns hollow on every set. Nothing moves. | One step, and reversible forever with Fill. |
| **Fill…** / **Swap parts with…** | A name goes on the part, or two parts trade people. | One step. |
| **Remove part…** | Opens the review below. Nothing changes yet. | — |

The Remove entry is disabled with a reason while a review of another selection is open.

**Step 1. Before anything changes, the app says what the part touches.** The Safe Delete pattern
from 04 A6. One panel, no modal chain:

> T3 stands in 41 formations. 28 can close up. 6 open lines and 3 groups can only keep an empty
> spot. 4 are hand-placed. 2 arrive on drawn paths.

Three buttons: **Review them** (default), **Keep every empty spot and remove**, **Cancel**. The
second is today's delete, now honest about what it leaves.

**Step 2. The review is a list of stops, not of pages.**

- A **stop** is one formation the part stands in: one recipe and every page it is carried onto,
  or one stretch of hand-placed pages. A decision on a carried shape is made once, where it was
  placed, and it shows on every carried page because carrying is derived from positions
  (**FACT**, `boxesAt`). No propagation code is needed.
- A later page that saved its own copy is its own stop. When the copy has the same kind, settings
  and members, its row starts with "Same as set 12" selected.
- After #1015 (Held shapes), an edit lands where the hold grows out of. A shape that is only
  partly Held shows its mechanical options disabled, with that reason.
- Several parts can be reviewed together. The stops are grouped by formation, so a box that loses
  three members is closed up once, for n − 3.

**Step 3. At each stop the designer sees a preview and picks.**

- The field shows the stop with the empty spot ringed, and each option as a preview: where
  everyone would stand, and thin lines from where they stand now. Nothing is written. This is
  the paste rule from #961: always a preview, Enter places, Escape leaves it.
- Each option shows what it costs, measured, not guessed:

  | Option | Moves | Longest move | Step size into / out of this set | New collisions |
  | --- | --- | --- | --- | --- |
  | Keep | 0 | — | unchanged | 0 |
  | Close up | 9 | 2 steps | 6.2 → 6.5 / 7.0 → 7.4 | 0 |
  | Lay out again (7 × 4 + 3) | 23 | 5 steps | … | 1 |

  The step-size and collision checks exist today as separate systems (**FACT**, ADR 0009 context).
  The preview runs them on the trial positions.
- Options that cannot run are shown disabled with the reason ("An open line can't close up yet",
  "3 marchers arrive here on a drawn path"). No toast.
- **Keep is always first and never moves anyone.** The app preselects Keep. It never preselects
  an option that moves people.
- **Which spot is empty** is a per-stop choice too: drag a marcher into the empty spot and their
  old spot becomes the empty one (#358 decision 3). This is how a designer puts the hole in the
  back corner.

**Step 4. Batching is the designer's, at decision time.**

- After a choice: **Next**, or **Do the same for the 11 stops like this one**. "Like this" means
  the same kind, the same fill mode and the same options available. The app lists them first.
- A filter narrows the list: whole show, from the playhead on, a page range, one section's
  shapes. "From here on" matters most: in season the taught sets keep their holes and only the
  untaught ones change.
- There is **no stored policy**. A rule that applies itself later is the per-shape `onLeave`
  setting the owner reversed on 2026-10-30, at a larger scale. A batch is a choice made once,
  on a list the designer can read.

**Step 5. Each decision is one edit and one undo step.**

- Close up and Lay out again write through the same code paths the shape editor uses today. The
  show is valid after every stop. The designer can stop, close the app, and come back.
- A batch is one undo step.
- Keep writes nothing. It is ticked. Ticks are per-user review state keyed by the show file's
  path, the pattern ADR 0009 D-5 already uses for "seen". When Issues exists, ticks become its
  dismissals (below).
- Not one undo group for the whole restage. 04 proposed that. A review can span days; one undo
  that wipes all of it is a trap, and it breaks "one command, one undo step".

**Step 6. Finish.** When every stop is decided, the panel offers **Remove T3**. That runs today's
`deleteMarchers`: one undo step, the kept spots become empty spots in their recipes by the
existing cascade. Until then T3 is still an open part and the whole thing can be abandoned with
nothing lost but the close-ups already made (each undoable).

### What the designer sees

- **Field:** open parts are hollow dots. Empty spots are rings (this needs drawing; #358's open
  question). In review, the current stop's preview. Where a stop has been closed up, the leaving
  part's old position shows as a ghost only while the review panel is open, using the isolation
  ghost look that exists.
- **Timeline:** while a review is open, a mark on each page flag with an undecided stop. Nothing
  when it is closed.
- **Panel:** a list like a spell-check: the stop's name ("Set 14: box 8 × 4"), the chosen option,
  and the counts. Next and Previous have shortcuts shown as keycaps. Remove has none.
- **No toasts** for any of it.

### Where Issues (ADR 0009) fits

ADR 0009 is **proposed**, not accepted, and #599 is not started (milestone 0.3) (**FACT**).

- The review is a **task** with a start and an end. Issues is a **standing report**. They are not
  the same panel.
- Issues should carry two heads-up checks once it exists: "open part" (a part nobody marches, on
  these sets) and "empty spot" (a shape with spare spots). Dismissing one is "it's intentional",
  which is the Keep tick. Then the per-user ticks can go.
- A trial close-up that causes a collision or a step-size jump is an ordinary issue after it is
  placed. The preview shows it first.
- The review must not wait for Issues. It runs the two existing checks on its own trial
  positions.

### A known limit, stated

Close up works from where people stand **in that set**, not from the set before (**FACT**, 02 §5).
So each stop changes as little as possible in its own picture. It does not minimize the walk
between two closed-up sets. After several close-ups in a row, a pair of marchers may cross who
did not before. The preview's step-size and collision columns show it. Fixing it is **Reassign**
from the previous set, an explicit command under #358 decision 5 and the #960 rule. The review
should offer it per stop once #960 is decided, never run it by itself.

### Adding

| Job | Flow |
| --- | --- |
| **A1 Fill** | The Add dialog leads with open parts in that section: "Fill T3 (open)". One step. No motion. The lowest-free-number default stops pretending to restore a deleted part. |
| **A3 New part** | Today's Add. Unchanged. |
| **A2 Insert** | **Add next to…** The designer picks a marcher to stand beside. The new part starts as a copy of that marcher's drill, offset by a chosen interval, so it is in the right neighborhood on every set. Then the same review runs, with the stops being that neighbor's formations. |

At each A2 stop:

| Option | Meaning | State |
| --- | --- | --- |
| **Stay beside** | Keep the offset copy. Nobody else moves. | Always available. The default. |
| **Take the empty spot** | The shape has a spare spot; the new part takes the nearest. | #358 decision 2. Not built. |
| **Grow by one** | The shape is laid out again for n + 1 with the same settings. | `shape.generate(params, n + 1)` exists; paste (#961, PR #984) uses it. **Judgment** at awkward counts. No decided rule yet (decision 8). |

Copying a part is mechanical for straight moves and holds. On a drawn group path it is Rejoin
(built on PH). On a trail it is "take the lowest vacant slot or go last". A copied Held mark
keeps a Held-whole shape whole, which avoids the `shapePartlyHeld` refusal noted in section 2.

---

## 5. An LLM (for example Haiku)

I agree with 04's verdict and would go one step further: **no LLM feature in the app at all, for
this problem.**

My reasoning, separate from 04's:

1. **The judgment is visual and it is small.** After the mechanical work, what is left is "does
   this picture look right with a hole here". A text model cannot see the picture. A vision model
   could, but the designer decides each stop in seconds with a good preview, and there are a few
   dozen stops. The most an LLM could save is minutes, on the part of the job the designer
   least wants to give away. The owner's own words: "we might not make a decision that
   intuitively a designer would want."
2. **Everything measurable is better measured.** Which stops matter, how far people move, whether
   a hole is interior or on an edge, step-size change: all exact, offline, repeatable, free.
3. **The one job 04 keeps (a sentence into rules) depends on a rule editor I recommend not
   building.** Section 4 replaces stored policies with a filter and a batch button. Without a
   rule schema there is nothing for the model to fill in. It also needs named show sections
   ("the closer"), which do not exist in the schema (**FACT**, 04 Part B).
4. **The right hook already has a home.** Taste says every feature is a command (#357). If the
   review's actions are commands (`mark open`, `review next`, `close up stop 12`, `same for
   stops like this`), then any agent a user brings can drive them, one request being one undo
   step, with previews handled by whatever #612 decides. That costs the roster work nothing
   extra and commits the app to no key, proxy, privacy text or model upkeep.

On cost: 04's prices are right as of this month (**FACT**: Haiku 5.5 is $0.10 in and $0.50 out
per million tokens up to 100K-token prompts; Haiku 4.5 is $1 and $5). Cost was never the issue.

If the owner still wants a trial later, the only honest experiment is: **input** = the stop list
as structured rows (kind, count, options, measured costs, drill numbers only, no names) plus one
sentence from the designer; **output** = a proposed option per stop, shown as preselected rows
the designer steps through as usual. It must exist first: the review, its commands, and 20 to 30
real restages with the designer's own choices to score against. I would expect it to lose to
"Keep by default plus batch".

---

## 6. What must be finished first

### Hard blockers, in order

| # | Prerequisite | Why | Issue | When |
| --- | --- | --- | --- | --- |
| 1 | **Owner picks the model** (decision 1) and the words (decision 3) | Everything else depends on it | new | now |
| 2 | **An ADR for the open state** | It is persistent data and a file-format change (`docs/conventions/architecture-decisions.md`) | new | before step 6 of the plan |
| 3 | **0.2.0 ships** | File-format changes land after it, with an upgrade path | — | gates plan steps 6 on |
| 4 | **Empty spots draw on the field** | "Keep" must be visible. #358's last open question. | #358 | can be 0.2.0 (drawing only, no data) |
| 5 | **A sweep of every all-marchers loop** for the open state | Exports, checks, 3D, counts, selection | new | with step 6 |
| 6 | **#504 recipes onto the transition, then #358's spot rules** | Hand over, "which spot is empty", Take the empty spot. Doing #358 before #504 means building it twice. #504 also clears undo history on conversion, so it should not land in the middle of a restage. | #504, #358 | 0.3 (as milestoned) |
| 7 | **#960 the assignment rule** | Reassign from the previous set; Grow by one's who-goes-where | #960 | before plan step 9 |
| 8 | **#961 / #984 paste keeps spacing** | The `generate(params, n)` path for a new count, used by Grow by one | #961 (0.2.0), PR #984 | before plan step 9 |

### Needed only for the pathways part

| Prerequisite | Why | Issue |
| --- | --- | --- |
| `pathways/host` merges to main | Nothing below exists on main | #640 |
| Step 12: range occupancy, casting with lanes (AP-R16) | Handing one move's spot to **another existing** marcher; from-a-set-on handover. Not needed for Mark as open or Fill. | #653. Note the ticket's text covers only "rejoin after a takeover". The wider scope is in the plan row on PH, not the ticket. |
| Step 17: split and merge with paths | Close up where members arrive on a group path | #658 |
| Step 27: follow-the-leader Adjust | Only if a trail's Adjust must survive a closed gap | no ticket |
| #900 Detach provenance | Sweeping a removed Detached member's copied route | PR #900 |
| A decision on point moves on laned rows | Close up moves destinations; today that refuses | new |

### Nice to have

| Item | Why | Issue |
| --- | --- | --- |
| #1015 Held shapes | Changes where a carried shape's edit lands. The review works either way but its "stop" rule must follow whichever is merged. | PR #1015 |
| Issues panel | Replaces per-user Keep ticks with dismissals | #599, ADR 0009 (0.3) |
| Command tree | Review actions as commands | #357 (paused) |
| Cue storage | Fill inherits cues for free under B2; nothing to build | PR #1010 |
| `.ompb` | No change needed for B2. Needed only for option C. | OpenMarch/schema#1 |
| Named show sections | Only for a sentence-to-choices LLM trial | none |

### Housekeeping that will bite

- **ADR number clash (FACT):** main has `0014-desktop-updates` and `0015-cue-model`; PH has
  `0014-moves-follow-drawn-paths` and `0015-lanes-on-slots`. Cite pathways ADRs by name. The
  open-state ADR needs a number neither branch uses.
- **File versions (FACT, 03):** PH and its open PRs use 11 to 17. The open-state bump must pick
  a number no lab build wrote.

### Bugs and gaps found in 01 and 02, worth fixing regardless

| Item | Label |
| --- | --- |
| Delete leaves empty spots with no notice | FACT |
| Holes are counted in text but not drawn | INFERENCE (search only) |
| The Add form offers a deleted marcher's number, which looks like a restore | FACT |
| Re-split is reachable only from an 8-second toast and uses the last-used layout, not the box's | FACT |
| No Close up for an open Line or Arc; Recalculate's "close up first" tooltip may still show there | FACT / INFERENCE |
| A move whose only marcher was deleted stays as an empty clip | FACT |
| `view3d_cameras` keeps a deleted marcher's id, outside undo | FACT |
| Stale comments: `marcher.ts:222-236` ("timeline mode", "page mode"), `useMarchers.ts:105` | FACT (I re-read the first) |
| The Marchers list sends delete and edit as two mutations without waiting for the first | INFERENCE |
| A recipe saved without `spots` would read as n − 1 with no hole after a delete (`spots ?? 0`) | INFERENCE, from `placedBox.ts:117-121`; 02 says every placement writes `spots` |
| Swapping two members of a placed shape may drop both from it (each is off its own stored spot) | INFERENCE, from `boxesAt` and `membershipAfter`; needs a test |

---

## 7. A phased plan, one lab build per step

Steps 1 to 5 need no file change and can ship before 0.2.0. Each is testable alone.

| Step | What ships | The lab test asks | Needs |
| --- | --- | --- | --- |
| **1** | **Empty spots, drawn and listed.** Rings on the field for a shape's empty spots. A list of every shape that has them, by set, with Next and Previous, and the Close up that exists. Works for holes from any cause, not just delete. | Delete someone from the example show. Can you find every place it mattered? | Decision 4 (how a ring looks) |
| **2** | **An honest delete.** The confirm says what the marcher stands in, by kind, and offers "Review empty spots". The Add form stops implying a restore. Stale comments fixed. | Did the dialog tell you what would happen? | Step 1 |
| **3** | **Close up for open lines and arcs.** And Re-split as a real option next to Close up, using the box's own layout. | Remove the third marcher from a line of 12. Close it up. | — |
| **4** | **Previews with costs.** Each option at a stop shows the moves, longest move, step-size change and collisions before it is placed. Enter places, Escape leaves. | Which option would you pick, and did the numbers help? | Step 1 |
| **5** | **Swap parts.** Two marchers trade their whole drill (the people trade rows). | Put your strongest player on T3's drill. | Decision 5 (do labels follow the person) |
| | **— 0.2.0 —** | | |
| **6** | **Mark as open and Fill.** The new column and ADR. Hollow dots. Exports, checks and the 3D View skip open parts. The Add dialog leads with Fill. | Jordan quit on Monday and a new student took the spot on Friday. | Blockers 1, 2, 3, 5 |
| **7** | **Remove part: the review.** Stops, Keep preselected, the batch button, the filter, several parts at once, Remove as the last step. | Cut three parts from the example show before camp. | Steps 1 to 4, 6 |
| **8** | **Choose the empty spot.** Drag a marcher into an empty spot; drag onto a taken spot to swap. | Put the hole in the back corner. | #504, #358 |
| **9** | **Add next to… and the join review.** Stay beside, Take the empty spot, Grow by one. | One more trumpet joined. Put them in the show. | #358, #960, #984, decision 8 |
| **10** | **Reassign at a stop**, from the previous set. | After three close-ups in a row, fix the crossing. | #960 |
| **11** | **Pathways.** Close up with lanes, close a trail's gap, hand one move to another marcher. | — | PH merged, steps 12 and 17 |
| **12** | **Issues checks** for open parts and empty spots, replacing the per-user ticks. | — | #599 |

Step 1 is the right first step because it helps with holes the app already makes silently
(delete, split by marchers, merge, dragging off a spot), it needs no decision on the model, and
every later step reuses its list and its rings.

---

## 8. Owner decisions needed

Recommendation first on each line.

1. **The model: keep the row as the part and add an open state (B2). Yes.** Yes means "Jordan
   quit" stops destroying anything and Remove becomes a review. No means delete stays first and
   the review can only cover shapes (plan steps 1 to 4 and nothing after).
2. **Two kinds of emptiness, with two names: an empty spot in a shape (#358) and an open part.
   Yes.** No means choosing one: only empty spots (no L1, L2, L5), or only open parts (#358's
   "box of 16, filled later" has nowhere to live).
3. **Words.** I suggest "open" for a part and "empty spot" for a shape, and dropping "hole" from
   UI text. The owner picks; nothing ships with a word before this.
4. **Empty spots are drawn on the field as rings. Yes.** No means Keep stays invisible outside
   the shape's label, and step 1 is only a list.
5. **Swap parts moves the people, and the drill labels stay with the drill. Yes.** No means the
   labels travel with the people, which renumbers the chart the band learned.
6. **Exports and the 3D View leave open parts out by default, with a switch to show them marked.
   Yes.** No means open parts print like anyone else, and L5 (one contest) needs a manual step.
7. **No stored restaging policy; batching happens in the review. Yes.** No means building a rule
   editor and a rule schema, and accepting rules that act on sets the designer has not looked at.
8. **Adding into a full shape: the default is Stay beside, and Grow by one is an explicit
   option. Yes.** This is new; #358 only covers joining a shape that has a spare spot. No means
   an added marcher changes every shape it joins without being asked.
9. **Each review decision is its own undo step, and a batch is one. Yes.** No means one undo
   group for a whole restage, which one stray undo can wipe.
10. **Remove has no shortcut; Next, Previous and placing an option do. Yes.**
11. **After a restage, the old part is deleted, not archived. Yes.** A person who returns after
    their part was closed up is an Add next to… job. No means a third state (archived) and a
    restore that must undo close-ups made weeks earlier, which I don't think can be made honest.
12. **No LLM feature for this; review actions are commands. Yes.** No means first building the
    review and collecting 20 to 30 real restages to score a model against.
13. **Parts that leave the field partway through the show (option C) are parked. Yes.** No makes
    this a much larger project that touches the resolver, every export and `.ompb`.
14. **Order: #504 before #358's spot rules. Yes.** No means building drag-to-fill on move-keyed
    recipes and again after #504.

One position I would ask the owner to look at again, not reverse: **"empty spot keeps path and
Adjust" (pathways Q1).** As built, it only applies to stored-shape and follow moves. In shows
made in the app, a deleted marcher's transition and lanes are deleted with it. B2 gives the
intent of Q1 (the path waits for whoever comes next) by keeping the part. If B2 is accepted, Q1
needs no new work for the roster case, and the "compaction vs Q1" question 03 raises goes away.

---

## 9. Where I disagree with the input reports

| Report | Claim | My reading |
| --- | --- | --- |
| 03 §1 | App-made shapes write **shared** shapeless transitions, so a deleted marcher's slot is compacted in most shows. | 01 says every move made in the app is the marcher's **own one-slot** transition, and only converted v0.1.7 pages are shared. The code agrees with 01: `timelinePointMoves.ts:85` writes "its own one-slot transition". So in app-made shows the transition and its lanes are deleted (AP-R3), not compacted. The outcome 03 reports is the same (Q1 does not apply), the mechanism is different. **FACT** for the writer; **INFERENCE** that no other writer makes shared ones. |
| 03 §2 | Step 12 is **blocking** for roster changes. | Only for handing a spot to another existing marcher and for from-a-set-on changes. Mark as open, Fill, Swap parts and the review of shapes need none of it. |
| 03 §2 | "A decision on compaction vs Q1" is needed. | Not if the part is kept (B2). Nothing is vacated. |
| 03 §5 | `.ompb` "cannot express a placeholder", listed as a decision needed. | True, and not needed. The exporter omits open parts. It blocks mid-show entry and exit only. |
| 03, the brief | #653 is "pathways step 12". | The ticket's text is only "rejoin a path after a takeover". Range occupancy and AP-R16 are in the PH plan row, not the ticket. Someone reading #653 alone would under-scope it. |
| 04 summary 4 | "OpenMarch already has this split" between role and person. | Half. The row is the role, which is why renaming works. But there is no way to say "nobody", and delete removes the role. The split exists in the data and not in any command. |
| 04 pattern 4 | Policies declared by scope, with per-instance overrides. | I would not store policies. It is the reversed `onLeave` setting at show scale, and it needs a rule editor. A filter plus a batch button in the review gives the same result on a list the designer has read. |
| 04, closing line of Part A | "Every roster change should be one undo group." | No. Open, Fill and Swap are one step each. A restage is many steps over days. |
| 04 pattern 1 | Both verbs "with keys". | Keep and Close up inside the review can have keys. Removing a part cannot (owner rule on destructive actions). |
| 04 pattern 9 | Keep the leaver's motion as a ghost track that can be revived. | Yes while the part is open. Not after a restage: once shapes have closed up, the old drill no longer fits any set, and reviving it would be wrong, not safe. |
| 04 Part B | The sentence-to-rules job is worth an LLM later. | It depends on the rule editor I recommend against, and on named show sections that do not exist. The command tree is the cheaper hook. |
| 01 §2 | A placed shape "keeps a hole" after a delete (marked INFERENCE, untested). | I read `boxesAt` and `placedOf` and agree. But the hole is a number in the label, not a mark on the field, so "shows a hole" overstates what the designer sees. |
| 02 §4 | N − 1 is "deterministic" for most kinds. | Agreed for the geometry. The table leaves out the cost between sets: independent close-ups don't minimize the walk from one closed-up set to the next (section 4, "A known limit"). |
| 02 summary 5 | Re-split is "built". | Built, but only reachable from a toast and tied to the user's last-used layout. For a review it has to be rebuilt as a first-class option (plan step 3). |
