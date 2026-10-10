<!-- cspell:words Turpin Kumar Hopcroft Karp Bertsekas Jonker Volgenant Garfinkel Derigs Gabow Tarjan ArrangeUs uncrossed IJRR ICRA travelled Zimmermann -->

# Remap a move: who goes to which spot

Status: research, 2026-10-10, on branch `timeline/remap-research` (based on `timeline/shapes`).
Nothing here is decided. App code was only read; the prototype lives in [proto/](proto/).

## The request

> There is an idea of triggering a remapping from the previous page to the next. Meaning, the
> designer might know what shape they want both of the forms to be in, but they don't necessarily
> care what marcher ends up in which position, and they want it to be the transition that makes
> more sense. This is going to have a lot of logic that is needed, and some edge cases we need to
> test, but the capability should at least exist.

In timeline terms: the selected marchers stand in form **A** at the start flag S, and the designer
has drawn form **B** as a set of spots at the playhead P. **Remap** keeps the set of spots exactly
as drawn and only changes which marcher takes which spot, so that the move from S to P is the
cleanest one.

**Evidence labels:** **[V]** read on the cited page during this research; **[V-02]** verified in
[shapes/02-prior-art.md](../shapes/02-prior-art.md); **[S]** from a secondary source (named);
**[K]** general knowledge, not re-read; **[I]** inferred; **[P]** measured with the prototype in
[proto/](proto/) ([results.md](proto/results.md)).

## Summary

1. **Remap is one solver with two entry points.** The Shape tool's Order "Nearest" and a new
   "Remap move" command answer the same question (origins at S, spots at P), so they should call
   the same function. The shape tool decides the spots and then who takes them; Remap keeps spots
   the designer already placed by any means (shape, drag, align, import) and only re-deals them.
2. **The objective should be least squared travel (CAPT), with ties broken toward drill order.**
   It is the only objective in the prototype with no pair passing closer than the spacing of the
   forms in every case where both forms are evenly spaced [P], which is the CAPT guarantee
   (Turpin, Michael and Kumar 2014) [S]. Plain total distance, which `timelineCasting.ts` uses
   today, gives the same total travel but hides huge ties: on a plain block shift it sent
   marchers through each other (71 pairs within 1 step, worst step 3.0 to 5 instead of 8.9 to 5)
   [P]. Pyware 3DX's "closest first" proximity matching [V] was the worst in every mixed case [P].
3. **Step size is the drill constraint, and it falls out of the timeline model.** Every marcher in
   a remapped move travels for the same counts, so stride = distance / counts. Minimizing the
   longest stride (bottleneck assignment) is cheap (about 150 ms at 400 marchers [P]) but it can
   give up the collision guarantee; it belongs in a tie-break or an optional cap, not the default.
4. **Today's Shape tool "Nearest" measures from the wrong place.** It reads where the canvas
   draws marchers now, which is the arrival at P (`marchersOnCanvas` in
   `shapes/canvas/shapeCanvasContext.ts`). When the marchers already have a move ending at P,
   Nearest minimizes travel from their old destination, not from the start flag [I, from code].
   Remap must read origins at S.
5. **The write is already there.** A remap is a permutation of arrival points among the selected
   marchers, written through `transformMarchersInSelection` → `moveMarchersInTarget`, so the edit
   window, isolation, skip-if-unchanged, pass-through toasts and one-step undo all apply.
   No schema or resolver change is needed for v1 [I, from code].
6. **Pins and "stay if you're already there" break the guarantee.** Holding marchers that already
   stand on a spot of B made a block shift collide (64 close pairs) and a line slide send one
   marcher straight through 15 others [P]. Pins are a constraint the designer asks for, so they must
   come with the collision warning in the preview.

## 1. What "the transition that makes more sense" means to drill writers

### 1.1 What writers judge a transition by

From the shapes research (02, 04) and drill practice [K], a transition "reads" well when:

- **Step sizes are reasonable and even.** Writers talk in "X to 5" (steps per 5 yards). 8 to 5
  (22.5 in) is the standard stride; 6 to 5 and 5 to 5 are big; 4 to 5 (45 in) is about as big as
  is practical. OpenMarch already warns at 45 in
  (`FieldProperties.DEFAULT_STEP_SIZE_WARNING_THRESHOLD_INCHES`) and shows step sizes in the
  inspector (`useTimelineStepSizes`). The **worst** marcher's step size limits the move, not the
  average.
- **Nobody collides.** Interlocking files (marchers passing through a form) are common and
  deliberate, but marchers must pass each other at a safe interval, not hit.
- **Paths don't tangle for no reason.** Crossing paths are fine when timed, but random crossings
  look messy in the preview and are hard to clean in rehearsal.
- **Neighbors stay neighbors, sections stay together.** It keeps sound blend and makes the drill
  easier to learn ("follow your guide"). Sections usually want a region of the next form.
- **Charted order is kept when asked.** For a line or arc, "trumpets 1–8 left to right".
- **Some marchers are fixed.** Soloists, a guide, props, or a section the writer already set.

These pull against each other. "Shortest" and "neighbors kept" agree for line-to-line moves and
disagree for block-to-circle moves (§3).

### 1.2 Prior art

| Tool / field                                      | What it does                                                                                                                                                                                                                                                                               | Evidence                                                                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pyware 3D, Matching Lines                         | Lines from each performer to its new dot. "Proximity Match" "assigns performers to travel to the closest position in the new form", and the guide warns "the closest transition may not always be the cleanest, but is a great start". Also Flip, Predict Next, Swap, Shift.               | [V] [Matching Lines](https://www.pyware.com/guide/3d/9.0/en/topic/matching-lines)                                                                                                                                                |
| Pyware 3DX, Assign mode                           | Group Order (with a flip arrow), **Proximity Matching** "based on the closest performers first. Then continually check for the next closest performer until all performers are matched" (a greedy match, not a global optimum), Customize (click to match), Clear.                         | [V] [3DX Draw Mode Ribbon](https://www.pyware.com/guide/3dx/1/en/topic/block-tool)                                                                                                                                               |
| Pyware Morph                                      | Reshapes a form with handles; performers keep their order (identity assignment).                                                                                                                                                                                                           | [V-02]                                                                                                                                                                                                                           |
| EnVision                                          | Drag a group onto a form to attach; a separate Selection Ordering Tool (Sort by Form, Horizontal, Vertical, Reverse, A-B Straight, A-B Loop, Slide Order). No automatic optimal match found.                                                                                               | [V-02]; auto-assign not found in this search                                                                                                                                                                                     |
| Ultimate Drill Book                               | No documentation of automatic assignment found.                                                                                                                                                                                                                                            | not found                                                                                                                                                                                                                        |
| ArrangeUs (dance formations)                      | Presets applied to the selected dancers with automatic "positions matching" (v2.15.2 "improved presets positions matching"), plus a "circular swap".                                                                                                                                       | [V-02]                                                                                                                                                                                                                           |
| CAPT (Turpin, Michael, Kumar, IJRR 33(1) 2014)    | Interchangeable robots, synchronized straight-line trajectories. Choose the assignment that minimizes the **sum of squared distances** (Hungarian, O(n³)); if every two starts and every two goals are at least 2√2·R apart, the straight paths are collision-free for robots of radius R. | [V] abstract on the [RI page](https://publications.ri.cmu.edu/capt-concurrent-assignment-and-planning-of-trajectories-for-multiple-robots); objective and 2√2R condition [S] from patent US 10,884,430 summaries; [P] matches it |
| Turpin et al., ICRA 2013 / Autonomous Robots 2014 | The assignment "minimizes the maximum distance travelled" (bottleneck) with O(N³) bound.                                                                                                                                                                                                   | [S] search summary of the [RI page](https://www.ri.cmu.edu/?p=17144)                                                                                                                                                             |
| Linear bottleneck assignment                      | Minimize the largest cost in a perfect matching. Threshold methods (Garfinkel 1971: raise a threshold until a perfect matching exists), augmenting-path methods (Derigs and Zimmermann), Gabow–Tarjan O(n^2.5·√log n).                                                                     | [S] [arXiv 2008.10804](https://arxiv.org/pdf/2008.10804) and search summaries                                                                                                                                                    |
| Minimum-length (sum of distances) matching        | The optimal segments never properly cross (swap two crossing segments and the triangle inequality makes the total shorter).                                                                                                                                                                | [K]; [P] 0 crossings in every case                                                                                                                                                                                               |

What the prior art adds up to: drill tools offer **order-based** matching (group order, flip,
drill number) and a **proximity** match that is greedy and that Pyware itself calls "a great
start", plus manual swap. None documents a global optimum or a step-size or collision readout of
the match. Robotics has the theory for "who goes where so straight synchronized paths don't hit",
and its assumptions (everyone leaves together, arrives together, straight line) are exactly a
`direct` move in a timeline window.

## 2. Objectives and trade-offs

Let marcher i start at aᵢ (its position at S), spot j be bⱼ (at P), the window be c counts, and
the assignment be a permutation σ. All of these are solvable exactly at drill sizes.

| Objective                                       | Formula                                              | What it gives                                                                                                                                                 | What goes wrong                                                                                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drill order / keep order                        | sort both, match in order                            | Charted order; predictable; neighbors kept on paths                                                                                                           | Ignores geometry: reversed numbering crosses every path (120 crossings, 48 near hits on a 16 line-to-arc) [P]                                                                 |
| Greedy closest first (Pyware 3DX Proximity)     | take the nearest free pair, repeat                   | Simple; the "closest" marchers barely move                                                                                                                    | The last few marchers get leftovers: a line sliding one interval sends one marcher 32 steps through the line (4 steps/count, 15 collisions) [P]                               |
| Sum of distances (casting today)                | min Σ‖aᵢ − b_σ(i)‖                                   | Least total travel; never crossing segments                                                                                                                   | Massive ties on grids. Non-crossing ≠ non-colliding: a marcher can overtake along the same line. Block shift: 71 pairs within 1 step, worst 3.0 to 5 [P]                      |
| **Sum of squared distances (CAPT)**             | min Σ‖aᵢ − b_σ(i)‖²                                  | Collision-free straight paths when both forms are evenly spaced; spreads travel evenly (penalizes long moves); equals "translate, then match" for pure shifts | Allows crossing paths (timed so nobody meets); exact ties on symmetric forms (30 different answers in 30 shuffles on a line-to-perpendicular-line move) [P]                   |
| Bottleneck (min longest move = worst step size) | min (max over i of ‖aᵢ − b_σ(i)‖) / c                | Directly the drill constraint ("nobody bigger than 6 to 5")                                                                                                   | Alone it is very degenerate (only the longest move matters). Lexicographic "bottleneck, then squared" lost the collision guarantee in 2 of 12 cases (2 and 8 close pairs) [P] |
| Lexicographic combos                            | e.g. squared, then bottleneck, then order            | Keeps CAPT's guarantee and picks the nicer tie                                                                                                                | Which secondary wins is taste (see §3.3)                                                                                                                                      |
| Crossing / near-pass penalties                  | add a pairwise term                                  | Exactly what writers see                                                                                                                                      | Pairwise terms make it a quadratic assignment problem (NP-hard [K]); only local search (2-swap) is practical                                                                  |
| Section or neighbor cohesion                    | add a pull to a section region, or solve per section | Sections stay together                                                                                                                                        | A pull needs to know where the section should go; per-section needs spots per section                                                                                         |

**Step size from the timeline model.** In a window [S, P) every remapped marcher leaves at S and
arrives at P, so its stride is ‖aᵢ − b*σ(i)‖ / c steps per count and its "X to 5" is
8c / ‖aᵢ − b*σ(i)‖ (in steps; `StepSize.calculateStepSize` does the same in pixels and inches).
Minimizing the worst stride is the bottleneck objective. The counts are the same for everyone, so
any objective is unchanged by the counts; only the readouts and a step-size cap depend on them.

**Why squared distance helps against collisions [I, checked by P].** For straight, synchronized
motion xᵢ(t) = (1−t)aᵢ + t·bᵢ (bᵢ the spot marcher i takes), the squared-distance optimum can't be
improved by swapping two marchers, which works out to (aᵢ − aₖ)·(bᵢ − bₖ) ≥ 0 for every pair. Their
separation at time t is r(t) = (1−t)Δa + tΔb, so |r(t)|² ≥ (1−t)²|Δa|² + t²|Δb|², whose minimum is
|Δa|²|Δb|² / (|Δa|² + |Δb|²). If both forms keep at least D between marchers, nobody passes closer
than D/√2. That is CAPT's 2√2·R condition in drill units. The prototype matches it to the digit:
in every case with 2-step intervals at both ends, the closest pass under the squared objective was
1.41 steps (2/√2) [P]. Sum of distances has no such bound, because two marchers on the same line
can overtake.

## 3. Algorithms and measurements

### 3.1 Algorithms at 8–400 marchers

| Algorithm                                 | Complexity                      | Notes                                                                                                                                                                                              |
| ----------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hungarian (core's `hungarianAlgorithm`)   | O(n³)                           | Already in core and used by the Shape tool and casting. 400 marchers: about 45 ms in Node [P]; casting's comment measured 500 at about 30 ms.                                                      |
| Jonker–Volgenant / warm start             | O(n³) worst, fast in practice   | Reusing the previous dual potentials makes a re-solve after small spot moves near-linear [K]. Only needed for a live re-solve while dragging.                                                      |
| Auction (Bertsekas)                       | pseudo-polynomial               | Parallel-friendly, ε-optimal [K]. No benefit at n ≤ 400 in one thread.                                                                                                                             |
| Bottleneck: binary search + Hopcroft–Karp | O(n^2.5 log n)                  | Sort the n² distances, binary-search the smallest threshold with a perfect matching. 400 marchers about 150 ms including the follow-up Hungarian [P].                                              |
| Lexicographic via cost perturbation       | as Hungarian                    | Add tiny ε·d⁴ (prefer smaller longest moves among exact ties) and ε′·(rank_i − rank_j)² (then prefer drill order). Deterministic for any input order [P].                                          |
| 2-swap local search                       | O(n²) per pass                  | Try swapping two marchers' spots when their paths cross or pass close; keep if a secondary score improves without breaking the primary. Good for crossing cleanup after the optimum.               |
| Closest-approach check                    | O(n²), or near O(n) with a grid | For two straight synchronized paths, the closest distance is a closed form over t ∈ [0, 1]. 400 marchers = 80k pairs, under 10 ms [P]. Include non-selected marchers that move in the same window. |
| Above 500                                 | —                               | Keep `MAX_CAST_SLOTS` / `NEAREST_LIMIT` behavior: solve per section, or fall back to keep order with a note.                                                                                       |

### 3.2 Prototype results

[proto/remap-proto.mjs](proto/remap-proto.mjs) compares the orders on synthetic moves (units in
steps; spots at 2-step intervals unless noted; "close" = two marchers pass within 1 step). Run it
with `node docs/timeline/research/remap/proto/remap-proto.mjs`; the full table is in
[proto/results.md](proto/results.md). A selection (worst stride as "X to 5", bigger is easier):

| Case (marchers, counts)                           | Drill order         | Greedy (Pyware 3DX) | Sum of distances  | **Squared (CAPT)** | Bottleneck then squared | Recommended¹ |
| ------------------------------------------------- | ------------------- | ------------------- | ----------------- | ------------------ | ----------------------- | ------------ |
| Line to arc (16, 16)                              | 12.8, 0 close       | 7.5, 6 close        | 12.8, 0           | 12.8, 0            | 12.8, 0                 | 12.8, 0      |
| Line to arc, reversed numbering                   | 4.6, **48 close**   | 7.5, 6              | 12.8, 0           | 12.8, 0            | 12.8, 0                 | 12.8, 0      |
| Line slides one interval (16, 8)                  | 32, 0               | **2.0, 15 close**   | 32, 0             | 32, 0              | 32, 0                   | 32, 0        |
| Block shifted 6 right, 4 up (48, 8)               | 8.9, 0              | 2.6, 127 close      | **3.0, 71 close** | 8.9, 0             | 8.9, 0                  | 8.9, 0       |
| Block turned 90° (48, 16)                         | 12.6, 60 close      | 15.1, 12            | 22.6, 8           | 45.3, 0            | 64.0, 0                 | 64.0, 0      |
| Circle to line (24, 16)                           | 3.6, 22 close       | 3.9, 7              | 5.1, 0            | 5.3, 0             | 5.3, 0                  | 5.3, 0       |
| Block to wedge (36, 16)                           | 9.7, 47 close       | 8.5, 45             | 9.8, 4            | 19.1, 0            | 21.0, 0                 | 21.0, 0      |
| Half the band already in place (32, 8)            | 4.0, 49 close       | 2.5, 24             | 3.0, 12           | 4.8, 0             | 5.7, **2 close**        | 5.1, 0       |
| Mixed sections, 16×4 block to circle (64, 16)     | 4.1, 204 close      | 7.3, 50             | 8.5, 2            | 8.6, 0             | 8.8, **8 close**        | 8.6, 0       |
| Short move: 4×4 opens to 4-step intervals (16, 2) | 3.8 (4 over 4 to 5) | 2.3                 | 3.8               | 3.8                | 3.8                     | 3.8          |

¹ Squared, then ε·d⁴ (smaller longest moves among exact ties), then drill order.

Other results [P]:

- **Ties.** On a line moving to a perpendicular line through its middle, every assignment has the
  same sum of squares. Shuffling the input order 30 times gave 30 different answers for plain
  squared, 26 for sum of distances and 27 for greedy. With ranks in the cost (keep-ties and
  recommended) it gave 1. Today `assignSlots` passes marchers in selection order, so Nearest can
  give a different answer depending on how the user selected.
- **Ties hide taste.** In that same case the drill-order tie-break gave a clean fold (0 crossings,
  all neighbors kept, worst 6.0 to 5), and the d⁴ tie-break gave an interleave (56 timed crossings,
  81% neighbors kept, worst 8.5 to 5). Both are collision-free. Which one a writer wants is an owner
  question (Q3).
- **"Stay if you're already there" hurts.** Pinning marchers that already stand on a spot of B, then
  solving the rest: block shift went from 0 to 64 close pairs; the line slide sent one marcher 32
  steps through the line; half-in-place went to 9 close pairs. The squared optimum moves every
  "already there" marcher in those two cases (all 15 in the slide, all 20 in the block shift), and
  that is what keeps them clean [P].
- **Sections.** A section pull (cost + d² to the section's region of B, mapped by bounding box)
  raised same-section neighbors from 83% to 86% at no travel cost on the mixed case. Plain sum of
  distances also reached 86%, with 2 close pairs. A small effect; solving per section over the
  section's own spots is the stronger tool (§4.4).
- **Scale** (random scatter with ≥ 2 steps between marchers, to a block, 32 counts):

  | n   | Squared (ms) | Bottleneck then squared (ms) | Greedy (ms) | Close pairs: squared / sum of distances / greedy |
  | --- | ------------ | ---------------------------- | ----------- | ------------------------------------------------ |
  | 100 | 2            | 6                            | 4           | 0 / 41 / 174                                     |
  | 200 | 11           | 42                           | 17          | 0 / 186 / 571                                    |
  | 400 | 43           | 147                          | 94          | 0 / 329 / 1088                                   |

  Sum of distances had 0 crossing paths and hundreds of close passes; squared had 70–260 timed
  crossings and none closer than the guarantee. "No crossing lines" is the wrong diagnostic to
  optimize; closest approach is the right one.

### 3.3 Recommendation for the solver

- **Primary:** least squared travel. It is the existing Shape-tool Nearest cost, already cheap,
  and the only one with a guarantee.
- **Ties:** fold ranks into the cost so the answer never depends on selection order. Default
  secondary: drill order (the clean fold); optional secondary: smaller longest move (Q3).
- **Step-size cap (option):** "No step larger than ‹6 to 5›" as a hard threshold. Feasibility is
  one matching check; within the cap, minimize squared travel (threshold Hungarian). If the cap is
  infeasible, report the smallest feasible cap instead of failing silently. Warn that a cap can
  void the collision guarantee (it did in 2 of 12 cases).
- **Diagnostics, always:** worst step size, marchers over the field's step-size warning, pairs that
  pass within 1 step (closest approach, including other marchers moving in the window), total
  travel. Before and after.
- **Change casting too:** `nearestSlots` (casting, recast) uses plain distance, which showed the
  worst near-pass behavior among the optimal solvers. Switching it to squared cost with rank
  tie-breaks is a one-line cost change plus test updates, and makes all three callers agree.

## 4. Where it lives in OpenMarch

### 4.1 What the data model already says

- **UI-9/UI-10 moves are per marcher.** A drag in the edit window [S, P) adds each moved marcher to
  the window's timeline in **its own one-slot transition** (`addMarchersToTimelineInTransaction`,
  called by `moveMarchersInRangeInTransaction` in `db-functions/timelineMoves.ts`) and sets that
  slot's individual destination (D-16). So "who goes to which spot" is not slot casting there; it
  is simply which point each marcher's own move ends at.
- **A remap is a permutation of arrival points.** Read the selected marchers' arrivals at P
  (the spots of B) and their origins at S (form A), solve, and write each marcher's new arrival.
  `transformMarchersInSelection` (`timeline/timelineCoordinateWrites.ts`) already takes "current
  records → new records" and writes them as one undoable edit through `moveMarchersInTarget`.
- **Casting is the multi-slot analogue.** `castMarchersIntoTransition` and `recastTransition`
  (`db-functions/timelineAssignmentEdits.ts`) choose slots in one shared transition (converted
  shows, spec shapes), from where each marcher stands when its assignment first wins. `recast`
  refuses follow-the-leader and refuses when nothing improves (a tie never reshuffles). That is the
  same problem one level down; it should use the same solver.

### 4.2 The remap command, concretely

```text
remapSelection(marcherIds, window [S, P), options):
  plan       = planCanvasEdit()                          // the window, isolation, or refusal
  origins    = positionAt(id, S)                         // isolation: the plan's start positions
  spots      = positionAt(id, P) for the same ids        // B = where the designer put them
  pinned     = options.hold ∪ marchers on follow-the-leader or locked moves (see 4.3)
  σ          = solve(origins − pinned, spots − pinned spots, objective, ranks)
  write      = transformMarchersInSelection(ids, records → record of id gets spot σ(id))
```

- **Which beat range:** the edit window [S, P), like every other canvas edit (owner decision 3 in
  shapes/README: no special rule for a playhead mid-move). Counts = P − S.
- **Which marchers:** the selection. Spots are exactly the selected marchers' arrivals, so counts
  always match. Non-selected marchers keep their spots, but their paths go into the collision
  check.
- **Undo:** one edit (the seam wraps it). The sparse rules apply for free: a marcher whose spot
  doesn't change writes nothing; a marcher sent back to its position at S on a page box loses its
  own move (the "drag back" rule); a holding marcher that gets a new spot gets a move.
- **Pass-through:** a window over several page flags passes them, as a drag does; the existing
  toast offers "Keep Page N as a stop". The remap optimizes the whole window's travel.

### 4.3 Exceptions and constraints

| Situation                                  | Proposed handling                                                                                                                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pinned marchers (designer's choice)        | Excluded with their spots; the rest solved among the remaining spots. Preview flags close passes with pinned paths. "Pin" is the start flag's word in the UI (defined-coordinates finding 5), so call it **Hold spot** or **Lock**. |
| Kept spots (`timeline_kept_assignments`)   | Treat as held by default: a kept spot is a designer statement. Open question Q5.                                                                                                                                                    |
| Follow the leader                          | Refuse for those marchers ("follow the leader orders marchers by the trail, not by spot"), as `recastTransition` does. FTL is "later" for shapes anyway (owner decision 5).                                                         |
| Marchers in a shared multi-slot transition | Converted shows: the write converts a shape-backed transition to individual points (Q-14 workaround in `moveMarchersOnPage`), same as a drag. Or call `recast` with the new solver when the whole transition is selected.           |
| Spots from a Shape tool session (recipe)   | Inside the tool: Order "Nearest" calls the same solver with origins at S. After apply: a remap re-deals baked points; the recipe's `marcher_ids` slot order must be updated in the same edit, or the recipe marked modified.        |
| Spots from individual drags                | Nothing special: they are just arrivals at P.                                                                                                                                                                                       |
| Isolation mode                             | Origins and spots from the isolation plan (`editingPositionAt`), at the isolated timeline's start and end, as every isolated edit does.                                                                                             |
| Playhead mid-move                          | Same as a drag (UI-10): marchers leave S, arrive at P; a longer move the window cuts into catches up after P.                                                                                                                       |
| Later moves                                | Every later form is absolute and per marcher (D-5), so the next move starts from a different marcher's spot. The remap can make the **next** transition worse. Offer "Remap the next move too" as a follow-up (Q4).                 |

### 4.4 Sections

Two ways, both cheap:

- **Within each section (recommended option):** each section is solved only over the spots its own
  marchers hold at P. The designer controls the section regions by where they drew them; the remap
  only untangles order inside each section. Exact, fast (smaller Hungarians), and explainable.
- **Section pull:** one solve, with a cost term pulling a section toward its region of B. Weak in
  the prototype (+3 points of same-section neighbors), and needs a guess of "its region".

### 4.5 Relation to the Shape tool's Order section

| Question          | Shape tool Order                              | Remap move                                       |
| ----------------- | --------------------------------------------- | ------------------------------------------------ |
| Spots come from   | the shape kind's `generate`                   | wherever the marchers already are at P           |
| When it solves    | on open, kind or order change, Reassign       | on command, once                                 |
| Origins should be | positions at S (today: at P, see Summary 4)   | positions at S                                   |
| Modes             | Keep order, Nearest, Drill number, Reverse    | Nearest (shortest), within sections, drill order |
| Output            | slot index per marcher, frozen while dragging | spot per marcher, written once                   |

So: **both**. One pure function in `apps/desktop/src/shapes/assign.ts` (or core next to
`hungarianAlgorithm`), used by Shape-tool Nearest, by a new **Remap move** command, and by
casting. The Shape tool keeps its other modes; Remap is "Nearest without changing the shape".

## 5. UX options

Consistent with the Shape tool (inspector section, ghost preview, Enter applies, Esc cancels):

1. **Command:** "Remap move" in the ⌘K palette and the canvas context menu, with a toolbar or
   inspector button when two or more marchers are selected and the window is a range. A shortcut
   is optional (the keyboard map is crowded; A is taken).
2. **Session panel** (inspector, like the Shape tool's):
   - **Order:** Shortest travel (default) · Drill order · Reverse.
   - **Options:** Within sections · Hold selected spots (lock icon on chosen marchers) · Largest
     step ‹6 to 5› (off by default).
   - **Readouts, before → after:** "Largest step 3.6 to 5 → 5.3 to 5", "Over 4 to 5: 2 → 0",
     "Close passes: 22 → 0", "Total travel 506 → 376 steps", "17 of 24 marchers change spots".
   - **Apply** (Enter) and **Cancel** (Esc).
3. **Canvas preview:** ghost dots at the new spots; travel lines from S positions to spots,
   colored by step size with the step-size warning color; close-pass pairs marked at their closest
   point; a toggle "show old lines" for comparison. Scrubbing between S and P while the session is
   open would show the motion (the playhead preview already exists, UI-11).
4. **Manual fix-up in the session (later):** click one marcher then another to swap their spots
   (Pyware Swap), with the readouts updating. Swaps are a common last step in every drill tool.
5. **Alternative, lighter UX:** a one-shot command that applies directly and shows a toast with the
   readouts and Undo. Fewer clicks, but the writer can't compare before applying. Could be an A/B
   with simulated users, as with the shapes pop-up.

## 6. Edge cases to test

Unit (pure solver):

1. **Equal counts** always for a remap; **unequal** only in casting or a recipe with extra spots:
   more spots than marchers → vacancies (pad with zero-cost rows, as `nearestSlots` does); fewer →
   refuse with a message.
2. **Coincident spots** (two spots at one point, a stacked form): solves; the close-pass check flags
   it; ties broken by rank.
3. **Coincident origins** (marchers stacked at S, e.g. a new marcher at home): same.
4. **Everyone already in place** (B is A): identity, zero writes, "Nothing to remap".
5. **Pure translation** (block shift): the answer is the translation; no marcher overtakes another.
6. **Line slides one interval:** everyone shifts by one; nobody runs the length of the line.
7. **Symmetric forms with exact ties** (line to perpendicular line, circle to rotated circle):
   identical output for any selection order; drill-order tie-break.
8. **Reversed drill numbering:** Shortest ignores numbering; Drill order follows it.
9. **Very short move** (2 counts, form opens): readouts flag strides past 4 to 5; a cap that is
   infeasible reports the smallest feasible cap.
10. **Zero-count window** is impossible (UI-10 needs P > S); test that the command is disabled.
11. **One marcher** or none: disabled.
12. **Large n:** 400 under 100 ms; above 500 per-section or drill order with a note.
13. **Numerical noise:** spots equal within `SAME_POSITION_TOLERANCE` count as equal.

Integration (db-functions, with the resolver):

14. **Sections:** within-sections never sends a marcher to a spot another section holds.
15. **Held marchers** keep their spot; the rest solve around them; close passes with held paths
    are reported.
16. **Partial selection:** non-selected marchers in the same window unchanged; their paths are in
    the collision check.
17. **Holding marchers** (no own move in the window) that receive a spot get a move; marchers whose
    spot is unchanged write nothing; a marcher sent back to its S position on a page box loses its
    own move.
18. **Multi-page window:** origins at S, flags inside passed, pass-through toast once.
19. **Isolation mode:** origins and spots from the isolation plan; stolen members included.
20. **Playhead mid-move:** a move cut by P catches up after P; the remap changes only arrivals at P.
21. **Follow the leader** marchers in the selection: refused with the reason, nothing written.
22. **Shape-backed shared transition** (converted show): converted to individual points in the same
    edit, or recast when the whole transition is selected.
23. **Kept spots** held by default (if Q5 agrees).
24. **Recipe:** after a remap, "Edit shape" either follows the new order or shows "modified".
25. **Undo/redo** restores every arrival in one step; redo reapplies identically.
26. **Later moves:** the next transition's step sizes before/after are reported; "Remap next move
    too" (if built) solves the next window from the new positions.
27. **Shape tool Nearest** with marchers that already have a move ending at P uses origins at S
    (regression test for Summary 4).

Feel / validation (append to `docs/timeline/validation-plan.md` if built): a writer's block-to-
wedge and arc-to-company-front take, compared side by side with Drill order.

## 7. Recommended v1 and open questions

### 7.1 v1 scope

1. **Solver** (pure, unit-tested): squared distance; ranks folded into the cost for ties (drill
   order); held marchers excluded; options for within-sections and a step-size cap; returns the
   permutation plus readouts (worst stride, count over the warning, close-pass pairs, total travel)
   for before and after. Reuses core's `hungarianAlgorithm` and adds a bottleneck check
   (Hopcroft–Karp) only for the cap.
2. **Shape tool:** Nearest calls the solver with origins at S. Same readouts in the Shape panel.
3. **Remap move command:** palette entry and inspector button; a small session with Order
   (Shortest / Drill order / Reverse), Within sections, Hold, readouts, ghost preview with
   step-size colors and close-pass marks; Enter writes through `transformMarchersInSelection`.
4. **Casting:** `nearestSlots` switches to the same cost (squared plus rank tie-break).
5. **Not in v1:** step-size cap UI (keep the solver option), swap-in-session, "Remap next move
   too", multi-move optimization, FTL, crossing-minimizing local search.

### 7.2 Open questions for the owner

1. **Entry point:** a separate "Remap move" command plus Shape-tool Nearest (recommended), or only
   inside the Shape tool?
2. **Preview session or one-shot?** Inspector session with before/after readouts (recommended), or
   apply immediately with a toast and Undo?
3. **Tie taste:** when several assignments travel equally, prefer **drill order** (clean folds,
   neighbors kept) or **smaller largest step** (may interleave files)? The prototype's line-to-
   perpendicular-line case shows the difference (6.0 to 5 fold vs 8.5 to 5 interleave).
4. **Later moves:** after a remap, should the app offer to remap the **next** move too, since the
   next form's spots belong to marchers, not places?
5. **Kept spots and held marchers:** should kept spots count as held by default? What is the word
   for holding a marcher's spot ("Hold", "Lock")?
6. **Sections:** should "Within sections" be on by default when the selection spans sections?
7. **Step-size cap:** is a cap ("nothing over 6 to 5") worth a control in v1, or are readouts
   enough?
8. **Casting:** OK to change `nearestSlots` to squared distance (changes some converted-show
   recast results and their tests)?

## Files

- [proto/remap-proto.mjs](proto/remap-proto.mjs): the prototype (plain Node, no dependencies).
- [proto/results.md](proto/results.md): its full output.

## Sources

- Pyware 3D Matching Lines: <https://www.pyware.com/guide/3d/9.0/en/topic/matching-lines>
- Pyware 3DX Draw Mode Ribbon (Assign mode): <https://www.pyware.com/guide/3dx/1/en/topic/block-tool>
- CAPT, Turpin, Michael, Kumar, IJRR 2014:
  <https://publications.ri.cmu.edu/capt-concurrent-assignment-and-planning-of-trajectories-for-multiple-robots>
- Turpin et al., ICRA 2013 (bottleneck assignment): <https://www.ri.cmu.edu/?p=17144>
- Patent US 10,884,430 "Systems and methods for generating safe trajectories for multi-vehicle
  teams" (secondary statement of CAPT's objective and 2√2R condition):
  <https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10884430>
- Bottleneck assignment, threshold methods: <https://arxiv.org/pdf/2008.10804>
- Shapes prior art (Pyware, EnVision, ArrangeUs): [../shapes/02-prior-art.md](../shapes/02-prior-art.md)
