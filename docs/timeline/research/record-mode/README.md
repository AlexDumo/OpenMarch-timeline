# Record mode and the start view

Research, 2026-11-25. Status: proposal, waiting on the owner. Nothing here is built.

## Where this comes from

Record path (draft fork PR #1331) lets you select marchers, press Record, hear four clicks and
drag them while their move plays. The drag becomes each marcher's exact path (ADR 0018). The owner
tried it and said:

> I understand that we usually want to see the ending shape because that's what we're editing,
> but when we're about to record I feel like we actually want to see the starting shape. […]
> Maybe recording mode is a completely different editing mode?

Today the field shows a selected page at its end (its set): "Editing Page 2's move". The prototype
only jumps to the move's start once Record is pressed, and then the count-in starts straight away,
so there is no moment to look at the starting form, check who is selected and get ready.

## What the app already has

- **Expert.** The edit window runs from the start flag to the playhead. The field shows the
  playhead, where movers arrive; a drag sets where they are there. While the start flag is dragged,
  or stepped with the arrow keys, the field shows the start flag's count for a moment (UI-26,
  `startPeek` and `fieldBeat` in `TimelineSelectionStore`).
- **Basic.** No start flag: the start of the page the playhead is on does its job. A drag edits
  the page's set.
- **Start flag positions** (fork #331, guide "See where marchers go"): a dot where each marcher
  was at the start flag and a thin path from it to the playhead. Selected marchers' dots by
  default; hold N to see everyone's.
- **Edit move** (isolation): a mode you enter on purpose, with a bar over the field naming the
  move, **Done** and Escape to leave, others dimmed, the move's paths drawn and Loop on. It is the
  app's existing pattern for "the field means something different for a while".
- **The rule that matters here:** a position at a page's start is the previous page's set. The
  field at Page 2's start is Page 1's set, and a drag there changes Page 1.

## Precedents (DAWs and other tools)

| Tool                                      | What it does                                                                                                                                                                       | What we take                                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Logic, Ableton: record-arm                | You arm tracks first. Arming changes nothing; it says who will be recorded. Record then counts in. Tracks not armed keep playing, so you can layer one part at a time.             | Arm before recording. Others play while you record: layering for free.                                          |
| Logic, Ableton: punch in and out          | Two locators mark the part of a take that is replaced; pre-roll plays the lead-in without recording.                                                                               | Later: the Expert edit window (start flag to playhead) is the punch range.                                      |
| Logic: Touch and Latch automation         | In Touch, a pass writes only while you hold a control and leaves the old curve elsewhere. Latch keeps the last value after you let go.                                             | A take with no drag is just a playback; only touched marchers change. Letting go stays put (Latch), as built.   |
| Logic cycle recording, Ableton take lanes | Each pass in a loop is a take; you pick or comp the best.                                                                                                                          | Later: retakes and picking takes. First step: a retake replaces, and undo goes back.                            |
| After Effects Motion Sketch               | You open the panel, press Start Capture, and capture begins when you press in the comp. While you sketch, **Show Background** keeps the frame where the capture started on screen. | The clearest precedent for the owner's point: while recording motion, the screen shows where the motion starts. |
| Blender auto-key                          | A red record button in the timeline. While it is on, every move you make sets a key at the current frame. It changes what an edit means, and it is always visible.                 | Recording is a visible, toggled state, not a one-shot command.                                                  |
| Premiere, Final Cut trim                  | While you drag an edit point, the viewer shows the frames on both sides of it; when you let go it shows the playhead again.                                                        | A start view is a peek while you need it, not a place you edit from.                                            |
| Keynote Magic Move, Figma Smart Animate   | A slide or frame is an end state; its start is the previous slide. You never edit "the start of slide 2": you go to slide 1.                                                       | Editing a page's start is editing the previous page. Don't pretend otherwise.                                   |

## Question 1: should recording be its own mode?

**Yes: Record mode, armed before recording.** Recording and placing are different jobs. When you
place, the output is the set, so the field shows the end. When you record, the set is the input
you perform from, and the end comes out of the take. So the field should show the start. A mode
also gives the moment between "I want to record" and "go" that the prototype skips.

**Enter.** The Record button beside Play, or Alt+Shift+R, with marchers selected. The field jumps
to the start of the move at the playhead (the page arriving there, as everywhere) and stays there.

**What it shows while armed.**

- The starting form, solid: where everyone is at the move's start.
- The armed marchers ringed in red, others normal (they will play during the take).
- Each armed marcher's current path, dashed, to a hollow dot at its current end: what a take will
  replace, and where it was going (the Keynote "move" ghost).
- Optionally everyone else's paths for the move, faint, so you can plan around them.
- A bar over the field, like Edit move's: "Record · Page 2's move · counts 1–16 · 3 marchers",
  with Record take, Done and Escape.
- On the timeline, the move's range in red.

**What edits mean inside it.**

- Clicking marchers changes who is armed (Shift adds). A drag before the take starts does not move
  anyone: at the start it would change the previous page's set. The bar says "Press Record to
  start, then drag".
- **Record take** (Space, the bar's button or the Record button): four clicks, then the move plays
  from its start. Only the marchers you drag change (Touch); a take where you drag nothing is just
  a playback. Letting go leaves them standing there (Latch), as built.
- After a take the field goes back to the start, still armed, with the new path drawn. Another take
  replaces it; each take is one undo step.
- Next page and Previous page (E, Q) move the arm to that page's move and show its start: you can
  walk through the show recording.
- **Done** or Escape leaves, and the field goes back to the playhead, the end, as before. Other
  editing (a shape tool, the inspector) ends Record mode first, as with Edit move.

**What it owns from the roadmap.**

- Layering one performer at a time: built in (arm one, take, arm the next; the first plays back).
- Retakes: built in (replace plus undo). Take history and picking a take: later, in the mode's bar.
- Punch in and out: later. In Expert the edit window (start flag to playhead) is the punch range;
  in Basic it stays the whole page.
- Follow the leader and group rotation: later, as what you arm ("Path", "Leader", "Rotation" in the
  bar). The mode, the start view and the take flow stay the same.

**Basic and Expert.** Same mode. Basic records the page at the playhead; Expert records the move
at the playhead (a page's move, or a move bar), and later the edit window.

## Question 2: should "see the start" be a general view toggle?

**No toggle for now.** An edit while viewing the start is an edit to the previous page's set (or,
in Expert, to whatever move ends at the start flag). There are three ways to handle that, and none
is good enough for a persistent view:

1. **Allow it and change the previous page.** The editing line would have to say "Editing Page 1's
   set" while Page 2 is selected: the edit is somewhere other than where you are. This is what
   Keynote and Figma avoid.
2. **Redirect it**: the toggle moves you to the previous page. That is just Previous page (Q),
   which already exists.
3. **Refuse it**: a view you can't edit in. That is a peek, and peeks exist already: the start
   flag's own peek, and start flag positions (hold N for everyone's dots and paths).

So outside recording, the start stays a peek and ghosts, not a place. If the owner misses it
outside recording, the small next step is a hold-to-peek key: hold it and the field shows the start
flag's count (Basic: the page's start), read-only; pressing on the field ends the peek. It reuses
`startPeek`. Not proposed now.

## Question 3: recommendation and the first step

**Direction:** Record mode is a mode you arm, modeled on Edit move's bar and on DAW record-arm. It
owns the start view. There is no general start view.

**Smallest first step (one build on `pathways/record-path`):**

1. Record (button or Alt+Shift+R) arms instead of starting: the field shows the move's start, the
   armed marchers get a red ring, and their current paths are dashed to a hollow end dot.
2. A bar over the field: what is armed, Record take (Space), Done (Escape).
3. Record take runs the existing take (count-in, play, drag). Afterwards the field returns to the
   start, still armed, with the new path.
4. Clicking marchers re-arms; drags before the take do nothing.

Try this: select three marchers on Page 2, press Record, look at the starting form, press Space,
drag, let the move finish, then press Space again for a retake, and Done.

**Deliberately left out of the first step:**

- Next and Previous page while armed (walking the show).
- Other marchers' paths while armed.
- Punch in and out, pre-roll, and the Expert edit window as the range.
- Take history and picking takes.
- Follow the leader and rotation recording.
- Motion Sketch's "capture starts when you press" (no count-in).
- A general start view or hold-to-peek key.
- Touch: the bar's buttons work by touch; tablet details wait until the mouse version is liked.

## Questions for the owner, one at a time

1. Should Record arm first (a mode you enter, then Record take), rather than start straight away?
   _Recommended: yes._
2. Inside Record mode, should Space record a take (and a take with no drag is just a playback)?
   _Recommended: yes._
3. After a take, should the field go back to the start, still armed, ready for a retake?
   _Recommended: yes._
4. Outside recording, is start flag positions (hold N) enough, with no start view toggle?
   _Recommended: yes, for now._
