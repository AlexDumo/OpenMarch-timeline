<!-- cspell:words meshoptimizer meshoptimizer's ndarray premultiplying SCEN tris khronos meshopt webp -->

# Spike #995: model import in a Web Worker (throwaway, not for merging)

- `modelImport.worker.ts`: validate (gltf-validator), read, measure, meters/+Y up,
  pivot to bottom center, dedup/prune/weld, meshoptimizer simplify past a
  triangle cap, textures shrunk with `createImageBitmap` + `OffscreenCanvas`,
  write GLB. Times every step.
- `modelImportHook.ts`: `window.__spikeProbe()` (WebAssembly in the page, the
  worker and a blob: worker) and `window.__spikeModelImport(b64, options)`.
- `ndarrayPixelsStub.ts`: aliased in both Vite configs; `ndarray-ops` calls
  `Function()` at load, which a strict worker CSP refuses.
- `harness/`: `go.sh <electron-file|electron-http|electron-packaged|web>` runs
  `run.mjs` in the openmarch-e2e container with the GPU; `verify.mjs` checks
  the output GLBs in Node. Models: Poly Haven CC0 (boombox, Camera_01,
  tree_stump_01), packed to GLB.

Results: fork issue #995.
