// cspell:words meshoptimizer meshoptimizer's ndarray premultiplying SCEN tris khronos meshopt webp
/**
 * Throwaway spike for fork issue #995: the model import, in a Web Worker,
 * with no Node and no native code. Not for merging.
 *
 * In: a GLB's bytes. Out: a normalized GLB (meters, +Y up, pivot at the
 * bottom center), simplified past a triangle cap with meshoptimizer's
 * WebAssembly simplifier and with textures shrunk to a cap through
 * `createImageBitmap` + `OffscreenCanvas`, plus a timing for every step.
 */
import { Document, Logger, WebIO, type Texture } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
    center,
    dedup,
    getBounds,
    prune,
    simplify,
    weld,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { validateBytes } from "gltf-validator";

export interface SpikeRequest {
    id: number;
    bytes: Uint8Array;
    triangleCap: number;
    textureCap: number;
    /** Scale to meters (e.g. 0.01 for a centimeter file). */
    unitScale: number;
    /** Rotate a Z-up file to Y-up. */
    zUp: boolean;
}

export interface SpikeResult {
    id: number;
    ok: boolean;
    error?: string;
    steps: Record<string, number>;
    wasm: { compile: string; simplifierReady: string };
    validation?: { errors: number; warnings: number; firstErrors: string[] };
    before?: Stats;
    after?: Stats;
    textures?: { name: string; mime: string; from: string; to: string }[];
    outBytes?: Uint8Array;
    env: { csp: string; userAgent: string };
}

interface Stats {
    triangles: number;
    size: [number, number, number];
    min: [number, number, number];
    max: [number, number, number];
    textures: number;
    maxTextureEdge: number;
    bytes: number;
}

/** A minimal valid WebAssembly module: the smallest test of `wasm-unsafe-eval`. */
const EMPTY_WASM = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);

async function probeWasm(): Promise<string> {
    try {
        await WebAssembly.compile(EMPTY_WASM);
        return "allowed";
    } catch (error) {
        return `blocked: ${String(error)}`;
    }
}

let lastCspViolation = "";
// eslint-disable-next-line no-restricted-globals -- the worker global
addEventListener("securitypolicyviolation", (event) => {
    const e = event as SecurityPolicyViolationEvent;
    lastCspViolation = `${e.effectiveDirective} ${e.originalPolicy}`;
});

function triangles(doc: Document): number {
    let total = 0;
    for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
            if (prim.getMode() !== 4) continue; // TRIANGLES
            const indices = prim.getIndices();
            const position = prim.getAttribute("POSITION");
            total += (indices ?? position)!.getCount() / 3;
        }
    }
    // Instancing multiplies drawn triangles; nodes reusing a mesh count again.
    return total;
}

function drawnTriangles(doc: Document): number {
    const perMesh = new Map<unknown, number>();
    for (const mesh of doc.getRoot().listMeshes()) {
        let t = 0;
        for (const prim of mesh.listPrimitives()) {
            if (prim.getMode() !== 4) continue;
            const indices = prim.getIndices();
            const position = prim.getAttribute("POSITION");
            t += (indices ?? position)!.getCount() / 3;
        }
        perMesh.set(mesh, t);
    }
    let total = 0;
    for (const node of doc.getRoot().listNodes()) {
        const mesh = node.getMesh();
        if (mesh) total += perMesh.get(mesh) ?? 0;
    }
    return total || triangles(doc);
}

function stats(doc: Document, bytes: number): Stats {
    const scene =
        doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!;
    const { min, max } = getBounds(scene);
    let maxEdge = 0;
    for (const tex of doc.getRoot().listTextures()) {
        const size = tex.getSize();
        if (size) maxEdge = Math.max(maxEdge, size[0], size[1]);
    }
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return {
        triangles: drawnTriangles(doc),
        size: [r(max[0] - min[0]), r(max[1] - min[1]), r(max[2] - min[2])],
        min: [r(min[0]), r(min[1]), r(min[2])],
        max: [r(max[0]), r(max[1]), r(max[2])],
        textures: doc.getRoot().listTextures().length,
        maxTextureEdge: maxEdge,
        bytes,
    };
}

/** Meters and +Y up: one new root node above the scene's children. */
function normalizeAxes(doc: Document, unitScale: number, zUp: boolean) {
    for (const scene of doc.getRoot().listScenes()) {
        const root = doc.createNode("OM_import_root");
        const s = unitScale;
        root.setScale([s, s, s]);
        // -90° about X turns +Z up into +Y up.
        if (zUp) root.setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
        for (const child of scene.listChildren()) {
            scene.removeChild(child);
            root.addChild(child);
        }
        scene.addChild(root);
    }
}

/** Shrinks one texture to `cap` on its long edge, keeping its format. */
async function shrinkTexture(
    tex: Texture,
    cap: number,
): Promise<{ from: string; to: string } | null> {
    const size = tex.getSize();
    const image = tex.getImage();
    const mime = tex.getMimeType();
    if (!size || !image) return null;
    const [w, h] = size;
    if (Math.max(w, h) <= cap) return null;
    if (
        mime !== "image/png" &&
        mime !== "image/jpeg" &&
        mime !== "image/webp"
    ) {
        return null; // KTX2 and others: out of scope here
    }
    const k = cap / Math.max(w, h);
    const tw = Math.max(1, Math.round(w * k));
    const th = Math.max(1, Math.round(h * k));
    // No color conversion or premultiplying: normal, roughness and metal maps
    // are data, not colors.
    const bitmap = await createImageBitmap(
        new Blob([image as BlobPart], { type: mime }),
        {
            resizeWidth: tw,
            resizeHeight: th,
            resizeQuality: "high",
            premultiplyAlpha: "none",
            colorSpaceConversion: "none",
        },
    );
    const canvas = new OffscreenCanvas(tw, th);
    const ctx = canvas.getContext("2d", { colorSpace: "srgb" })!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({
        type: mime,
        quality: mime === "image/png" ? undefined : 0.9,
    });
    tex.setImage(new Uint8Array(await blob.arrayBuffer()));
    return { from: `${w}x${h}`, to: `${tw}x${th}` };
}

// eslint-disable-next-line max-lines-per-function -- spike: one linear pipeline
async function run(req: SpikeRequest): Promise<SpikeResult> {
    const steps: Record<string, number> = {};
    const t0 = performance.now();
    let t = t0;
    const lap = (name: string) => {
        const now = performance.now();
        steps[name] = Math.round(now - t);
        t = now;
    };
    const result: SpikeResult = {
        id: req.id,
        ok: false,
        steps,
        wasm: { compile: await probeWasm(), simplifierReady: "not tried" },
        env: { csp: "", userAgent: navigator.userAgent },
    };
    try {
        try {
            await MeshoptSimplifier.ready;
            result.wasm.simplifierReady = "ready";
        } catch (error) {
            result.wasm.simplifierReady = `failed: ${String(error)}`;
        }
        lap("wasmInit");

        const report = await validateBytes(req.bytes, {
            maxIssues: 0,
            writeTimestamp: false,
        });
        result.validation = {
            errors: report.issues.numErrors,
            warnings: report.issues.numWarnings,
            firstErrors: report.issues.messages
                .filter((m) => m.severity === 0)
                .slice(0, 3)
                .map((m) => `${m.code}: ${m.message}`),
        };
        lap("validate");
        if (report.issues.numErrors > 0) throw new Error("validation errors");

        const io = new WebIO()
            .setLogger(new Logger(Logger.Verbosity.WARN))
            .registerExtensions(ALL_EXTENSIONS);
        const doc = await io.readBinary(req.bytes);
        lap("read");
        result.before = stats(doc, req.bytes.byteLength);
        lap("measure");

        normalizeAxes(doc, req.unitScale, req.zUp);
        await doc.transform(center({ pivot: "below" }));
        lap("normalize");

        await doc.transform(dedup(), prune(), weld());
        lap("dedupPruneWeld");

        const tris = drawnTriangles(doc);
        if (tris > req.triangleCap) {
            if (result.wasm.simplifierReady !== "ready") {
                throw new Error("simplify needed but the simplifier failed");
            }
            // Ratio first; widen the error limit until under the cap.
            for (const error of [0.01, 0.05, 0.2, 1]) {
                await doc.transform(
                    simplify({
                        simplifier: MeshoptSimplifier,
                        ratio: (req.triangleCap / tris) * 0.95,
                        error,
                    }),
                );
                if (drawnTriangles(doc) <= req.triangleCap) break;
            }
        }
        lap("simplify");

        result.textures = [];
        for (const tex of doc.getRoot().listTextures()) {
            const change = await shrinkTexture(tex, req.textureCap);
            if (change) {
                result.textures.push({
                    name: tex.getName() || tex.getURI(),
                    mime: tex.getMimeType(),
                    ...change,
                });
            }
        }
        lap("textures");

        await doc.transform(prune());
        const out = await io.writeBinary(doc);
        lap("write");
        result.after = stats(doc, out.byteLength);
        result.outBytes = out;
        steps.total = Math.round(performance.now() - t0);
        result.ok = true;
    } catch (error) {
        result.error = `${String(error)}${lastCspViolation ? ` (CSP: ${lastCspViolation})` : ""}`;
        steps.total = Math.round(performance.now() - t0);
    }
    result.env.csp = lastCspViolation;
    return result;
}

onmessage = async (event: MessageEvent<SpikeRequest | "probe">) => {
    if (event.data === "probe") {
        postMessage({
            probe: true,
            wasm: await probeWasm(),
            violation: lastCspViolation,
            userAgent: navigator.userAgent,
            offscreen: typeof OffscreenCanvas,
            bitmap: typeof createImageBitmap,
        });
        return;
    }
    const result = await run(event.data);
    postMessage(
        result,
        result.outBytes ? { transfer: [result.outBytes.buffer] } : undefined,
    );
};
