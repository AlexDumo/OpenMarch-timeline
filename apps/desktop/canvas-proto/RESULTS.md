# Results: three.js field prototype vs Fabric (2026-10-14)

Question: can a three.js orthographic scene replace Fabric for the 2D field,
including on weak machines?

## Method

- Same machine (Ryzen 5 3600, no working GPU driver that day), same Chromium,
  same flags, same canvas size (~1190×600), production builds of both apps:
  the Fabric web editor (`web:build`, fork main) and this prototype
  (`canvas-proto:build`, MSAA off, DPR 1).
- Shows: Part 1 Demo (95 marchers), LHB Daft Punk pt. 2 (385), and LHB ×5
  (1,925; every LHB marcher cloned 4 times with small offsets).
- Measured in the page: rAF intervals over 5 s of playback, and over 4 s of
  a real mouse drag of every marcher (Ctrl+A, then drag). Each run checked
  that playback advanced and that every marcher moved during the drag.
- Conditions:
  - **llvmpipe**: software GL on all cores. CPU throttling (4×, 6×) slows the
    page's main thread but not the GL rasterizer, so it models a slow CPU
    with a working GPU: the cheap-Chromebook case.
  - **SwiftShader**: single-threaded software WebGL: a machine with no
    usable GPU at all.

No real GPU was tested (the NVIDIA driver was mismatched until a reboot), so
every WebGL number here is a lower bound.

## Frames per second: playback / drag

| Show | Condition | Fabric | three.js (WebGL) | Canvas2D fallback |
| --- | --- | --- | --- | --- |
| 95 | llvmpipe | 60 / 59 | 60 / 59 | 60 / 59 |
| 95 | llvmpipe, CPU 4× | 60 / 58 | 60 / 59 | 60 / 59 |
| 95 | llvmpipe, CPU 6× | 57 / 58 | 60 / 58 | 60 / 59 |
| 95 | SwiftShader | 60 / 60 | 60 / 48 | 60 / 41 |
| 385 | llvmpipe | 60 / 41 | 60 / 59 | 60 / 48 |
| 385 | llvmpipe, CPU 4× | 34 / 24 | 60 / 59 | 60 / 59 |
| 385 | llvmpipe, CPU 6× | 21 / 17 | 60 / 59 | 60 / 59 |
| 385 | SwiftShader | 60 / 59 | 29 / 26 | 37 / 11 |
| 1,925 | llvmpipe | 0.8 / 6 | 60 / 54 | 24 / 18 |
| 1,925 | llvmpipe, CPU 4× | 1.2 / 4 | 60 / 58 | 24 / 17 |
| 1,925 | llvmpipe, CPU 6× | 1.2 / 3 | 60 / 56 | 24 / 15 |
| 1,925 | SwiftShader | 3.5 / 13 | 2.9 / 11 | 8 / 3.5 |

Raw rows and the scripts that produced them are in `bench/` (`compare.mjs`
drives both apps; `make-stress-show.mjs` builds the 1,925-marcher file from
the LHB demo). `matrix.log` has the first Fabric drag rows, which were
invalid (the drag missed the selection); `matrix2.log` re-runs them.

## Findings

1. **With any working GPU, WebGL wins, and the gap grows with show size and a
   slow CPU.** At 385 marchers on a 4× slower CPU, Fabric plays at 34 fps and
   drags at 24; the prototype holds 60/59. At 1,925 marchers Fabric is
   unusable (about 1 fps); the prototype stays at 54–60 fps. The prototype
   draws the whole field in ~12 draw calls regardless of marcher count, and
   its main-thread work per frame is under 1 ms.
2. **Labels are solved.** SDF glyphs in one instanced draw stay sharp from
   fully zoomed out to 12× in. This was the biggest risk the research named.
3. **With no GPU at all (SwiftShader), Fabric is faster on mid-size shows**
   (385: 60 fps vs 29). Fabric survives there because it caches every
   marcher as a bitmap and blits it. The naive Canvas2D fallback here
   (paths and text each frame) doesn't match it, and shows multi-second
   stalls. A real fallback would need the same sprite caching. At 1,925
   marchers everything is unusable without a GPU.
4. **React must stay out of the frame loop.** The first version re-rendered
   the whole toolbar on every pointer move: 37 fps drags at 6× throttle.
   Splitting overlay updates (every change) from chrome updates (≤10 Hz)
   brought it to 56–59. Benchmarks must use production builds: the React dev
   build doubled the per-move cost.
5. **The SVG overlay works.** Marquee, selection box, scale and rotate
   handles are plain React/SVG on the same view transform, with no drift
   from the WebGL layer.

## Verdict

Go for three.js for the 2D field, with these conditions:

- `auto` renderer detection ships from day one (`hasHardwareWebGL` in
  `editor.ts`), plus a Canvas2D fallback that caches marcher and label
  sprites. Decide how far to invest in it: it only matters for machines with
  WebGL blocklisted or no GPU.
- Keep the per-frame path out of React and allocation-free, as here.
- Before committing to the migration, check on real hardware: a low-end
  Chromebook and one integrated-GPU Windows laptop, using the in-page
  "Run benchmarks" button.

Not covered by this prototype: shape tools, curved pathways, appearances
(shapes per marcher, tag colors), background images, exports, collision
markers and the timeline overlays.
