<!-- cspell:words Cubase Ableton Inkscape keyup -->

# Modifier roles: one map from keys to what they mean

Status: design proposal, 2026-10-28, for the shape host (`shapes/host`). Nothing changes in the
app until the owner accepts it. The implementation ticket is linked from the pull request.

## Why

The team can't settle Shift or Alt for fine control, and a tester asked for Shift. Today every
gesture reads `event.altKey` and friends itself, so changing the key for "fine" means editing a
dozen files, and the keys already mean different things in different parts of the app (below). The
proposal: gestures ask for a **role** (`fine`, `constrain`, `noSnap`, ...), and one module maps the
physical keys to roles. Today's mapping is the default, so nothing changes until someone picks a
different one.

Prior research on what other tools do (sources in the shape-host research notes,
`modifier-conventions.md`):

- Shift = constrain (equal sides, 15°/45° steps) is close to universal in 2D design tools: Figma,
  Sketch, Illustrator, Photoshop, Affinity, Keynote, SketchUp. Inkscape uses Ctrl.
- Alt = from center in Figma, Sketch, Illustrator and Photoshop.
- No snapping = Cmd/Ctrl in Figma, Sketch and Photoshop.
- Fine control has no standard. Shift in Blender (1/10) and the DAWs (Logic, Ableton 12, Cubase);
  Cmd/Ctrl in After Effects and Maya. 2D design tools mostly have none. "Alt = fine" is
  OpenMarch's own choice.

## 1. Audit: where the app reads modifiers today

Searched `timeline/shapes/host` at 69285ea97 for `altKey|shiftKey|metaKey|ctrlKey|getModifierState|
isMacPlatform|keysOf` and for the normalized fields they feed (`pointer.shift/alt/ctrl/meta`,
`keys.*`, `env.shift/fine/mod/snap/pull`, `isShiftHeld`, `isRangeModifier`). Tests excluded.
**167 raw hits in 54 files, about 70 distinct reads.** No code uses `getModifierState`.

Paths are under `apps/desktop/src/` unless they start with `packages/`.

### Pointer gestures: these become roles

Shape tool, frame and placed boxes. All of them go through `keysOf` → `toolEnvFor`, which is
already a small role layer (`snap`, `pull`, `fine`, `shift`, `mod`):

| Where                                                                             | Key                                           | What it does                                                                             | Role                                                                |
| --------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `shapes/field/fieldModeBase.ts:24` `keysOf`                                       | Shift, Alt, $mod (Cmd on Mac, Ctrl elsewhere) | Reads the keys off a `FieldPointer` for every shape gesture                              | **Becomes `rolesOf`**                                               |
| `shapes/tool/toolEnv.ts:50-56`                                                    | Alt                                           | `fine`: off the half-step ladder; guides still pull; `gridSnap` returns the point as is  | `fine`                                                              |
| `shapes/tool/toolEnv.ts:50-51`                                                    | $mod                                          | `snap` and `pull` both off: nothing snaps (owner on #453)                                | `noSnap`                                                            |
| `shapes/box/boxGeometry.ts:777, 1025`                                             | Shift                                         | Equal across and deep spacings while drawing or dragging a corner                        | `constrain`                                                         |
| `shapes/box/edgePull.ts:76`                                                       | Shift                                         | No edge pull while equalizing                                                            | `constrain` (side effect)                                           |
| `shapes/kinds/line.ts:131-133`, `arc.ts:322-323`, `curve.ts:199`, `circle.ts:152` | Shift                                         | Endpoint or rim snaps to 45°                                                             | `constrain`                                                         |
| `shapes/kinds/block.ts:352`                                                       | Shift                                         | Block rotation handle snaps to 15°                                                       | `constrain`                                                         |
| `shapes/frame/frame.ts:264-265`, `shapes/frame/gestures.ts:386`                   | Shift                                         | Rotation in whole degrees instead of 15° steps; Alt or $mod frees it                     | `constrain` today. Note that 1° is _finer_ than the default, see Q3 |
| `shapes/frame/gestures.ts:120`                                                    | $mod                                          | Pressing the center grabs the pivot instead of the shape                                 | `pivot` (another target, not a drag modifier)                       |
| `shapes/frame/gestures.ts:186`, `shapes/frame/pivot.ts:60`                        | Alt                                           | Pivot drag doesn't snap to marchers                                                      | `fine`                                                              |
| `shapes/placed/liveBoxMode.ts:159, 192, 239`, `shapes/tool/shapeToolMode.ts:336`  | via `keysOf`                                  | Same env as the tool                                                                     | (all roles)                                                         |
| `shapes/editor/ScrubNumber.tsx:161-163`, `shapes/editor/scrub.ts:15-18, 30-39`    | Alt, Shift, $mod                              | Number scrub: Alt = hundredths of a step (#411); $mod = no snap; Shift is passed through | `fine`, `noSnap`, `constrain`                                       |
| `shapes/tool/ShapeToolKeys.tsx:51`, `shapes/placed/PlacedBoxKeys.tsx:78`          | none: `alt: !nudge.snap`                      | Keyboard nudge maps a no-snap nudge onto the Alt env                                     | Should ask for `fine` by role, not fake Alt                         |

Field editor (the three.js field, #193 to #198), through `field/three/fieldPointerInput.ts:31-34`,
which copies `shift/alt/ctrl/meta` onto `FieldPointer`:

| Where                                                                                       | Key               | What it does                                                                               | Role                                                                       |
| ------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `field/editor/moveGesture.ts:98-107`, `field/editor/moveRules.ts:117`                       | Alt               | Precision drag at quarter speed; pressing Alt mid-drag re-anchors on the drawn spot (#197) | `fine`                                                                     |
| `field/editor/moveRules.ts:44`                                                              | Shift or Alt      | Marcher drag doesn't snap to the grid                                                      | `noSnap` (Shift); Alt via `fine`                                           |
| `field/editor/transformGestures.ts:91, 137-146`, `field/editor/itemTransform.ts:144`        | Alt; Shift or Alt | Precision on handle drags; rotation free of 15° steps                                      | `fine`; `noSnap`                                                           |
| `field/editor/transformGestures.ts:96`, `field/editor/groupTransform.ts:161`                | Shift             | Corner scale stops being proportional (`free`)                                             | `constrain`, inverted: here proportional is the default and Shift frees it |
| `field/editor/fieldEditor.ts:595, 996-1007`                                                 | Shift             | Click adds or removes; a Shift press on a group member toggles the group and doesn't drag  | **Selection**, not a drag modifier                                         |
| `field/editor/areaGestures.ts:81, 123`                                                      | Shift             | Marquee and lasso add to the selection                                                     | **Selection**                                                              |
| `field/editor/fieldEditor.ts:420`                                                           | Ctrl or Meta      | The prop tool ignores the press                                                            | Selection/other                                                            |
| `field/editor/view.ts:250-254`, `field/three/fieldNavigation.ts:311`, `fieldEditor.ts:1185` | Mac Ctrl+left     | Pans (it is a right-click on a Mac)                                                        | **Navigation**, never assignable                                           |
| `field/editor/view.ts:208`, `fieldNavigation.ts:398`                                        | Ctrl/Meta + wheel | Pinch zoom                                                                                 | Navigation                                                                 |

Timeline drags:

| Where                                                                                                                                                              | Key      | What it does                                                                      | Role                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------- | ------------------------- |
| `components/timeline/TimelineGeometry.ts:549` `isPageSnapDisabled`                                                                                                 | Alt      | Page and beat snapping off                                                        | `noSnap`                  |
| `TimelinePageFlagGrips.tsx:276-288, 383, 400`                                                                                                                      | Alt      | Page flag drag without snapping                                                   | `noSnap`                  |
| `TimelinePrimitives.tsx:574-584, 667-669, 3166, 3234-3238`                                                                                                         | Alt      | Playhead scrub and seek without snapping                                          | `noSnap`                  |
| `TimelineLoopBar.tsx:77-80, 129, 145`                                                                                                                              | Alt      | Loop ends without snapping                                                        | `noSnap`                  |
| `visuals/VisualsCueBand.tsx:262, 292, 324`                                                                                                                         | Alt      | Cue drag without snapping                                                         | `noSnap`                  |
| `TimelinePrimitives.tsx:3094` `isRangeModifier`, `:630, 1731, 1791, 3254`, `TimelineClipResize.tsx:488`, `TimelinePageFlagGrips.tsx:315`, `VisualsCueBand.tsx:210` | $mod     | A drag draws a range instead of scrubbing (UI-12); clips and grips let it through | `range` (press-time mode) |
| `TimelinePrimitives.tsx:637, 3258`                                                                                                                                 | Mac Ctrl | Context menu, not a seek                                                          | Navigation/other          |

### Not gesture modifiers: stay as they are

| Where                                                                                                                                                                                                        | Key                        | What it does                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `TimelinePrimitives.tsx:1107, 1734`, `VisualsCueBand.tsx:305`                                                                                                                                                | Shift                      | Page box and cue selection extend or add                                                                                |
| `toolbar/tabs/ChipSelector.tsx:188, 219, 313`, `SelectTab.tsx:66-292`                                                                                                                                        | Shift (or on-screen Shift) | Select tab adds to the selection                                                                                        |
| `TransportButtons.tsx:146-150, 187, 214-227`                                                                                                                                                                 | Shift, Alt, $mod           | Previous/Next: beat, edge; Play variants                                                                                |
| `view3d/window/overlay/playback.ts:23-49`, `View3dOverlay.tsx:140`                                                                                                                                           | Shift, Alt, $mod           | 3D transport keys (mirror of the shortcuts)                                                                             |
| `timelineHotkeys.ts:54-90`                                                                                                                                                                                   | Ctrl, Meta                 | Nudge and Space filtering                                                                                               |
| `TimelineVariants.tsx:229, 318-327`, `useTimelineFollow.ts:416`                                                                                                                                              | Ctrl/Meta wheel, Shift+Z   | Zoom, fit                                                                                                               |
| `TimelineAppendAtPlayhead.tsx:101, 127`                                                                                                                                                                      | Shift                      | Append a subset page (the pill shows it live)                                                                           |
| `TimelineSplitter.tsx:135`                                                                                                                                                                                   | Shift                      | Splitter key step × 4 (coarser)                                                                                         |
| `visuals/FacingWheel.tsx:36, 70`                                                                                                                                                                             | Shift                      | Facing steps of 45° (coarser)                                                                                           |
| `PlaybackSpeedButton.tsx:87`                                                                                                                                                                                 | Shift                      | Speed steps down instead of up                                                                                          |
| `TimelineKeyframes.tsx:257`, `TimelinePrimitives.tsx:1769`                                                                                                                                                   | Shift+F10                  | Context menu                                                                                                            |
| `view3d/window/camera/CameraRig.tsx:325, 350, 410, 441`, `inputMath.ts:26`                                                                                                                                   | Shift, Alt, Ctrl           | 3D camera: pan instead of orbit, pinch                                                                                  |
| `ScrubNumber.tsx:123`, `DockedCommandBar.tsx:113-128`                                                                                                                                                        | Shift+Tab                  | Focus order                                                                                                             |
| `shortcuts/bindings.ts:124-127`, `keymap.ts`, `labels.ts`, `ShortcutSettings.tsx:81-84, 237`, `SettingsWindow.tsx:21`, `CommandPalette.tsx:295`, `ShortcutsDialog.tsx:94`, `ShortcutOverridesStore.ts:63-73` | all                        | The shortcuts registry itself                                                                                           |
| `packages/ui/src/components/base/DragInput.tsx:213-308`                                                                                                                                                      | Shift                      | Inspector number drag: `dragSensitivityWithShift` and rounding. A "fine" in effect, in a shared package; see the ticket |
| `shapes/distribute/layouts.ts:226`                                                                                                                                                                           | none                       | An unrelated `keysOf` (layout keys)                                                                                     |
| `components/canvas/touch/canvasModifiers.ts:13` `isSnapOff`                                                                                                                                                  | Shift / on-screen          | Old Fabric-era rule, no callers left: delete                                                                            |

### What the audit shows

1. **The meanings already disagree.** "No snap" is $mod in shapes, Shift (or Alt) on the field,
   and Alt on the timeline. Keyboard nudges (`shortcuts/definitions.ts:93-136`) say Shift+arrow
   = **fine** (quarter step) and Alt+arrow = free, while pointer drags say Alt = fine. So a
   tester asking for Shift = fine is asking for what the arrow keys already do.
2. **Shift is three things:** constrain while drawing shapes, no-snap and free-ratio on the field,
   and add-to-selection on clicks.
3. **Mid-drag changes only land on the next pointer move.** Nothing listens for `keydown`/`keyup`
   during a gesture, so pressing Alt with the mouse still does nothing until it moves.
4. **Touch:** `stores/TouchModifierStore.ts` holds on-screen Shift and Alt (held or latched), but
   only `ChipSelector` reads it; the field editor ignores touch presses entirely
   (`fieldPointerInput.ts`, `pointerType === "touch"`).
5. **"From center" doesn't exist yet.** No gesture draws from the center, so Alt isn't needed for
   it today; the role is reserved.

## 2. The role module

A new pure module, `apps/desktop/src/input/modifierRoles.ts`, plus a small store for the chosen
mapping. Everything that reads a modifier for a gesture asks it.

```ts
/** What a held key means for a gesture. Click and navigation meanings are not roles. */
export type GestureRole =
  | "fine" // slower or finer: off the ladder, hundredths, quarter speed
  | "constrain" // equal spacings, 45° and 15° steps, proportional scale
  | "noSnap" // nothing snaps or pulls
  | "fromCenter" // reserved: draw or scale about the center
  | "pivot"; // press-time: the center press grabs the pivot

/** Where the gesture happens; a context lists the roles it honors */
export type GestureContext =
  | "shape" // shape tool, frame, placed boxes, ScrubNumber
  | "field" // marcher move, handles, rotate, scale on the field
  | "timeline"; // playhead, flags, loop, cues, clip edges

/** The keys a role can take: never Mac Ctrl (it is a right-click), never Meta on Windows/Linux */
export type RoleKey = "Shift" | "Alt" | "$mod";

/** Physical state: from an event, OR'd with the on-screen toggles */
export interface HeldKeys {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
}

export type Roles = Readonly<Record<GestureRole, boolean>>;

export function heldKeysOf(event: {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): HeldKeys;

/** Pure: which roles are on, for this context, under this map */
export function rolesOf(
  keys: HeldKeys,
  context: GestureContext,
  map?: RoleMap, // default: the current preset
  isMac?: boolean, // default: isMacPlatform(); resolves $mod
  onScreen?: ReadonlySet<GestureRole>, // touch and Pencil toggles, OR'd in
): Roles;

/** The key a role uses here, for hints ("⌥ fine"), tooltips and docs */
export function keyForRole(
  role: GestureRole,
  context: GestureContext,
): RoleKey | null;

/** React: the live roles while a gesture runs, for the on-drag hint */
export function useGestureRoles(context: GestureContext): Roles;
```

The map is data, a preset of role → key per context:

```ts
type RoleMap = Readonly<
  Record<GestureContext, Partial<Record<GestureRole, RoleKey>>>
>;

/** Today's behavior, exactly */
export const CURRENT: RoleMap = {
  shape: { fine: "Alt", constrain: "Shift", noSnap: "$mod", pivot: "$mod" },
  field: { fine: "Alt", noSnap: "Shift", constrain: "Shift" }, // constrain inverted: frees ratio
  timeline: { noSnap: "Alt" },
};
```

`toolEnvFor(field, keys)` changes to `toolEnvFor(field, roles)`; `env.shift` becomes
`env.constrain` and `env.mod` becomes `env.noSnap` (or stays, read from `roles`). `keysOf` goes
away. The field editor's `FieldPointer` keeps raw keys (the editor is shared with the timeline-mode
field and tests) and gains `roles` computed once in `fieldPointerInput`.

### Platform and $mod

`$mod` resolves the same way as the shortcuts registry (`shortcuts/bindings.ts`, `platform.ts`):
Cmd on a Mac, Ctrl elsewhere. Mac Ctrl+left is a right-click that pans the field and opens menus,
so no role may use it; Windows/Linux Meta is the OS key, so no role may use it either. That is why
`RoleKey` has only three values.

### Live changes mid-drag

A gesture samples roles on press and on every move, like today, **and** a `RoleTracker` listens
to `keydown`/`keyup` on the window while a gesture is active and re-runs the gesture's last move
when a role flips. `blur` clears every key (a held Alt is lost when the window loses focus). The
field's #197 rule (Alt pressed mid-drag re-anchors on the drawn spot) becomes "`fine` turning on
re-anchors", so it follows the key if the key changes.

### Press-time and click-time meanings

Some keys mean something at the press, before any drag exists: Shift adds to the selection,
$mod draws a timeline range or grabs the pivot. Rule:

> A key that the **press** used (to add to the selection, to pick a range or the pivot) is not
> read as a drag role until it is released. Pressing it again mid-drag turns the role on.

This is what keeps Shift-click from turning into a Shift drag. The click meanings stay in their
own code (`fieldEditor.click`, page box selection) and are not configurable: Shift = add is as
universal as Shift = constrain and nobody has asked to change it.

### Touch and Apple Pencil

There are no modifier keys on a tablet. `TouchModifierStore` becomes role toggles: the floating
button offers **Fine**, **Equal** (constrain) and **No snap**, held or latched, and `rolesOf` ORs
them in through `onScreen`. A tablet user never sees a key name, so a key remap doesn't move the
buttons. The old `isShiftHeld`/`isAltHeld` stay for the Select tab's add-to-selection.

### The shortcuts registry

Roles are not actions: nothing fires on a keypress, they are held while a pointer does something.
So they don't go into `ACTIONS`, but they share three things with it:

1. **Platform resolution** (`$mod`) and **labels** (`shortcuts/labels.ts`, so a hint shows ⌥ on a
   Mac and Alt elsewhere).
2. **Keyboard nudge variants follow the roles.** `NUDGE_VARIANTS` in `definitions.ts` derive their
   bindings from the map: the fine nudge is `fine key + arrow`, the free nudge is `noSnap key +
arrow`. Today's bindings already disagree with the pointer (Shift+arrow is fine), see Q2.
3. **Conflict detection.** `keymap.ts`'s `BindingConflict` checks action against action. Roles
   add one rule per context: two roles can't share a key (`field`'s Shift for both noSnap and the
   freed ratio is today's one exception, kept for parity, see Q4). A modifier plus a key is a
   shortcut, a modifier alone is a role, so the two can't collide; the only overlap is the nudge
   derivation above.

**Settings › Shortcuts later: yes**, as a short "While dragging" section above the actions:
one row per role with a three-way key picker (Shift / Alt / ⌘ or Ctrl). Picking a key that another
role uses swaps them, so the map is always valid. Ship presets first, per-role picking after.

## 3. Conflicts if fine became Shift

| Conflict                                                                                          | What happens with Shift = fine                                                    | How the roles handle it                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Constrain is Shift today** (equal spacings, 45°, block 15°, whole-degree rotate)                | Both can't be Shift                                                               | Constrain moves to another key, Alt in the trial preset. This is the real cost: it breaks the near-universal Shift = constrain of 2D design tools |
| Shift-click adds to the selection on the field and the timeline; marquee and lasso with Shift add | A Shift-press-drag would both add and go fine                                     | The press-time rule: Shift used by the press doesn't count as `fine` until released. Selection code is untouched                                  |
| Field marcher drag: Shift = no snap; corner scale: Shift = free ratio                             | Shift would mean fine _and_ no snap                                               | The `field` context gets its own row: fine = Shift, noSnap = Alt in the trial (fine already turns snap off on the field)                          |
| Shift+arrow nudge                                                                                 | Already fine (quarter step)                                                       | No conflict; it becomes consistent                                                                                                                |
| Shift+R, Shift+E/Q, Shift+F, Shift+Space, Shift+Z, Shift+P/N/V/H                                  | None: these fire on a letter keydown, and roles only matter while a pointer drags | No change. During a drag, letter shortcuts in the canvas scope stay as they are                                                                   |
| Timeline: Shift on Previous/Next = beat, Shift on a page box = extend                             | Clicks, not drags                                                                 | Not roles; untouched                                                                                                                              |
| 3D camera: Shift-drag pans                                                                        | Camera navigation                                                                 | Not roles; untouched                                                                                                                              |
| Inspector `DragInput` (packages/ui): Shift = slower                                               | Already Shift = fine                                                              | It takes a `fine` callback from the app instead of reading Shift, so it follows the map                                                           |
| Windows/Linux: a lone Alt press shows the menu bar in Electron when the menu is auto-hidden       | Not a Shift problem, but it hits Alt = fine today                                 | Not verified on this branch; the ticket checks it                                                                                                 |

## 4. Recommendation

**Default: keep today's mapping** (`CURRENT`: Alt = fine, Shift = constrain, $mod = no snap in
shapes). Shift = constrain is the one modifier rule designers carry from every 2D tool, and fine has
no standard to beat it. Reasons to reconsider: our arrow nudges already say Shift = fine, and band
directors who come from Blender or a DAW will reach for Shift.

**Let testers try both, cheaply:** two presets, `CURRENT` and `SHIFT_FINE`:

```ts
export const SHIFT_FINE: RoleMap = {
  shape: { fine: "Shift", constrain: "Alt", noSnap: "$mod", pivot: "$mod" },
  field: { fine: "Shift", noSnap: "Alt", constrain: "Alt" },
  timeline: { noSnap: "Alt" },
};
```

- **Lab:** the existing Version switch (`lab/labVariant.ts`, fork PR #125). The role store reads
  `getLabVariant() === "shift-fine"`; a lab test lists `variants: [default, shift-fine]`, and the
  feedback records which one was on. No settings UI, nothing to undo after the test.
- **Desktop testers:** a hidden UI setting `modifierPreset: "current" | "shiftFine"` (default
  `current`), settable from the ⌘K palette action "Use Shift for fine control" until the Settings
  section exists.
- **On-drag hint** (from the prior research): while a shape or field drag runs, a small chip near
  the cursor shows the live roles (`⌥ fine · ⇧ equal`). It makes either mapping discoverable and
  shows testers which preset they're on.

Per the lab rules, the variant switch doesn't go to OpenMarch `main`: keep the preset that wins.

## Questions for the owner

1. Keep Alt = fine as the default, or switch after the lab test?
2. Should the arrow nudges follow the pointer map (Alt+arrow = fine) or stay (Shift+arrow = fine)?
   With `SHIFT_FINE` the two agree with no change.
3. Shape rotation: default 15°, Shift = whole degrees. Is whole degrees `constrain` (as now) or
   `fine` (it is the finer step)? If fine moves to Shift, both answers give Shift.
4. The field: unify with shapes (no snap = $mod, Shift = constrain/proportional), or keep its own
   row? Today the field and the shape tool disagree on what Shift and no-snap are.
5. Should the timeline's no-snap (Alt) follow the shape map's `noSnap` ($mod)? $mod already draws a
   range there, so probably not; the timeline keeps its own row.
