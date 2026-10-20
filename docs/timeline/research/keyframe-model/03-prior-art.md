<!-- cspell:disable -->

# Prior art: additions for keyframes

`docs/timeline/research/defined-coordinates/03-prior-art.md` already covers several tools:

- **Blender:** constant interpolation and Propagate.
- **After Effects:** Toggle Hold Keyframe.
- **Rive and Spine:** hold and stepped interpolation.
- **Pyware:** "Delete Transition" makes a hold.
- **EnVision:** pass-through.
- **DAWs:** Pro Tools write-to-next-breakpoint.
- **Lighting consoles:** Eos and grandMA tracking.

This note adds only what that file lacks and what bears on Q1 and Q2. Sources are primary, the
vendors' own manuals, read on 2026-10-20.

- The Blender quotes are from the manual's source repository
  (`projects.blender.org/blender/blender-manual`, branch `main`), because docs.blender.org served
  a bot challenge.
- The Adobe quotes are from Wayback Machine copies of helpx.adobe.com, because the live site
  refused the request.

Confidence markers: **[F]** quoted from the source; **[I]** my inference from it.

## Deleting a key rejoins its neighbours (supports Q2)

- **[F]** After Effects: "To delete any number of keyframes, select them and then press the Delete
  key." The page describes nothing else happening to the neighbours.
  https://helpx.adobe.com/after-effects/using/setting-selecting-deleting-keyframes.html
  (Wayback 2025-12-19)
- **[F]** Blender Graph Editor: "Pressing X or Delete opens a pop-up menu from where you can delete
  the selected keyframes." (`manual/editors/graph_editor/fcurves/editing.rst`, Delete)
- **[I]** In both tools the curve exists only between stored keys (03-prior-art §2). So deleting a
  key makes its neighbours interpolate directly: the movie-editor rejoin of Q2. Neither manual
  says this in words, because in a key-only model there is nothing else it could mean.
- **[F]** Pyware's opposite, "Delete Transition", is already in 03-prior-art §1: "a deleted
  transition becomes a Hold". **That is today's Remove keyframe.** OpenMarch stores move starts,
  so it can do either. A key-only tool can do only the first.

## Roving keyframes: a waypoint without a time (a third remove for Basic)

- **[F]** After Effects: "Roving keyframes are keyframes that are not linked to a specific time;
  their speed and timing are determined by adjacent keyframes."
- **[F]** "a keyframe can rove only if it isn't the first or last keyframe in a layer because a
  roving keyframe must interpolate its speed from the previous and next keyframes."
- **[F]** "After the keyframes are set to rove …, the motion path shows consistent speed over the
  range of keyframes."
- **[F]** "Roving keyframes are available only for spatial layer properties, such as Position".
- Source: https://helpx.adobe.com/after-effects/using/speed.html (Wayback 2025-12-01), "Create
  smooth motion with roving keyframes".
- **[I]** This is the inverse of Basic's problem. Roving keeps the **position** and frees the
  **time**. Basic must keep the **time** (the flag) and could free the **position**: "smooth
  through" puts the flag's keyframe on the straight line between its neighbours.
  - Both get even speed without deleting a key that the structure needs.
  - After Effects draws a roving key differently, as a dot rather than a diamond. A
    smoothed-through Basic flag could do the same.

## Hold keys pile up in a key-only model (a warning for Q1)

- **[F]** Blender preference **Only Insert Needed**: "This will only insert keyframes if the value
  of the property is different." It applies separately to manual keying ("skip inserting keys that
  don't affect the animation") and to auto-keying.
  (`manual/editors/preferences/animation.rst`)
- **[F]** Blender **Clean Keyframes**: "Finds redundant keyframes among the selected ones and
  deletes them. A keyframe is seen as redundant if it has the same value as its neighbors"
  - The manual's tip: it is meant to run "after e.g. bulk keyframe insertion on all the bones of
    an armature (which creates useless keyframes on bones that haven't moved)".
  - A **Threshold** option also deletes keys that "almost" match.
  - Source: `manual/editors/graph_editor/fcurves/editing.rst`, Clean Keyframes.
- **[I]** Blender treats an equal-value key as data the user may or may not want. It offers:
  - a default that avoids making them;
  - an explicit cleanup with a tolerance.
    It never infers intent from equality on its own. That fits the defined-coordinates rule: under
    Q1 a hold keyframe is intent when the designer made it. The writers that make one on the
    designer's behalf are listed in 01-write-paths.md (F1, F6, S1).
- **[I]** OpenMarch's equivalents are already split the same way:
  - Expert's "no-ops are skipped" (`db-functions/timelineMoves.ts:957-961`) is Only Insert Needed.
  - Basic's `planMerge` cleanup of zero-motion rows (`db-functions/timelinePointMoves.ts:274-284`)
    is an automatic Clean Keyframes, which Blender never runs on its own.

## Hold keys are a type, not a coincidence

- **[F]** Blender keyframe types include **Moving Hold**: "A keyframe that adds a small amount of
  motion around a holding pose. In the Dope Sheet it will also display a bar between them."
  (`manual/animation/keyframes/introduction.rst`, Keyframe Types). The other types are Keyframe,
  Breakdown, Extreme and others.
- **[F]** After Effects: equal keys under Bezier interpolation can "cause undesired back-and-forth
  (boomerang) motion between two keyframes with equal values. In such a case, you can change the
  earlier keyframe to use Hold interpolation". When a key's interpolation is overridden by a Hold,
  that half of its icon is drawn dark gray.
  https://helpx.adobe.com/after-effects/using/keyframe-interpolation.html (Wayback 2025)
- **[I]** Both tools mark a hold **visibly and as a kind of key**:
  - Blender draws a bar between keys and has a key type;
  - After Effects draws a half-icon.
    That supports K3's separate glyph for start keyframes, and K2's hold keyframe being shown
    differently from a moving one.
- **[I]** OpenMarch's moves are direct, so linear, and have no easing today. The boomerang problem
  doesn't arise yet, but it would if easing per segment is ever added (03-prior-art's
  "interpolation per segment").

## Gaps

- I found no drill tool documenting a keyframe-level "remove and rejoin". Pyware, EnVision and UDB
  delete transitions or sets, and those manuals are already cited in 03-prior-art.
- Lighting consoles have no spatial interpolation between cues to rejoin. Their "delete cue only"
  analogue is already in 03-prior-art §4.
- After Effects' delete semantics are inferred, not quoted. The help text says only that the
  selected keys are deleted.
