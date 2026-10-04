<!-- cspell:disable -->

# Ownership transfers: research handoff

Status: research, not decided. Nothing here changes `spec.md`, `ui.md` or the
implementation plan yet. Started 2026-10-04 in a lead session and moved to a
remote machine mid-conversation; this file is the conversation state.

## How it started

Adding marchers over a dragged range [9, 21) was refused with
"F1 is in a timeline over beats [1, 17), which only partly overlaps [9, 21)"
([image](images/0-partial-overlap-error.png)). The refusal is the UI-9 Layers
rule in `apps/desktop/src/db-functions/timelineMembership.ts`
(`partlyOverlaps`), not the database or resolver. Pages aren't the issue:
they're only flags on top of timelines, though users treat them as timelines.

## What the project owner wants

1. A group moves forward 16 steps in unison over 16 counts.
2. On count 8 the outer marchers change to a sideways move (they leave the
   group move; the new move may run past the group move's end).
3. The 16-count move stays one block of logic: editing its destination
   behaves as if ALL marchers still go there, even though some leave on
   count 8, and the split keeps working. No need to define two moves.
4. When a transition is selected or in focus, show its context: the previous
   dots and the pathways of all its marchers, with "ghost" dots and paths
   for the parts some marchers never perform.
5. Marchers can also JOIN a larger timeline mid-way.

Mockups:

- [Scenario 1, steal-out](images/1-steal-out.png): the outer 4 leave green
  (yellow) and green's remainder for them is drawn gray. Yellow crosses
  green's end on the timeline strip.
- [Scenario 2, join-in](images/2-join-in.png): joiners merge into green
  mid-way; green has gray ghost START dots for them. The left half shows
  computed, in-line ghost starts; the right half shows arbitrary ones.
- [Scenario 3 "fixed", exit and rejoin](images/3-exit-and-rejoin.png):
  marchers leave green (yellow), then return to green (pink) on a path the
  user defines, "to avoid a snap back". The ghost pathway is green's own
  path, so it's easily defined.

## Research done (this folder)

| File                                                             | What                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [01-current-model.md](01-current-model.md)                       | Today's spec and code against the scenarios, with file:line citations and the constraints a redesign must respect     |
| [02-prior-art.md](02-prior-art.md)                               | Pyware, Blender NLA, Unity/Unreal layers, Maya Time Editor ghosts, Golaem, Final Cut connected clips, Figma overrides |
| [03-hypothesis-A-layers.md](03-hypothesis-A-layers.md)           | Keep layers and steals; exit / detour / entry relationships inferred from the dragged window; notches on clips        |
| [04-hypothesis-B-restructure.md](04-hypothesis-B-restructure.md) | Per-marcher ownership segments (no layers), stored ghost origins, linked destinations; cost comparison                |

Note: agents 01 and 03 read the main checkout while it was on
`timeline/p8-17-core-loop` (P8.17 in progress), not `timeline-try-2`.

### Findings everyone agreed on

- **Steal-out already resolves correctly** once the UI-9 partial-overlap
  refusal is lifted: green L0 [0,16) plus yellow L1 [8,24) gives green to 8,
  then yellow from green's beat-8 position (R-4). Editing green's
  destination moves the split. No new data.
- **Join-in is the real gap.** Joins rebase (D-12): they head straight to
  the destination in the time left. Destinations are absolute (D-5), so
  editing green's start doesn't keep the merge. There is no ghost start.
- **Ghost paths** for marchers who start with the group are computable
  today: run a throwaway resolver without the stealing rows and sample
  `positionAt` (the pattern `sampleShape` in `timelineMoves.ts` uses).
  Nothing ghost-like is drawn on the canvas yet.
- **Gaps found:** a stolen marcher's group destination has nothing to grab
  on the canvas (ghost dots must be handles); dragging a group's end is
  refused for stolen marchers ("on a higher layer"); a steal that runs past
  green's end also steals the next move, which then rebases (catches up).
- **Prior art:** no drill tool keeps a group move editable while members
  leave or join (Pyware stores fixed positions per count). The closest
  models are Unity's masked override layers, Figma instance overrides, Final
  Cut connected clips (link to "host at frame k", never to a coordinate) and
  Maya's selected-clip-only ghosts.
- **Cost:** adding ghost origins, linked destinations and ghost rendering
  to today's model is about 1.5–2.5 weeks. Replacing layers with segments
  is about 4–6 weeks and isn't needed for either scenario by itself.

### Lead recommendation given before the owner's answers

1. Peel-off: keep the group row whole and let the peel-off override it one
   layer up (not A's trim-the-host approach, whose seams must be kept glued
   by every range edit). Lift UI-9's partial-overlap refusal.
2. Join: the joiner's move ends at a live link "host at beat j", and ghost
   starts are computed by default and draggable. Needs a spec amendment
   (D-5, D-12), resolver change and ADR.
3. Ghosts Maya-style: only for the selected move, gray, with dots per
   count; ghost dots are handles.
4. Defer the segments restructure.

## Owner's answers (2026-10-04)

1. **Peel-off running past green into the next move (blue).** The owner
   didn't see why the current-model agent called the catch-up a problem,
   and added: when we know WHEN a marcher rejoins a slot on a timeline,
   its destination should already be decided by that timeline at that
   point in time. "More like a dynamic link than a static separate
   pathway." So overrunning green = exit green, then join blue at a known
   beat, with the arrival point linked to blue's path. The rebase
   (head straight to blue's destination and speed up) is what to replace.
2. **Live link vs one-off Re-snap.** The owner didn't follow the question;
   it was asked badly. Their answer to 1 implies a live link. Confirm.
   - Live: the feeding move's destination is stored as "host at beat j"
     and recomputed whenever the host changes.
   - One-off: store coordinates, and a command re-aims them on request.
3. **Ghost starts: computed by default.** "The designer would make a
   transition as if all the marchers were in that location all along."
   Interpretation to confirm: a group move is authored as a full formation
   (origin and destination for every member). A joiner's ghost start is
   simply that member's origin in the host's authored formation, not
   something derived from the joiner's own path.
4. **Detour (rejoin green) vs exit-and-hold when yellow ends inside
   green.** The owner was unsure of the pros and cons; explain them. Their
   Scenario 3 mockup answers much of it: the return is an explicit move
   (pink) whose end is linked to green's path, which avoids the snap back
   that today's implicit resume (R-5/D-12 rebase) causes.

## Emerging model (lead's synthesis, not yet agreed)

The scenarios reduce to two primitives, both with links to a host path:

- **Exit at beat k:** the next move's origin is the host's position at k.
  This is R-4 today and needs nothing new.
- **Enter at beat j:** the feeding move's destination is a live link to
  the host's planned path at j. The host's ghost origin for that member
  comes from the host's authored formation.

Everything else is a combination:

- Steal-out = exit.
- Join-in = enter.
- Detour / Scenario 3 = exit then enter, replacing implicit resume.
- Overrun into the next page = exit green, then enter blue.

Open consequence: if implicit resume is replaced by explicit exit plus
enter, layers carry little meaning. That moves toward hypothesis B's
per-marcher segments. Decide whether to keep layers as the storage and
treat exit/enter as UI concepts, or to restructure.

## Next steps

1. Answer the owner's open points: confirm a live link (2) and the
   ghost-start interpretation (3); explain detour vs exit-and-hold pros and
   cons (4).
2. Launch more plan agents (the owner asked to do this after the move to
   the remote machine). Candidates:
   - a design pass on the two-primitive model (exit/enter with links),
     covering resolver semantics, acyclicity of links and what happens when
     a host is shortened past a link beat or deleted;
   - the UX of creating exits, entries and returns on the strip and canvas;
   - the ghost rendering and handle spec;
   - layers vs segments as storage for this model.
3. Then record decisions in `ui.md` (UI-9/UI-10 revision) and a spec
   amendment, per `docs/conventions/architecture-decisions.md`.
