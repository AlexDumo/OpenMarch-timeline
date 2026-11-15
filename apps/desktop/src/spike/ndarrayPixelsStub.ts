// cspell:words meshoptimizer meshoptimizer's ndarray premultiplying SCEN tris khronos meshopt webp
/**
 * Spike #995: stands in for `ndarray-pixels`, which `@gltf-transform/functions`
 * imports only for its own texture resize. Its `ndarray-ops` dependency calls
 * `Function()` when it loads, which a strict CSP refuses. The spike resizes
 * textures with `createImageBitmap` + `OffscreenCanvas` instead.
 */
export function getPixels(): never {
    throw new Error("ndarray-pixels is stubbed out (spike #995)");
}
export function savePixels(): never {
    throw new Error("ndarray-pixels is stubbed out (spike #995)");
}
