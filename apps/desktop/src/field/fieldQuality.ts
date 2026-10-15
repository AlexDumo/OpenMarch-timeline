import { create } from "zustand";

/**
 * How well the new field can draw on this machine (ADR 0005 D-3, fork ticket
 * #205), and the low-quality mode it falls back to. Plain TypeScript: the
 * field reads it, and the settings, the notice and the benchmark report it.
 *
 * - `hardware`: WebGL on a GPU. The field draws at full quality.
 * - `software`: WebGL drawn on the CPU (SwiftShader, llvmpipe, Microsoft Basic
 *   Render). The field draws, slowly, so it runs in low-quality mode.
 * - `none`: no WebGL at all (turned off, blocked, or the GPU process gave up).
 *   The field can't draw, and says so instead of crashing the app.
 */
export type GlKind = "hardware" | "software" | "none";

/** Why the field runs in low-quality mode, most important first. */
export type LowQualityReason =
    /** No WebGL: the field can't draw at all. */
    | "noWebGL"
    /** The desktop app's GPU process crashed this session. */
    | "gpuCrashed"
    /** WebGL runs in software. */
    | "software"
    /** The Performance mode setting is on. */
    | "setting";

const SOFTWARE_RENDERERS =
    /swiftshader|llvmpipe|softpipe|software|basic render/i;

/**
 * Whether a WebGL renderer string (`UNMASKED_RENDERER_WEBGL`, or `RENDERER`
 * when the browser hides it) is a GPU or a software rasterizer. Null means
 * there is no WebGL.
 */
export function classifyGlRenderer(renderer: string | null): GlKind {
    if (renderer === null) return "none";
    return SOFTWARE_RENDERERS.test(renderer) ? "software" : "hardware";
}

/** The renderer string of a WebGL context, unmasked where the browser allows. */
export function glRendererName(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
): string {
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return String(
        gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    );
}

export type GlInfo = { kind: GlKind; renderer: string | null };

/**
 * Asks the browser for a throwaway WebGL context to see what draws it, then
 * releases it. The field's own context is created later, so this is how the
 * field knows, before it mounts, whether it can draw at all.
 */
export function probeWebGL(): GlInfo {
    try {
        const canvas = document.createElement("canvas");
        const gl =
            canvas.getContext("webgl2") ??
            (canvas.getContext("webgl") as WebGLRenderingContext | null);
        if (!gl) return { kind: "none", renderer: null };
        const renderer = glRendererName(gl);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        return { kind: classifyGlRenderer(renderer), renderer };
    } catch {
        return { kind: "none", renderer: null };
    }
}

export type FieldQualityInput = {
    /** The Performance mode setting. */
    performanceMode: boolean;
    /** What draws WebGL here; null until known. */
    gl: GlKind | null;
    /** The desktop app's GPU process crashed this session. */
    gpuCrashed: boolean;
};

export type FieldQuality =
    | { mode: "full"; reason: null }
    | { mode: "low"; reason: LowQualityReason };

/** Which mode the field draws in, and why. Unknown WebGL counts as hardware. */
export function fieldQuality({
    performanceMode,
    gl,
    gpuCrashed,
}: FieldQualityInput): FieldQuality {
    if (gl === "none") return { mode: "low", reason: "noWebGL" };
    if (gpuCrashed) return { mode: "low", reason: "gpuCrashed" };
    if (gl === "software") return { mode: "low", reason: "software" };
    if (performanceMode) return { mode: "low", reason: "setting" };
    return { mode: "full", reason: null };
}

/** What each mode changes in the field's drawing. */
export type QualitySettings = {
    /** The canvas's device pixel ratio: a range follows the screen, within it. */
    dpr: number | [number, number];
    /**
     * Marcher labels are fully drawn from `labelFadeTo` CSS pixels per em, and
     * hidden under `labelFadeFrom`.
     */
    labelFadeFrom: number;
    labelFadeTo: number;
    /**
     * Field lines covering less than this share of a device pixel aren't
     * drawn (above it they fade by coverage, in both modes).
     */
    minLineCoverage: number;
};

/**
 * MSAA is off in both: dots and text antialias in their shaders, and on
 * llvmpipe MSAA took 2,000-marcher playback from 56 to 34 fps (#192).
 */
export const QUALITY_SETTINGS: Record<FieldQuality["mode"], QualitySettings> = {
    full: {
        dpr: [1, 2],
        labelFadeFrom: 4,
        labelFadeTo: 7,
        minLineCoverage: 0,
    },
    low: {
        dpr: 1,
        labelFadeFrom: 8,
        labelFadeTo: 11,
        minLineCoverage: 0.3,
    },
};

type FieldQualityState = {
    /** What draws the field's WebGL: probed before it mounts, then read from its own context. */
    gl: GlInfo | null;
    /** The desktop app's GPU process crashed this session (`gpu:processGone`). */
    gpuCrashed: boolean;
    /** The field's WebGL context is lost and not yet back. */
    contextLost: boolean;
};

/** What the field has learned about the machine this session. */
export const useFieldQualityStore = create<FieldQualityState>(() => ({
    gl: null,
    gpuCrashed: false,
    contextLost: false,
}));
