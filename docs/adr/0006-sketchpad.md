# 0006: Sketchpad, a drawing package hosted by the app

- Status: proposed
- Date: 2026-10-19

## Context

Designers want to sketch forms freely on their field, as they would on paper, without marchers,
counts or music. The brief and the owner's answers are in
[docs/sketchpad/DECISIONS.md](../sketchpad/DECISIONS.md). The UX spec is
[docs/sketchpad/design/ux-spec.md](../sketchpad/design/ux-spec.md). The engine research is
[docs/sketchpad/research/engines.md](../sketchpad/research/engines.md).

This feature adds tables to the show file, adds a second app window that writes to the file, adds a
large third-party dependency, and adds a new publishable package. Under
`docs/conventions/architecture-decisions.md`, those changes need a record.

A spike (`prototypes/sketchpad/`, see its `RESULTS.md`) showed the following:

- Excalidraw 0.18.1 can draw over a field underlay that is kept in step with Excalidraw's scroll
  and zoom. The median drift was 0.5 px or less.
- A one-line roughjs patch adds the three dot fills. They survive save, undo, paste and export.
- Composited SVG, PNG and vector PDF exports work.
- Two tabs stay in sync with `reconcileElements`.

Alternatives considered:

- **tldraw.** It is the most extensible option. Production use needs a license key and the free tier
  carries a watermark, which conflicts with the AGPL for every fork and web deployment.
- **Our own canvas** (Canvas2D, perfect-freehand and rough.js). This gives full control but takes
  an estimated 3–5 months to match Excalidraw's feel.
- **Konva, Fabric.** Konva has no SVG export. Fabric would reverse ADR 0005.
- **A fork of Excalidraw.** It is not needed while the roughjs patch holds.

## Decision

### D-1 Engine

Use `@excalidraw/excalidraw`, pinned to an exact version (0.18.1). Apply a `pnpm patch` to `roughjs`
that sends `fillStyle` values starting with `om-` to our own fillers, `om-dots`, `om-staggered` and
`om-even`. The patch adds one import and two lines. Hide Excalidraw's main menu, its export dialog
and its fill picker, and put the package's own toolbar, properties panel and field panel on top.
Ship Excalidraw's fonts with the app and set `EXCALIDRAW_ASSET_PATH`, so nothing loads from a CDN.

### D-2 Package boundary

Add `packages/sketchpad`, a React library built with tsup, with React as a peer dependency. It
owns:

- the editor
- the field underlay
- the fills
- the drill helpers
- tabs and pages
- exports to SVG, PNG and PDF

It does not import Electron, Drizzle or anything from `apps/desktop`. Hosts give it two things:

```ts
interface SketchStore {
    list(): Promise<SketchSummary[]>;
    load(id: string): Promise<SketchDoc>;
    save(doc: SketchDoc, render: SketchRender): Promise<void>; // idempotent, last write wins
    remove(id: string): Promise<void>;
    getFile(sha256: string): Promise<Blob | undefined>;
    putFile(blob: Blob): Promise<string>; // returns sha256
    templates: TemplateStore; // "show" and, where available, "library"
}
interface FieldSnapshot { fieldProperties: FieldPropertiesJson; style: FieldStyle }
```

`planField2d` and its types move from `apps/desktop/src/field/fieldPlan.ts` to `@openmarch/core`,
so the package and the desktop field share one field plan. The field SVG builder moves with them.

There are three hosts:

1. The desktop Sketchpad window (D-4).
2. A pop-up from the web editor, bridged over BroadcastChannel in the same way as the web 3D View.
3. `apps/sketchpad`, a Vite static site that stores sketches in IndexedDB and can open and save a
   `.omsketch` JSON file. It is deployed only to lab builds until the owner says otherwise.

### D-3 Data model

A sketch is a field snapshot plus an ordered list of pages. Each page holds one Excalidraw scene.

```ts
interface SketchDoc {
    id: string; // uuid
    name: string;
    field: FieldSnapshot; // copied from the show at creation; never migrated
    pages: { id: string; name: string; elements: ExcalidrawElement[] }[];
    schemaVersion: 1;
}
```

- Scene coordinates are field pixels in the snapshot's frame, using
  `FieldProperties.PIXELS_PER_INCH`. The scene origin is the field's centre front point, which is
  on the 50 at the front sideline. This lets an overlay drawn on one field layout line up by yard
  line on another.
- Elements keep Excalidraw's `id`, `version`, `versionNonce` and `isDeleted` exactly as they are.
  Saved scenes keep elements marked as deleted until the sketch is compacted. Live collaboration can
  then merge them later (owner decision Q6).
- Images live in a store addressed by sha256. Elements refer to them by `fileId`. Images are never
  inlined in the scene JSON.

### D-4 Desktop window and write path

- **The window.** There is one Sketchpad window, with a tab for each open sketch (owner decision
  Q2). It follows the 3D View pattern from ADR 0002 D-3:
  - `electron/main/sketchpadWindow.ts`
  - its own preload, which imports only `electron`
  - `?view=sketchpad` in `main.tsx`
  - the same CSP
  - it closes with the show
  - opening a sketch from the editor focuses the window and that sketch's tab
- **Writes go straight to main.** Unlike the 3D View, the window writes. Sketch tables are outside
  the show's undo history (D-5), so writes don't need to pass through the editor's
  `transactionWithHistory`. Main handles a fixed set of `sketch:*` channels: list, load, save,
  remove, restore, rename, duplicate, get-file, put-file, open, and the template channels (list,
  load, save, remove, and the editor-only rename, duplicate, copy and restore). Each handler checks
  that its sender is allowed for that channel (the Sketchpad window, the editor's Sketches panel,
  or both), validates its payload with zod, and writes with prepared statements once no editor
  transaction is open. There is no general-purpose SQL from either window.
- **Delete and Undo.** Deleting from the Sketches panel removes the row and shows an Undo toast;
  `restore` puts it back. A save that arrives from the window for a sketch the editor just deleted
  is ignored until it is restored.
- **Refresh.** After a save, main sends `sketch:changed` with the sketch id to the editor. The editor
  invalidates its sketch queries, which drive the sidebar thumbnails and the overlay.
- **Autosave.** The window saves about 2 s after the last change, and at least every 30 s while the
  user is editing. It also saves on tab close and on window blur. On window close, main waits up to
  2 s for a final save before closing the window. Closing the show flushes open sketches the same
  way. Writes go straight to the file, so saving the show needs no extra step.
- **Undo.** Each tab and page keeps Excalidraw's undo history in memory. Hidden tabs stay mounted,
  so their history survives tab switches. History is not saved (owner decision Q5).

### D-5 Tables

There are three tables. None of them is in `tablesWithHistory`, so they follow the
`view3d_cameras` precedent, and all three are added to `repair.ts`.

```sql
sketches (
  id TEXT PRIMARY KEY,               -- uuid
  kind TEXT NOT NULL CHECK (kind IN ('sketch','template')),
  name TEXT NOT NULL,
  field_json TEXT NOT NULL,          -- FieldSnapshot
  doc_json TEXT NOT NULL,            -- pages and elements, schemaVersion inside
  render_json TEXT,                  -- per page: { pageId, svg, bounds } for overlays
  thumbnail BLOB,                    -- small PNG for the sidebar
  sort_index REAL NOT NULL,
  created_at, updated_at
)
sketch_files (sha256 TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL CHECK (typeof(data)='blob'), created_at)
sketch_pins (
  id INTEGER PRIMARY KEY,
  sketch_id TEXT NOT NULL REFERENCES sketches(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  beat_id INTEGER REFERENCES beats(id) ON DELETE SET NULL,
  opacity REAL NOT NULL DEFAULT 0.5 CHECK (opacity > 0 AND opacity <= 1),
  position TEXT NOT NULL DEFAULT 'below' CHECK (position IN ('below','above'))
)
```

- **Images.** `sketch_files` rows that no sketch refers to are pruned when the show is saved.
- **Pins.** A pin refers to `beats.id`, which is stable when other beats are inserted or deleted.
  When its beat is deleted, the pin becomes unpinned (`beat_id` NULL) and stays in the list.
- **Migration.** One migration adds all three tables. Its number is taken when the PR lands, after
  any open PRs that already claim migration numbers. The file version (`user_version`) doesn't
  change, because older builds ignore the unknown tables.

### D-6 Templates

- **Saving.** "Save as template" saves either to the show (a `sketches` row with
  `kind='template'`, whose `field_json` keeps only the field style) or to the user's Library
  (owner decision Q3). The Library is an app-level store, not a show table, so a Library template
  is a JSON file in it (`sketch-templates/<id>.json`) holding the pages, the field style and its
  images inline. Using it copies those images into the show. No `library_items` migration is
  needed.
- **Editing one.** The Sketches panel lists show and Library templates with thumbnails. A template
  can be renamed, duplicated, copied between the show and the Library, and deleted with Undo (a
  deleted Library file is written back). "Edit template" opens it in a Sketchpad tab marked
  Template, drawn on the show's current field. Saving writes the pages and field style back under
  the same id, still without the field layout. Show templates keep a thumbnail in the `thumbnail`
  column, and Library template files carry it as base64.
- **Using one.** A template keeps every page and the field style, never the field layout. A new
  sketch made from a template takes its field layout from the show's current field.
- **Web.** The web build has no Library, so it offers only show templates.

### D-7 Overlay on the field

- **When it shows.** A pinned page is shown when playback is paused on its beat. It is hidden
  while playing or scrubbing (owner decision Q4). Pinning, unpinning, opacity and position are view
  settings. They are written directly, and the show's undo history does not record them.
- **How the editor draws it.** The editor never loads Excalidraw. It reads the page's stored SVG
  from `render_json`, rasterizes it once into a texture at the field's resolution, and draws it as a
  plane in field units:
  - below marchers: `renderOrder` 0.5, above the field lines and below paths
  - above marchers: `renderOrder` 3
- **Field mismatch.** When the sketch's field snapshot differs from the show's field, the overlay
  is aligned by the 50 and the front sideline, and the overlay chip shows a notice.
- **Not included yet.** Drill exports, the offscreen renderer and the 3D View leave overlays out
  for now.

## Consequences

- **Bundle and dependency.** Excalidraw adds about 360 KB gzip. It loads only in the Sketchpad
  window and on the static site, never in the editor. It is still 0.x and releases rarely, so
  upgrades are deliberate. If an upgrade moves roughjs's filler lookup, the patch fails at build
  time.
- **A second writer.** The show file gains a second window that writes to it. The writes are
  limited to the sketch tables, which nothing else writes, so they cannot conflict with the editor's
  undo history.
- **Rendering duplicated in data.** `render_json` duplicates information that could be derived from
  the scene. In exchange, the editor can draw overlays without the drawing engine, and the field
  thumbnails stay cheap.
- **Old sketches keep old fields.** Sketches keep the field they were made on. A show whose field
  changes later shows a mismatch notice on older sketches; their content is not moved.
- **Collaboration later.** Live collaboration can reuse Excalidraw's per-element versioning without
  changing the stored format.
- **Shared field plan.** Moving `planField2d` into core makes core own field geometry that
  previously lived only in the desktop app.

## Verification

- **Package unit tests:**
  - the fill geometry (dot counts on rectangles and ellipses at each spacing)
  - `SketchDoc` round-trips
  - the coordinate mapping against `FieldProperties` for the high-school, college and pro templates
- **Desktop history tests:** writes to the sketch tables leave `history_undo` unchanged.
- **Migration and repair:** the migration applies to a 0.x file, and `repair.ts` copies all three
  tables.
- **E2E:**
  - create a sketch, draw, close the window, reopen it, and the drawing is there
  - pin a page to a beat; it shows when paused on that beat and hides while playing
  - delete the beat, and the pin becomes unpinned
- **Spike measurements, repeated in the real window:** underlay drift and frame time while panning.
