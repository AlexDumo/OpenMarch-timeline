<!-- cspell:words omasset -->

# Uniform pack tools

Command line tools for uniform packs (docs/3d/uniform-artwork.md). They run the app's own code in
headless Chromium: the import that turns SVG and PNG art into a pack, the pack format and writer,
the 3D View's marchers and its flats atlas. Only the show database is replaced
(`page/packStore.ts`), so what they build and draw is what the app builds and draws.

The agent skill `.claude/skills/uniform-from-photos` uses them to turn photos into a pack.

Run every command from `apps/desktop`. Paths are relative to the folder you typed the command in.

| Command          | What it does                                                                  |
| ---------------- | ----------------------------------------------------------------------------- |
| `uniform:build`  | a pack folder (`uniform.json` + art) → a `.omasset` the app imports           |
| `uniform:render` | a `.omasset` or a pack folder → renders on all 7 body types, on the GPU       |
| `uniform:image`  | the template downloads, and photo helpers: a pixel grid, color samples, crops |

Before the first render in a checkout: `pnpm install`, then `pnpm --filter @openmarch/core build`.

## `uniform:build`

```bash
pnpm uniform:build scripts/uniform-pack/example --out /tmp/sample.omasset [--json]
```

It reads `uniform.json`, checks it against the app's pack schema (`format.ts`), and checks every
file before it draws anything. Then it draws each layer through the app's import
(`importUniformFile`: an SVG drawn as an image at 32 px/in, then checked and encoded in the uniform
pack worker) and each item through `importItemFile` (trimmed to its art, at most 1024 px on its
long side). It runs the app's quiet notes and writes the file with `writeUniformPack`, at the lowest
format version that holds the pack.

It refuses with every problem it found, one sentence each, for example:

```
refused: layer "base" (layers[0]): front.svg's viewBox is "0 0 340 780"; the front panel is viewBox="0 0 34 78" (inches, panel coordinates as in uniform-regions.json)
refused: item "number": is 0.008 in wide, under a pixel at 32 px/in, so it can't be seen (…). Make it at least 0.0313 in on its thinner side; …
```

| Refused (exit 4)                                              | Warned                                      |
| ------------------------------------------------------------- | ------------------------------------------- |
| anything the schema refuses, an unknown key, a missing file   | a layer with no transparent pixels          |
| a page or panel at the wrong size or viewBox                  | a logo-like shape painted into the fabric   |
| the template left visible in a layer                          | an overlay layer that paints almost nothing |
| a base layer that paints almost nothing                       | an item centred outside every region        |
| an item over 120 in, a tile under 1 in, an item under 1/32 in |                                             |

Without `--out` the pack goes next to the folder, named after the pack.

## `uniform.json`

A folder holds `uniform.json` and the SVG and PNG files it names, by paths inside the folder.
`example/` is the app's built-in sample uniform as a pack folder.

```jsonc
{
  "name": "Lions 2027",
  // the pattern the palette draws where the art is clear
  "style": "classic", // classic | sash | plastron | military | split | fade | cadet
  // all ten roles, "#rrggbb"; shown where art is clear and on what art can't reach
  "palette": {
    "primary": "#1b2a4a", // jacket
    "secondary": "#ffffff",
    "accent": "#d8b04a",
    "trim": "#d8b04a", // collar, cuffs and the pants stripe the options draw
    "pants": "#1b2a4a",
    "shoes": "#0b0b0d",
    "gloves": "#ffffff",
    "hat": "#1b2a4a",
    "plume": "#ffffff",
    "visor": "#111111",
  },
  // parts the palette draws over or around the art
  "options": {
    "stripe": false,
    "collar": true,
    "cuffs": true,
    "gloves": true,
    "hat": true,
  },
  "credits": { "license": "…", "author": "…", "source": "…" }, // optional
  // bottom first
  "layers": [
    // panels: each an SVG with viewBox "0 0 34 78" (cape "0 0 20.7 17.9") or a PNG at 32 px/in
    { "id": "base", "name": "Base", "front": "front.svg", "back": "back.svg" },
    // or the whole page: an SVG with viewBox "0 0 105 88", or a 3360 × 2816 PNG
    { "id": "sash", "page": "sash-page.svg" },
  ],
  // optional: placed art, drawn over the layers in this order
  "items": [
    {
      "id": "crest",
      "file": "crest.svg", // any viewBox; trimmed to its art
      "panel": "front", // front | back | cape
      "at": [17, 25.32], // its centre, panel inches
      "width": 6, // or "height"; the image's shape gives the other side
      "rotate": 0, // degrees, clockwise; optional
      "opacity": 1, // optional
      "grade": "proportional", // proportional (default) | fixed | stretch | tile | line
    },
    {
      "id": "sequins",
      "file": "sequin-crop.png",
      "panel": "front",
      "at": [17, 30], // a tile row is centred on this height
      "width": 2, // one tile, at least 1 in
      "grade": "tile",
      "regions": ["front-torso"], // ids from uniform-regions.json, on its panel
    },
  ],
  // optional, format 3 (step 5): the ways it's worn; the first is the default
  "modes": [
    { "id": "plain", "name": "Plain", "layers": ["base"], "items": ["crest"] },
    {
      "id": "sash-out",
      "name": "Sash out",
      "layers": ["base", "sash"],
      "items": ["crest"],
    },
  ],
}
```

- Ids are lowercase letters, digits and dashes, at most 32 characters.
- Layer `name` defaults to its id; `credits` to none.
- `modes` need format version 3. A checkout that doesn't have it refuses them, and says so.
- Grades are explained in docs/3d/uniform-artwork.md, "Grading across the 7 body types".

## `uniform:render`

```bash
pnpm uniform:render /tmp/sample.omasset /mnt/ssd/runs/sample [--modes plain,sash-out] \
    [--views front,back,left,right,three-quarter] [--dpi 16|32] [--save-atlas] [--no-stands]
```

It renders with the 3D View's `MarcherBodies` (the om-pose bodies, the uniform shader with the
hybrid flats wrap, the feather plume) and its atlas composer, under the high school venue's day
lighting. A pack folder is built first, into `<outDir>/pack.omasset`.

- **Bodies:** all 7 body types at height class 1.00, at attention (the `attention` clip's legs).
  The arms stay in the bodies' rest pose: in the clips they hold a horn, which with nothing carried
  crosses the chest and hides the art.
- **Portraits** are a turntable. The camera keeps the sun over its left shoulder and the marcher
  turns, so every view is lit the same way. There's a 10 in black-and-white scale bar beside the
  marcher, 1 in per block.
- **Stride:** the median body (`neutral-average`) in the 8 to 5 clip, where its feet are furthest
  apart.
- **Stands:** the 7 bodies in a line on the field at the 50, seen from 40 m out and 15 m up with a
  20° lens. `stands-zoom` is the same spot with a 7° lens.

It writes:

| File                                         | What                                                       |
| -------------------------------------------- | ---------------------------------------------------------- |
| `contact-<mode>.png`                         | read this first: 7 bodies × views, the stride, the stands  |
| `<mode>/stand-<body>-<view>.png`             | 640 × 960                                                  |
| `<mode>/stride-front.png`, `stride-side.png` | the median body mid-stride                                 |
| `<mode>/stands.png`, `stands-zoom.png`       | 1920 × 1080                                                |
| `<mode>/atlas-neutral-average.png`           | with `--save-atlas`: the composed art the shader samples   |
| `report.json`                                | the WebGL renderer, each mode's errors and warnings, times |

`report.json` → `modes.<mode>.errors` and `.warnings` are the app's quiet notes for what that mode
draws: the template left visible, a painted logo, an empty layer, a layer at the wrong size, an
item not drawn or too thin, an item outside every region, a print left plain on a body. A pack
without modes has one mode, `default`.

Exit codes: 0 rendered, 2 render error, 3 no GPU, 4 bad arguments or pack.

### GPU and concurrency

- Chromium draws WebGL with ANGLE on Vulkan (`--use-gl=angle --use-angle=vulkan
--enable-features=Vulkan --ignore-gpu-blocklist`), headless, with no X server.
- The renderer string is checked before anything is drawn. A software renderer (SwiftShader,
  llvmpipe) is refused with exit 3. There is no CPU fallback.
- Every run has its own Vite server on a free port, its own Vite cache in a temporary folder and
  its own browser. Runs into different output folders can go at once.
- An output folder holds one run at a time (`.uniform-render.lock`).

A render of one mode takes about 8 s on the RTX 3060 Ti, most of it starting up.

## `uniform:image`

```bash
pnpm uniform:image template <outDir>                      # uniform-template.png/.svg, uniform-regions.json
pnpm uniform:image grid <photo> <out.png> [--step 100]    # the photo with a labelled pixel grid
pnpm uniform:image sample <photo> 120,340,8,8 410,90      # mean and median hex of each box (x,y[,w,h] px)
pnpm uniform:image crop <photo> 300,420,64,64 <out.png> [--size 256x256]
```

`template` writes the same files as the app's template downloads, from the same code.
