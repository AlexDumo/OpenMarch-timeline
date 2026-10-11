# 0004: Performer cues in the show file

- Status: proposed
- Date: 2026-10-10

## Context

The 3D View plays every marcher with the same behavior: horns always up, the
section's carry, the upper body facing the front, mark time while the band
moves. Its horn state, guard equipment and step-off foot are window toggles
that aren't saved. Designers need the show to say what performers do, count
by count: step style, horn state and angle, equipment work, facing and
choreography. Both a coarse layer ("guard: rifle work, counts 1-16") and
count-level detail are wanted.

The owner settled the behavior model on 2026-10-09 and 2026-10-10; the full
specification is [docs/3d/performer-behavior.md](../3d/performer-behavior.md).
It adds persistent tables (a file-format change), a public module in
`@openmarch/core`, and changes to the 3D View's sync contract (ADR 0002 D-4,
D-6, D-7), so `docs/conventions/architecture-decisions.md` requires this
record.

This builds on ADR 0001 (the timeline motion model, on `timeline-try-2`):
beats stay the time grid with stable ids, pages become flags, and motion lives
in timeline tables addressed by beat ordinals. The 3D branch rebases onto the
merged timeline first; this record's migration and number come after the
timeline's (ADR 0003 is the timeline's menu-actions record).

Alternatives considered:

- **Per-page columns on `marcher_pages`**: can't express count-level cues,
  targeting or phrases, and `marcher_pages` is frozen in timeline mode.
- **Per-marcher tracks** (a video-editor model): no targeting; a section
  change means editing every marcher.
- **Cues anchored to timeline moves or beat ordinals**: moves are created,
  resized and overridden, and ordinals are rewritten on every beat edit. A
  beat id needs no ripple.
- **Reusing the 2D appearance cascade** (`tag_appearances` and its dormant
  equipment columns): appearances are per page with first-non-empty
  precedence; cues need the latest cue to win over time. Two models with
  shared targets is clearer than one model with two rules.

## Decision

### D-1 Cues

A new table, `cues`:

- `id` integer primary key.
- `channel` text: `feet`, `horn_equipment`, `facing` or `body`.
- `kind` text: `state` or `phrase`.
- `target_kind` text: `band`, `section`, `tag` or `set`.
- `target_section` text, set only for `section` (marcher sections are text).
- `target_tag_id` integer, references `tags(id)` ON DELETE CASCADE, set only
  for `tag`.
- `beat_id` integer not null, references `beats(id)` ON DELETE CASCADE.
  Deleting counts deletes their cues; undo restores them.
- `value` text: a built-in id (`builtin:...`) or `show:<phrase_assets.id>`.
- `phrase_asset_id` integer, references `phrase_assets(id)` ON DELETE
  RESTRICT, set only for show phrases, so a phrase in use can't be deleted
  from under its cues.
- `length` integer, phrases only, at least 2.
- `transition_length` integer, states only, at least 1; null means the
  value's library default.
- `settings_json` text not null, default `'{}'`, validated by the value's zod
  schema from the library catalog.
- `ripple_json` text, nullable: `{ version: 1, span, order }` with order
  `drill`, `left_right`, `right_left` or `down_form`. Rejected on `feet`.
- `notes` text.
- the shared timestamps.

CHECK constraints keep the target, kind and value columns consistent. No
priority column: same-count, same-specificity ties go to the newest cue (the
higher `id`), and the editor flags them.

A cue's instant is the **start** of its beat row (the count's click, where
the 3D marchers' heel lands). Page flags keep their end-of-beat meaning.

### D-2 Hand-picked sets

`cue_marchers` (`cue_id` references `cues` ON DELETE CASCADE, `marcher_id`
references `marchers` ON DELETE CASCADE, primary key on both). The marcher
deletion write path deletes any `set` cue left with no members, in the same
transaction. No trigger reads or writes cue tables.

### D-3 Show phrase assets

`phrase_assets`: `id`, `name`, `label`, `source` (`copied_builtin`, `posed`
or `imported`; v1 writes only `copied_builtin`), `channels_json` (channels
taken over), `format_version` integer, `data_json` (the versioned phrase
format: bone rotations, an optional body-space prop path, an optional facing
turn, the stretchable section, the length range, the settings schema), and
timestamps. Built-ins aren't stored; cues reference them by id.

### D-4 Set and show settings

- `page_performer_settings` (`page_id` primary key, references `pages(id)` ON
  DELETE CASCADE; `dot_mode` text `foot` or `body`). No row means the show
  default.
- Workspace settings gain an optional `performerDefaults`:
  `{ stepOffFoot: "left" | "right", dotMode: "foot" | "body" }`, defaulting to
  left and foot.

### D-5 Migration and write paths

- One Drizzle migration generated with the repo scripts, numbered after the
  timeline's 0017 and 0018 and after the 3D branch's renumbered
  `view3d_venue`. It only creates tables and indexes (`cues(beat_id)`,
  `cues(channel, beat_id)`, `cue_marchers(marcher_id)`).
- No conversion step and no `user_version` bump: convert-on-open ignores
  tables it doesn't know, and beat ids survive conversion. The tables behave
  the same in page mode and timeline mode, and are not on the page-era freeze
  list. Nothing derives cue data from `marcher_pages`.
- All writes go through `transactionWithHistory`; the new tables join
  `tablesWithHistory`, get real query keys in `singleTableNameToQueryKey`,
  and are added to repair's copy order after `beats`, `pages`, `marchers`
  and `tags`.
- Converting a file clears undo history, cue edits included. Acceptable.

### D-6 Compile module

`@openmarch/core` exports a platform-free `cues` module:

- `CUE_LIBRARY`, `cueLibraryValue` and `defaultCueValue`: the built-in
  catalog's metadata, including each value's settings descriptors;
- `compileCues(input, recompile?)`, returning per-marcher, per-channel
  segments and flags, with an optional channel-at-a-time recompile;
- `traceCue(compiled, marcher, channel, count)` for the editor's "why"
  readout.

The exact shapes are in the spec's section 6. Its input and output types are
a public package API; changing them needs an amendment here.

### D-7 Amendments to ADR 0002

- **D-4 Sync:** the editor relays a synthetic `["timeline"]` query key on
  `view3d:invalidate` after each delivered timeline change batch or reset.
  No new channel. The `selection` payload stops depending on
  `selectedPageId` in timeline mode.
- **D-6 Positions:** in timeline mode `positions.ts` builds its own resolver
  from the timeline tables and samples it at count boundaries. Page mode
  keeps `marcher_pages` until the timeline drops it.
- **D-7 Performers:** facing comes from the Facing channel; "the upper body
  always faces the front sideline" becomes its default. Motion follows the
  compiled Feet channel (pace, techniques, stand on holds, step-off foot, dot
  mode per set). The window's horn state, guard equipment and step-off foot
  toggles stop being the source; at most they remain as unsaved preview
  overrides. Channels are baked as per-channel rows and composed once per
  frame, per performer and bone, in a GPU render-to-texture pass; skinning
  then reads one matrix per influence. Props get virtual bones. The om-pose renderer moves
  into the repo as owned code.

## Consequences

- **Older builds** ignore the new tables, so a show opened in one plays with
  the defaults. An older build that rewrites workspace settings drops
  `performerDefaults` (zod strips unknown keys), reverting to left foot and
  foot on the dot.
- **Precedence is tested logic**, not data: no priority numbers to manage,
  but every rule in the spec's resolution list needs unit tests in core.
- **Show phrase assets can outlive their use**; deleting one in use is
  refused until its cues go.
- **Built-in improvements change existing shows** by design. "Copy into show"
  is the way to freeze a phrase.
- **The 3D renderer becomes ours to maintain**, with its parity suite.
- **The appearance cascade's dormant equipment columns** stay in the schema
  until Alex approves dropping them.
- **New durable surface**: four tables, a workspace setting, a core API and
  an IPC key convention. Changing any of them needs a new record or an
  amendment.

## Verification

- Unit tests in `packages/core` for compile: defaults; latest wins;
  specificity on the same count; newest-wins clashes flagged; phrase overlays
  and overlaps; take-overs and the kneel-on-a-moving-count flag; fits;
  inclusive counting for transitions and phrases (including length 1 as a
  snap); ripple start times under a changing tempo for each order.
- Schema tests: the CHECK constraints reject inconsistent targets and kinds;
  ON DELETE behavior for beats, tags, marchers, pages and phrase assets.
- History tests: create, edit and delete cues, set members and phrase assets
  undo and redo; deleting a marcher that empties a set removes the cue, and
  undo restores both.
- Migration tests: a page-mode file and a converted timeline file both open
  with the new tables, and convert-on-open leaves cue rows intact.
- E2E: add a horn cue in the Visuals mode and see the 3D window follow
  without reopening; edit a timeline move and see the window's positions
  update.
- Performance: the spec's first-task measurements recorded in
  `docs/3d/findings.md` before channel layering merges.
