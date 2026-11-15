# 0015: Cue model: one parameter per cue type

<!-- cspell:words shako -->

- Status: proposed. Draft for the owner's design pass of 2026-11-15. The open
  decisions at the end are worked through before it is accepted.
- Date: 2026-11-15
- Supersedes in part: [ADR 0004](0004-performer-cues.md) D-1 to D-3 and its
  channels, including those of its 2026-10-11 amendment. ADR 0004's compile
  module (D-6), 3D View amendments (D-7), beat deletion rule (2026-10-15) and
  performer defaults (2026-11-11) stand.

## Context

Three issues wait on the cue model:

- **#966 equipment changes:** the guard switches between rifle, flag and
  sabre. Show it now, select "Rifles" by who holds one at a moment, and handle
  logistics such as put-downs later.
- **#976 look changes:** reveals, capes off, lights on the uniform or shako,
  unzipping that changes the color scheme.
- **#775 mark time:** marchers mark time too often, and nothing can say
  "stand here" for some of them.

The owner (Alex) gave the model on 2026-11-14:

> A cue just means a definition at a moment in time, and it's either relevant
> for just that moment or perpetuates until the next cue of that type
>
> To me, a cue modifies an entity of a component (the performer) and each cue
> type controls a specific param.

The owner also wants the timeline to have separate views or lanes for
equipment, visuals, facings and so on.

ADR 0004 is the earlier design, from the 3D work. Its compiler shipped
(`packages/core/src/cues`) and drives the 3D View with show defaults only. Its
storage, Visuals mode and item placement are parked on
`archive/pre-convergence` (002b6da97), and ADR 0011 dropped their tables.

### The parked design against the owner's model

**Where it agrees**

- A state cue is the owner's lasting cue: the latest one at or before a count
  wins.
- A cue sits on a beat id, and its instant is the count's click.
- Defaults are never stored. Each has a show setting, and a cue changes it
  from a count (2026-11-11 amendment).
- Carry, Silk and Uniform each hold one value and cut on their count.
- Compile is pure, and it can say why a performer does something on a count.

**Where it is more complex than the model needs**

| Parked design                                                                                                                                                                                                                                 | Why it is more than the model needs                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Channels are body regions.** `feet` holds pace, moving technique, hold technique and step-off foot. `horn_equipment` holds horn position and angle, stick position, guard position and equipment work. `body` holds posture and choreography. | A cue sets one of them and resets the others to their defaults, because the latest cue wins the whole channel.                   |
| **Phrases** are a second kind of cue with their own library values, a minimum of 2 counts, stretchable sections, overlap flags, a `phrase_assets` table and "copy into show".                                                                  | The model needs only "for just that moment". The rest is animation authoring.                                                    |
| **Take-overs:** a cue on one channel owns another (kneel over Feet, choreography over Horn/Equipment).                                                                                                                                         | A cue type controls one parameter. Which body parts an animation moves is the renderer's business.                               |
| **Ripples** and **per-cue transition lengths**.                                                                                                                                                                                                | Neither is in the model. Both can be added later without changing it.                                                            |
| **Library values** (`library:<uuid>@<version hash>`) for Carry, Silk and Uniform.                                                                                                                                                             | The embedded Library is no longer on fork main. Looks get their own model in #972.                                               |
| **Item placement beside cues:** each item has holders, hands, crew, ripple groups and a beat rank.                                                                                                                                             | That is logistics, which #966 puts later. Seeing equipment needs only "this performer holds a rifle from count 40".               |

**What is missing**

- **"For just that moment" on every type.** Phrases exist only on Horn/Equipment
  and Body, and they are never one count long. "Lights on for this count" can't
  be said.
- **Lights.** There is no channel for them. Hats and capes exist only as a
  whole-uniform swap.
- **Selecting by current state.** Targets are fixed groups (band, section, tag,
  hand-picked). Nothing answers "who holds a rifle on count 40", for selecting
  or for aiming a cue.
- **Equipment on the 2D field.** Only the 3D View would show it.
- **"Stand here".** In the parked storage it takes a Feet cue that restates
  pace, technique and step-off foot.

## Decision (proposed)

### D-1 The model

- **Entity:** a performer (a `marchers` row of type `marcher`). Props may get
  cues later; `item_geometry` already follows the same rule.
- **Parameter:** one thing about a performer that can change during the show.
- **Cue type:** controls exactly one parameter.
- **Cue:** a type, a value, a moment and who. The moment is a beat id, at the
  count's click (ADR 0004 D-1).
- A cue is **lasting** or **momentary**, chosen per cue:
  - **Lasting:** sets the parameter from its moment until the performer's next
    lasting cue of that type.
  - **Momentary:** applies for a length in counts (1 unless the value says
    otherwise), then the lasting value shows again. It never changes the
    lasting value.
- Before a performer's first cue of a type, the parameter has its **default**:
  a show setting or the section's, never stored as a cue.
- No take-overs, ripples, per-cue transition lengths or phrase assets. How a
  change animates is the value's business.

### D-2 Cue types

Each row is one cue type. The view is its lane group on the timeline (D-6).

| View      | Cue type   | Parameter                      | Values                                                                     | Default                    |
| --------- | ---------- | ------------------------------ | -------------------------------------------------------------------------- | -------------------------- |
| Equipment | Equipment  | What the performer holds       | The section's instrument, flag, rifle, sabre, nothing                      | The section's usual        |
| Equipment | Position   | How it is held                 | Horn up, down, trail; sticks playing, in, down; set, port, present         | Up, playing or set         |
| Equipment | Silk       | A held flag's design           | Plain color; artwork later                                                 | The section's color        |
| Looks     | Look       | Which uniform look             | A look from #972                                                           | The band or guard look     |
| Looks     | Lights     | Lights on the uniform          | Off, on                                                                    | Off                        |
| Facing    | Facing     | Where the performer faces      | Front, back, side 1, side 2, direction of travel, an angle, toward a point | Front                      |
| Movement  | Hold style | The feet while the dot holds   | Stand, mark time, high mark time                                           | The show setting           |
| Movement  | Pace       | Steps per count                | Single, half, double                                                       | Single                     |
| Movement  | Step style | The moving technique           | Straight leg, bent leg, high step                                          | Straight leg               |
| Body      | Posture    | The body's posture             | Neutral, kneel                                                             | Neutral                    |

- Tosses, spins and body visuals are momentary values on Position and Posture.
- One rule crosses types: a Position value applies only to performers holding
  equipment it fits (horns up skips a rifle). When Equipment changes, Position
  returns to the new equipment's default until its next cue.
- Step-off foot and dot mode stay show settings, with no cue type.
- Hats and capes become their own on/off types once garments exist (#971).

### D-3 Who a cue reaches

A cue names one **group**, resolved to performers at the cue's moment:

- everyone;
- a section;
- a tag;
- drill numbers (hand-picked);
- **by current value:** the performers whose Equipment is a given value at the
  cue's moment, such as "holding a rifle". An Equipment cue reads the value
  just before its count, so "rifles to flags" and "flags to rifles" on one
  count is a clean swap.

For each performer and type, the latest cue at or before a count wins. On the
same count the narrower group wins (everyone, then section, then tag or
current value, then drill numbers), then the newest cue.

**Selecting** uses the same groups. "Rifles" is whoever holds a rifle at the
playhead, whatever their section or drill number (#377's `#rifles`). Core
answers "who holds what on count N" from the compiled cues.

### D-4 Equipment

- Equipment belongs to the performer: "G3 holds a rifle from count 40".
- The default comes from the section: a Rifle section holds rifles, Flag and
  Color Guard hold flags, winds and battery hold their instrument.
- The 2D field and the 3D View both show what each performer holds at the
  playhead.
- Logistics (put-downs, pick-ups, who carries what) come later, as items with
  their own placement. They add to an Equipment cue and don't replace it.
- Appearances' dormant `equipment_name` and `equipment_state` columns stay
  unread.

### D-5 Looks and mark time

- **Look** switches the whole look, which covers a reveal, an unzip that
  changes the colors, and half the band in another uniform. **Lights** is its
  own type, so lights don't multiply the looks. Both wait for the looks model
  (#972).
- **Hold style** is how a designer says "stand here": a lasting cue for a group
  from a count. The show setting stays the default.

### D-6 Timeline lanes

- One lane per cue type, shown on demand in the timeline under the drill rows,
  grouped by view: Equipment, Looks, Facing, Movement, Body. Hidden by default.
- A lane draws each lasting cue as a bar to the next one, and each momentary
  cue as a block of its length.
- A prototype settles the rows inside a lane before it is built.

### D-7 Storage

- `cues`: `id`, `type`, `beat_id`, `value`, `settings_json`, `length` (null for
  a lasting cue), `target_kind`, `target_section`, `target_tag_id`,
  `target_value`, `notes` and the shared timestamps.
- `cue_marchers` for drill-number groups, as in ADR 0004 D-2.
- `type` and `value` are checked in code, not by a CHECK constraint. A build
  that doesn't know a type keeps its cues and ignores them, so a new type needs
  no migration.
- ADR 0004's write rules stay: history, repair, and carrying cues forward when
  beats are deleted, per type and group.

### D-8 Compile

`@openmarch/core`'s cue module keeps its shape (compile, trace, flags). Its
public types change: `CueChannel` becomes the cue types of D-2, a cue is
lasting or momentary, groups gain "by current value", and a new query answers
who has a value on a count. Take-overs, ripples and transitions leave the
input and output.

### What comes back from the archive, and what doesn't

**Comes back, simplified**

- the `cues` and `cue_marchers` tables, their write paths, undo and query
  hooks (`db-functions/cues.ts`, `useCues`);
- the beat deletion rule;
- the 3D window reading stored cues (`useStoredCues`);
- the lane drawing, the who list and the why readout, as starting points for
  the lanes (`VisualsCueBand`, `visualsLanes.ts`, `visualsWho.ts`,
  `visualsWhy.ts`).

**Stays parked**

- item placement, holders, crew and artwork slots, until logistics;
- the embedded Library and `library:` values.

**Dropped**

- `phrase_assets` and the phrase asset format;
- take-overs, ripples and per-cue transition lengths;
- the `horn_equipment`, `feet` and `body` channels as cue targets;
- Visuals mode as a separate workspace.

### Build order

1. Core types, storage and undo.
2. Equipment and Hold style end to end: set them for a selection, see them in
   2D and 3D, select by equipment, and one lane each.
3. Facing and Position.
4. Look and Lights, after #972.
5. Momentary values: tosses and visuals.
6. Logistics.

## Open decisions

Worked through with the owner one at a time. Each is settled when its line
gains an answer.

1. One parameter per cue type, which splits `feet`, `horn_equipment` and
   `body`.
2. Lasting or momentary is chosen per cue, and a momentary cue has a length.
3. A "holding a rifle" group follows the show: it is resolved at the cue's
   moment, not frozen when the cue is written.
4. Equipment belongs to the performer, and item placement waits for logistics.
5. Look and Lights are separate types.
6. Mark time: the show default, and Hold style for exceptions.
7. Lanes on demand in the main timeline, not a separate workspace.
8. Drop take-overs, ripples, transition lengths and phrase assets.
9. The build order.

## Consequences

- A cue can never reset a parameter it doesn't name.
- More cue types than channels: ten against seven. Lanes are shown on demand,
  so the timeline stays calm.
- `@openmarch/core`'s cue types change, which is a public package API change.
  The 3D View's compile call changes with it.
- Two new tables return to the file format. Older builds ignore them and play
  the defaults.
- Shows need no conversion: no file on fork main holds cues.
- Tosses and choreography lose their authoring format until momentary values
  are built.

## Verification

- Compile unit tests: one parameter per type (a Hold style cue leaves Pace
  alone); lasting and momentary cues, including one count; current-value
  groups, including the same-count swap; the Position fit rule; defaults.
- Schema and history tests for the two tables, and the beat deletion rule.
- An unknown cue type survives a save in a build that doesn't know it.
- End to end: set a rifle for the selection at a count; the 2D field and the
  3D View show it from that count; "select rifles" picks those performers
  there and not before.
