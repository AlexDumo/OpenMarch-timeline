# Marching technique for the 3D View

<!-- cspell:words sousaphone sousaphones contra contras mellophone ligature spocks -->

The rules the 3D View's marchers and instrument holds follow, as the owner
(Trevor) set them while reviewing renders. They are the source of truth for
how a marcher should look and move; the code points back here. When the owner
corrects a pose or a step, record the rule here in the same change, with the
date, so the next person doesn't rediscover it.

Code references name where each rule lives today. Numbers are the ones the
code uses.

## Perspective

- **Left and right are always the performer's own** (2026-10-09). "Left foot"
  means the performer's left foot whichever way they face; a performer facing
  the audience has their left foot on the audience's right. The settings say
  "Performer's left" and "Performer's right" for this reason.
- Body frame: +Z is where the performer faces, +Y up, so +X is the
  performer's left (`core/instruments/holds.ts`, `core/marchers/facing.ts`).
  Field frame (ADR 0002 D-2): +X toward side 2, +Z toward the audience.

## Steps and timing

- **Heel on the beat** (2026-10-09). The back edge of the heel touches down
  exactly on the count; the feet cross between counts. The clips run ahead of
  the count clock by `beatLead`, 0.1 count by default
  (`window/sceneStore.ts`), so the heel lands on the beat rather than the foot
  looking late.
- **Step-off** (2026-10-09). The initiation starts one count before the first
  step and takes a full count at the current tempo: the step-off clip covers
  that count and the first foot lands on count 1 (`core/marchers/planner.ts`).
- **Step-off foot.** The band steps off on the left foot by default; a setting
  steps off on the right, which plays every clip mirrored
  (`window/performers/marchers/mirrorClip.ts`). With the left foot, odd
  counts land on the left and even counts on the right.
- **Weight distribution** (2026-10-09). The body sits halfway between the
  feet, horizontally and vertically, at all times. It mostly stops on the last
  count of a move but still travels a little between count 8 and count 1 of
  the hold, while the trailing foot closes.

## Foot on the dot and body center

What a dot means (2026-10-09). The weight is always 50-50 between the feet,
so the two readings put the body in different places, and it matters that
the 3D View shows the difference.

- **Foot on the dot is the default and the most common.** The platform (the
  ankle bone) of the landing foot is on the dot on the last count of the move.
  With the weight between the feet, the body is then half a step behind the
  dot, so a form doesn't actually resolve until between count 8 and count 1:
  - **coming to a close:** the ankle is on the dot on the last count; as the
    feet come together the performer is centered on the dot;
  - **changing direction:** the ankle is on the dot on count 8, and from
    count 8 to count 1 the leg in motion goes to the new direction.
- **Body center** is an option for later, chosen on specific sets: the
  center of the body mass, between the two feet at the same step size the
  performer was coming from, is over the dot (weight 50-50 over it) rather
  than one foot. It isn't shown in the UI yet.
- Code: `dotMode` in `core/marchers/planner.ts`, `"foot"` by default. The
  body is placed half the count's step behind the dot after every moving
  count, on the dot after a rest, and swings to the new direction during
  count 1 of a new move while the legs' fade stays centered on the
  boundary. `"body"` keeps the body's center on the dot at every count.
- The half step is along the line of travel only; the side-to-side offset of
  a foot from the body's center (about half the hip width) isn't modeled.

## The halt (the close)

- In an 8-count move the right foot lands on count 8 and the left foot comes
  to meet it on count 1 of the hold (with a left step-off) (2026-10-09).
- The closing (back) leg stays on the straight line of travel all the way to
  the close and only turns out at the end; no "out and around" swing. The
  residual leg turn waits for the last fifth of the count
  (`HALT_TURN_START` 0.8 in `planner.ts`).
- The owner flagged a close that covered half the distance in a full count
  and so looked slow (2026-10-09): the closing foot should move at marching
  pace.

## Direction changes: the a, b, c triangle

The owner's picture (2026-10-09): going from straight forward into a right
slide, the leg could travel to the foot (side **a**) and then out to the side
(side **b**). A real marcher takes the short side, **c**: the leg travels
smoothly along the direct path from the last count of one move to the first
count of the next. The same holds for every change (forward right slide into a
backward march, and so on).

- A change must not snap on the downbeat. It is centered on the count
  boundary: the old move blends into the new from the middle of count 8 to the
  middle of count 1 of the next page, while the legs ease from the old travel
  direction to the new (`crossfade` in `planner.ts`).
- A turn larger than `SHARP_TURN` (20 degrees) between counts is a change of
  move; smaller drifts ease the legs over half a loop.

## Slides

- **Slides face the 50** (2026-10-09). A slide toward the 50 yard line is a
  forward slide; a slide away from it is a backward slide, so the legs point at
  the 50 either way (`core/marchers/facing.ts`).
- The rule holds within about 10 degrees of sideways (`SLIDE_BAND`). Past
  that the feet flip as usual: the owner put the line between a 95 degree
  slide (still forward or backward toward the 50) and a 100 degree slide
  (flip the feet). Outside the 25 yard lines this matters most.
- The upper body always faces the audience; only the legs turn.

## Brass holds

- **Horns up means the bell faces front** (2026-10-09). Shows always play horns
  up for now; carry and trail exist so the poses can be checked (the Horn
  state setting). One day the show will set the position per count.
- **The brass triangle.** Arms in a slightly wider-than-equilateral triangle:
  right hand on the valve caps, left hand behind the valves, elbows out.
- **Carry, set and down are the same hold** (2026-10-09): the bell to the
  ground, the mouthpiece at eye level.
- **Trail** (2026-10-09): the instrument in the right hand only, bell
  backward, valves perpendicular to the ground; the left arm straight down the
  side of the leg, a closed fist with the thumb on top.
- Contras and sousaphones hold differently, and so does the French horn. The
  contra rests on the left shoulder with the loop outside the head; the right
  hand reaches across to the valves. Contra or sousaphone will become a choice
  on the Tuba section.
- Finish: gold lacquer by default, silver lacquer selectable.

## Woodwind holds

- **Carry:** the hands stay where they play; the ligature (the embouchure hole
  for flutes) rises to eye level (2026-10-09).
- **Flute and piccolo** (photos, 2026-10-09): horizontal to the player's right
  at the lips, angled a little forward and down. Both hands sit under the
  tube, fingers wrapping up and over onto the keys: the left hand by the face
  with its forearm across the chest, the right hand further out with the
  elbow down and out.
- **Clarinet:** down the center line, angled about 30 degrees out. The hands
  wrap the joints from the sides, fingers across the front, thumbs behind.
- **Saxophones** (photos, 2026-10-09): centered in front of the body, not to
  the side. The neck brings the body out in front of the mouth, the body runs
  straight down to the bow at the stomach, the keys face forward, and the bell
  sits on the player's left of the body tube, opening forward and up. The
  hands wrap from the sides: left hand on the upper stack, right on the lower,
  elbows out.

## Battery holds

- **Carriers:** snare, tenors and bass hang from shoulder hoops over the
  shoulders with a plate on the belly.
- **Snare and tenors** (2026-10-09): matched grip. Palms down, forearms level,
  hands just behind the back rim, sticks angled in from each side to meet near
  the center a little above the head.
- **Tenors** (photo of a Dynasty six-drum set, 2026-10-09): sixes. The 6 and 8
  inch shots sit in the middle nearest the player by the carrier bracket;
  drums 1 (10 in) and 2 (12 in) in front of them; drums 3 (13 in) and 4 (14 in)
  wrap round at the player's left and right. Heads level, shells nearly
  touching. The left hand covers drum 1, the right drum 2.
- **Bass drums** (photo, 2026-10-09): carried high, the top near eye level.
  Upper arms down, forearms forward at the hips, the hands beside the heads
  below the center, the mallets angled up and forward to the center of each
  head. A line spreads its sizes from 18 to 32 inches.
- **Cymbals:** a pair at chest height, plates vertical.

## Color guard and props

- Equipment basics: 6 ft flag, swing flag, double swing flag, weapon (rifle),
  sabre.
- The front ensemble and speakers are props, not dots: they need geometry
  but don't march.

## What the models can't do yet

- The hand mesh can't curl its fingers, so holds place the wrist about a
  hand's length from the tube and let the fingertips reach over it.
- The bass drum arms are one pose for every drum size.
