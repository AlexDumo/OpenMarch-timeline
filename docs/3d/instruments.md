# Instruments, holds and front ensemble props: design

<!-- cspell:words mellophone mellophones sousaphone sousaphones contras leadpipe Mylar lathed swept subwoofer spocks ligature -->

Status: reviewed by the owner 2026-10-08; §9 item 3 (props persistence) is
still open. Nothing here is built.

How 3D View marchers come to carry instruments that read as the real thing,
hold them the way a corps does, and how the front ensemble and its speakers
appear on the field. Adds to [ADR 0002](../adr/0002-3d-view.md) D-7; the
schema addition in §6 needs an ADR amendment before it is built.

## 1. Where we are

- om-pose's body meshes carry three placeholder instruments (trumpet,
  mellophone, baritone; 120 triangles each) skinned to the right hand, and
  every clip holds one "horn up" arm pose. Every other section carries
  nothing. The bodies and clips are vendored as read-only
  (`src/view3d/vendor/om-pose/README.md`).
- The window bakes the clips itself (`bakeClips`) from the loaded clip files,
  and the library already builds rigid one-bone meshes that ride the baked
  skeleton (`blockGeometry`). Both are the hooks this design uses, so nothing
  in om-pose changes.
- Pit members are marchers with dots. The show stores nothing about
  speakers, racks or carts.

## 2. Goals and non-goals

Goals, in the owner's words: render the horns better, add real marching
percussion, add front ensemble and speaker setups, model them as closely as
possible to the real thing from multiple angles, and make the arm poses match
each instrument. Woodwinds are in scope.

Non-goals: photo textures or logos from any manufacturer; mallet, stick and
finger animation; sound; props other than the front ensemble set.

**Reference policy.** Yamaha's product pages (marching brass under
`usa.yamaha.com/products/musical_instruments/winds/marching_brass/`, marching
percussion and multi-frame keyboards under
`.../musical_instruments/marching/`) are the proportion reference: bell
diameters, bore, shell sizes, frame widths, viewed from their multi-angle
galleries and spec tabs. Nothing from those pages ships. Geometry, colors and
finishes are ours. No model names or marks appear in the app.

**Style.** The fidelity brief's stylized-realistic maquette: real
proportions, real finishes (lacquer, silver, chrome hoops, Mylar heads, rosewood
or synthetic bars), simplified detail. An instrument must read correctly from
the press box and from a seat on the 30, not from a macro lens.

## 3. Instrument catalog

Every section in `Sections.ts` maps to one model or to none. Dimensions are
the working numbers to build from, in meters, to be checked against the
reference pages during the build.

### Brass (`FAMILIES.Brass`)

| Section       | Model                                                                    | Working dimensions          | Hold     |
| ------------- | ------------------------------------------------------------------------ | --------------------------- | -------- |
| Trumpet       | Bb trumpet, 3 piston valves                                              | length 0.48, bell 0.125     | brass    |
| Mellophone    | marching mellophone, front bell                                          | length 0.55, bell 0.26      | brass    |
| Baritone      | marching baritone, front bell                                            | length 0.62, bell 0.25      | brass    |
| Euphonium     | marching euphonium, front bell                                           | length 0.66, bell 0.28      | brass    |
| Trombone      | tenor trombone, slide                                                    | length 1.18, bell 0.21      | trombone |
| Bass Trombone | same with larger bell and a second rotor                                 | bell 0.24                   | trombone |
| Tuba          | marching contra: a long horizontal loop on the left shoulder, front bell | body 0.95 × 0.40, bell 0.50 | contra   |

The Tuba section renders the marching contra. A sousaphone (circular wrap,
bell overhead) becomes a per-section choice on Tuba later (owner,
2026-10-08); the catalog's `Carry.model` is where that choice lands.

The app has no French horn section; mellophone covers it. If one is added
later it gets its own hold (bell under the right arm, left hand on the
rotors).

### Woodwinds (`FAMILIES.Woodwind`)

| Section       | Model                     | Working dimensions     | Hold          |
| ------------- | ------------------------- | ---------------------- | ------------- |
| Piccolo       | piccolo                   | length 0.32            | flute         |
| Flute         | C flute                   | length 0.67            | flute         |
| Clarinet      | Bb clarinet               | length 0.66            | clarinet      |
| Bass Clarinet | bass clarinet with peg    | length 1.0             | bass clarinet |
| Soprano Sax   | straight soprano          | length 0.65            | clarinet      |
| Alto Sax      | alto sax on a strap       | height 0.65, bell 0.12 | sax           |
| Tenor Sax     | tenor sax on a strap      | height 0.80, bell 0.14 | sax           |
| Bari Sax      | baritone sax on a harness | height 1.0, bell 0.19  | sax           |

### Battery (`FAMILIES.Battery`)

| Section   | Model                                  | Working dimensions                         | Hold    |
| --------- | -------------------------------------- | ------------------------------------------ | ------- |
| Snare     | marching snare on a carrier            | 14 in × 12 in shell                        | snare   |
| Tenors    | quads plus two spocks on a carrier     | 10, 12, 13, 14 in drums, 6 and 8 in spocks | tenors  |
| Bass Drum | marching bass on a carrier, five sizes | 18 to 32 in diameter, 14 in deep           | bass    |
| Cymbals   | pair of 18 in crash cymbals            | 18 in                                      | cymbals |
| Flub Drum | the bass model at 20 in                |                                            | bass    |

Bass drum size: the Bass Drum section has no per-marcher size. Default:
spread 18, 22, 26, 28, 32 in across the section's marchers in drill order,
smallest first. A stored per-marcher size is a later schema change.

### Guard, Other, Pit

Guard carries nothing in this design (flags and rifles are a separate
task). Drum Major and Soloist carry nothing. Pit marchers carry nothing on
their dots: their instruments are props (§6).

## 4. Geometry: procedural, one bone each

Instruments are built in code, in `src/view3d/core/instruments/`, as pure
functions from a few dimensions to triangle lists, in the manner of
`blockGeometry`: lathed bells and bows, swept tubing along a polyline, valve
blocks as cylinders with caps, drum shells as open cylinders with hoops and
lugs, bars as boxes on a frame. Each piece is rigidly weighted to one bone
of the v4 skeleton and carries a `_part` id so the uniform shader paints it.
Triangle budget, revised 2026-10-08 after the owner saw the first pass:
8,000 to 12,000 per horn at high quality and about 2,500 at low, from the
same code at lower segment counts; drums follow the same ratio. 150 brass
at high add about 1.5 M triangles in instanced draws; the frame time is
measured, not assumed.

Why procedural: no modeling tool is available on this side, the maquette
style lives in proportion and finish rather than surface detail, the
geometry instances with the body for free, and a dimension change is a
number. Hand-modeled GLB assets are the alternative if the result reads as
too simple; the attachment and paint path below is the same either way.

**Material (revised 2026-10-08).** The first pass painted horns through the
uniform shader: flat-shaded, no metalness, one color. It cannot read as
brass. Instruments are instead their own instanced mesh per look group,
driven by the same bake texture through `instancedSkinning`, with a smooth
metallic `MeshStandardMaterial` (metalness about 1, roughness about 0.25) in
the look's finish color, with chrome and black hardware by part. Metal needs
something to reflect, so the scene gains an environment map generated from
the sky gradient over a bright ground, applied scene-wide (the fidelity
brief's "sky-baked environment lighting"). One extra draw call per brass
group. The part ids below remain the mesh's own attribute for the material
to color by.

**Parts and finish.** The uniform shader paints parts by id; it knows ids 0
to 15 today. Instruments take new ids from 16 upward: 16 brass finish (gold
lacquer by default, silver lacquer as the alternative), 17 reserved, 18 chrome, 19 drum shell (section color), 20 drum head, 21 bar
(rosewood), 22 black hardware, 23 wood (clarinet), 24 speaker grille. The
finish choice per section (lacquer or silver) is a look option like the hat
today. Painting new ids needs a change in the vendored
`uniform-shader.js`: that change goes to om-pose first, then is copied back,
as the vendor README requires. Until then the app patches the shader's
`onBeforeCompile` chain locally, which is allowed and already how the window
extends the material.

**Bones.** Horns ride `DEF-hand.R`, with the left hand's grip placed by the
hold so the hand lands on the instrument. Drums ride `DEF-spine.002` (the
carrier is a chest plate: a drum and its carrier are one rigid piece).
Flutes and clarinets ride `DEF-hand.R`, saxes ride `DEF-spine.003` by the
strap.

## 5. Holds: arm poses per instrument

A hold is a fixed pose of the eight arm bones (`shoulder`, `upper_arm`,
`forearm`, `hand`, L and R) in the body's frame. Before baking, the window
replaces those bones' tracks in every clip with the hold's constant
rotations, so the legs march as recorded while the arms hold the instrument.
One bake per (height class, hold); marchers sharing a hold share the rows.
Bake rows scale with holds, so §8 measures the budget first.

The holds, from the owner's reference photos (kept outside the repo) and
notes. Two rules hold across every state: **the hands never leave their
playing grip** (right hand on the valve caps, left hand behind the valves;
woodwind hands on their stacks), and at carry **the mouthpiece sits at eye
level** (the ligature, for woodwinds). The states differ by where the bell
points and where the elbows go.

- **brass, horns up.** The bell is front: forward at face height, horizontal. Upper arms
  out to the sides near horizontal, forearms up and in: a triangle slightly
  wider than equilateral from shoulder to shoulder to the hands. Baritone
  and euphonium: the same with the bell above eye line.
- **brass, carry (set and down are the same hold; owner, 2026-10-08).**
  Instrument vertical in front of the torso, mouthpiece at eye level, bell
  toward the ground, elbows in.
- **brass, trail.** Instrument in the right hand only, bell backward, valve
  block perpendicular to the ground, arm straight down the side. Left arm
  straight down, closed fist, thumb on top, along the leg.
- **trombone, horns up.** As brass with the left hand at the bell brace and
  the right hand on the slide at first position.
- **contra, horns up and carry.** The loop lies along the left shoulder,
  its plane outside the head and its bottom tube resting on the shoulder,
  bell forward and a little above the head. The valves sit at chin height
  in front, left of center; the right hand reaches across to them and the
  left supports the bottom tube at the front. (Placed by reasoning from the
  instrument's layout, 2026-10-08; the owner checks it against a photo of a
  player.)
- **flute.** Horizontal to the player's right, lips at the head joint, left
  hand near, right hand far. Carry: the same hands with the head joint
  raised so the embouchure hole sits at eye level.
- **clarinet.** Down the center line, angled 30 degrees out, left hand upper
  joint, right hand lower. Carry: vertical, ligature at eye level.
- **sax.** On the strap at the right hip, neck to the mouth, left hand upper
  stack, right hand lower stack. Carry: hands stay, the neck lifts so the
  ligature sits at eye level.
- **snare, tenors.** Drum at waist height on the carrier, forearms level,
  hands over the heads with sticks. Tenors wider.
- **bass.** Drum sideways on the chest, mallets held level at the heads,
  elbows out.
- **cymbals.** Pair held at chest height, plates vertical.

**Which hold plays when.** The show stores no horn state. Default: brass,
woodwinds and battery play their _up_ hold while the band moves or marks
time, and brass drops to _carry_ during full-band holds at attention.
_Down_ and _trail_ exist as holds and are reachable in the settings panel
("Horn state: automatic, up, carry, down, trail") so they can be seen and
checked. A per-page horn state is a later schema change.

**Tuning.** Each hold is a table of eight quaternions tuned by eye against
the photos, with the instrument attached, in the web preview in a real
browser. The hold table is data, so a second pass by a person who marches
is a number change.

## 6. Front ensemble and speakers: props

The owner's call (2026-10-08): the front ensemble and speakers are geometry
in the 3D View that function as props, not dots.

**Models** (ground-standing, not skinned):

- 4.3 octave marimba, 5 octave marimba, 3 octave vibraphone, 3.5 octave
  xylophone, each on its field frame with wheels, bars in rosewood or
  synthetic amber, resonators in black or gold.
- Synthesizer on a keyboard stand with a rack; aux percussion rack with a
  concert bass drum, suspended cymbals, a chime rack.
- Speaker stacks: a mid-high cabinet over a subwoofer, in black, on each
  side of the pit, with a mixer position behind.

**Placement.** Props need positions the show file doesn't have. Proposal:
a `view3d_props` table (`id`, `kind`, `x`, `y` in field pixels like
`marcher_pages`, `rotation_degrees`, `label`), edited in the 3D window's
panel with "Add prop", drag on the field and a rotation handle, and undo
through the existing history tables. The window already saves the venue
choice in the show the same way (`view3dVenue.ts`), so the pattern exists.
This is a schema and file-format change: it goes into ADR 0002 as an
amendment before any code, per the project rules.

**Default layout** so a show looks right before anyone places props: on
first open of a show with pit marchers, seed one prop per pit marcher at the
marcher's first-page dot (Marimba, Vibraphone, Xylophone, Synthesizer, Aux
Percussion each map to a model), facing the audience, and a speaker stack
on each end of that row, 2 m beyond the outer prop. The seed is a one-time
write the user can edit or delete; it never follows the dots afterward.

Pit marchers themselves keep marching bodies with no instrument, standing
behind their prop when their dot is there, which is the usual case.

## 7. Scope and order

Four pull requests into `3d-async`, each with screenshots from a real
browser:

1. **Brass and holds.** The hold pipeline (bake with replaced arm tracks,
   settings row), part ids and finish paint, and the seven brass models.
   Replaces the three placeholders.
2. **Woodwinds.** Eight models, three holds.
3. **Battery.** Carriers, five drums, cymbals, the bass size spread.
4. **Front ensemble props.** ADR amendment and migration first, then the
   models, the props panel and the seed layout.

## 8. Risks and what to measure first

- **Bake texture rows.** Holds multiply rows. Measure the texture at 5
  height classes × (today's clip count) × N holds against the float texture
  limit on the owner's machine and on a software renderer before fixing N.
  Fallback: bake only the holds a show uses (the window already bakes only
  the clips a show uses), and merge the low tier to one hold.
- **Arm tracks and the halt.** Replacing arm tracks removes the arm swing
  om-pose recorded for the step-off and halt. Instruments don't swing, so
  this is correct, but the clips' hands may clip the body at the halt;
  check the carry hold at attention.
- **Shader part ids.** Adding ids locally diverges from om-pose until the
  change lands there. Keep the patch in one file and list it in the vendor
  README's "Local changes" column.
- **Triangle budget.** A 300-piece band with instruments and 300 bodies is
  the P5.1 perf scene plus about 150 k triangles. Re-run that scene's
  frame-time check after PR 1.

## 9. Open questions for the owner

1. Answered: gold lacquer by default, silver lacquer per section.
2. Answered: always up; the panel exposes the others for testing.
3. Props: the table in §6 is the real fix. Is the ADR amendment acceptable
   now, or should PR 4 start with the seed layout only and no persistence?
4. Answered: carry, set and down are one hold with the bell to the ground.
   Horns up is the bell front.
