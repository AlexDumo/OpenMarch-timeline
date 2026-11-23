// cspell:ignore tonemapping Jimenez prefilter prefiltered Cineon CINEON OETF Reinhard REINHARD AGX multisampling highp fract Panini
/**
 * The 3D View's post pass: bloom and lens ghosts for venues whose lighting
 * asks for them (`LightingValues.bloom`, at high quality), and Seat view's
 * lens (docs/3d/ui.md UI-3, `seatViewSource.ts`) at any venue and quality.
 * Framework-free three.js (ADR 0010 D-1); the window mounts it
 * (`window/PostFx.tsx`).
 *
 * With neither, the window never builds this, so the frame costs what it
 * always did. With it, a frame is:
 *
 * 1. the scene, drawn in linear light into a half-float target with 4x
 *    multisampling, so a lamp keeps its real brightness instead of clipping
 *    at white. In Seat view it is drawn by the lens's wide source camera,
 *    at the source's size;
 * 2. with bloom, a bright pass at half resolution: what is over the
 *    threshold after exposure, with a soft knee;
 * 3. with bloom, a mip chain down (13 taps a step) and back up (a 3x3 tent a
 *    step), which is a wide blur for about a third of a full-screen pass in
 *    pixels. Steps 2 and 3 work on whatever step 1 drew, the wide source
 *    included;
 * 4. one composite to the canvas: scene plus bloom plus ghosts, then the
 *    renderer's own tone mapping and color space, then a little dither so
 *    the dark hall doesn't band. In Seat view each pixel samples the scene
 *    and the bloom at the source coordinate the lens shows there
 *    (`PANINI_GLSL`), and the scene's shadows are lifted before the tone
 *    curve (`EYE_LIFT_GLSL`). Lens ghosts are placed in the picture, as a
 *    camera's are, then looked up through the lens.
 *
 * Nothing here keeps state between frames, so a paused show with a still
 * camera still draws nothing (`drawPolicy.ts`).
 */
import {
    AgXToneMapping,
    ACESFilmicToneMapping,
    BufferGeometry,
    CineonToneMapping,
    Color,
    ColorManagement,
    CustomToneMapping,
    Float32BufferAttribute,
    HalfFloatType,
    LinearFilter,
    LinearToneMapping,
    Mesh,
    NeutralToneMapping,
    NoToneMapping,
    OrthographicCamera,
    RawShaderMaterial,
    ReinhardToneMapping,
    SRGBTransfer,
    Vector2,
    WebGLRenderTarget,
    type Camera,
    type Scene,
    type Texture,
    type ToneMapping,
    type WebGLRenderer,
} from "three";
import { EYE_LIFT_GLSL, PANINI_GLSL } from "./panini";

/** How a venue's lamps bloom. Every field can change between frames. */
export interface BloomSettings {
    /** How much of the blurred light is added back. 0 turns bloom off. */
    strength: number;
    /**
     * How wide the glow is, 0 to 1: the weight each wider blur gets against
     * the one inside it.
     */
    radius: number;
    /**
     * Brightness, after exposure, where bloom starts. Over 1, so white
     * uniforms and yard lines never glow; only lamps and LED boards do.
     */
    threshold: number;
    /** Width of the soft start below the threshold. */
    knee: number;
    /**
     * Lens ghosts: a faint tinted copy of the hottest lamps, pushed out from
     * the middle of the picture, as a phone camera makes. 0 is none.
     */
    ghost: number;
    /** Brightness, after exposure, a lamp needs before it ghosts. */
    ghostThreshold: number;
    /** sRGB hex. */
    ghostTint: number;
}

/**
 * Seat view's lens for one frame (`seatViewSource.ts`): the scene is drawn
 * by `camera` at `width` by `height`, and the composite remaps it.
 */
export interface PostLens {
    /** The wide rectilinear camera the scene is drawn with. */
    camera: Camera;
    /** The source's size, in pixels. */
    width: number;
    height: number;
    /** The lens per picture column (`paniniColumnTable`), for the canvas's width. */
    columns: Texture;
    /** Shadow lift: deep shadows are brightened by 1 + lift. */
    lift: number;
    /** Exposed luminance where the lift has halved. */
    liftKnee: number;
}

export interface PostPipeline {
    /** Live: change a field and the next frame uses it. */
    settings: BloomSettings;
    /**
     * Where the scene is drawn. Shaders compiled ahead of time must be
     * compiled with this bound, because a material compiles differently for
     * a target than for the canvas.
     */
    readonly sceneTarget: WebGLRenderTarget;
    /**
     * Draws one frame to the canvas: `camera`'s view, or with `lens`, what
     * the lens shows from `camera`'s eye.
     */
    render(scene: Scene, camera: Camera, lens?: PostLens | null): void;
    /** Draws the last frame's composite again (for measuring its cost). */
    composite(): void;
    dispose(): void;
}

/** True where the renderer can draw into half-float targets. */
export function supportsPostPipeline(gl: WebGLRenderer): boolean {
    return (
        gl.capabilities.isWebGL2 &&
        (gl.extensions.has("EXT_color_buffer_float") ||
            gl.extensions.has("EXT_color_buffer_half_float"))
    );
}

/** The most blur steps; each one doubles the glow's reach. */
const MAX_LEVELS = 5;
/** The smallest blur target's short side, in pixels. */
const MIN_LEVEL_SIZE = 12;
/**
 * A lamp brighter than this (after exposure) blooms no wider. It keeps a
 * camera on the field, looking up into a whole row of beams, from whiting
 * out.
 */
const MAX_BRIGHT = 32;

const VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * The bright pass, at half resolution. rgb is the light over the threshold;
 * alpha is how far over the ghost threshold it is, for the lens ghosts.
 */
const PREFILTER = /* glsl */ `
precision highp float;
uniform sampler2D tSource;
uniform vec2 uTexel;
uniform float uExposure;
uniform float uThreshold;
uniform float uKnee;
uniform float uGhostThreshold;
varying vec2 vUv;

vec3 tap(vec2 offset) {
    return min(texture2D(tSource, vUv + offset * uTexel).rgb * uExposure, vec3(${MAX_BRIGHT.toFixed(1)}));
}

void main() {
    // Four bilinear taps over a 4x4 block: a lamp a pixel wide doesn't
    // flicker as it crosses pixel edges.
    vec3 color = 0.25 * (tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) +
        tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0)));
    float brightness = max(color.r, max(color.g, color.b));
    float soft = clamp(brightness - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    float over = max(soft, brightness - uThreshold) / max(brightness, 1e-4);
    // Capped, so a whole cluster of lamps makes no more ghost than one.
    float hot = min(max(brightness - uGhostThreshold, 0.0), 4.0);
    gl_FragColor = vec4(color * over, hot);
}
`;

/** One step down: 13 taps (Jimenez, "Next Generation Post Processing"). */
const DOWN = /* glsl */ `
precision highp float;
uniform sampler2D tSource;
uniform vec2 uTexel;
varying vec2 vUv;

vec4 tap(float x, float y) {
    return texture2D(tSource, vUv + vec2(x, y) * uTexel);
}

void main() {
    vec4 a = tap(-2.0, 2.0), b = tap(0.0, 2.0), c = tap(2.0, 2.0);
    vec4 d = tap(-2.0, 0.0), e = tap(0.0, 0.0), f = tap(2.0, 0.0);
    vec4 g = tap(-2.0, -2.0), h = tap(0.0, -2.0), i = tap(2.0, -2.0);
    vec4 j = tap(-1.0, 1.0), k = tap(1.0, 1.0);
    vec4 l = tap(-1.0, -1.0), m = tap(1.0, -1.0);
    gl_FragColor = e * 0.125 + (a + c + g + i) * 0.03125 +
        (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}
`;

/** One step up: a 3x3 tent of the wider blur, added to this level's own. */
const UP = /* glsl */ `
precision highp float;
uniform sampler2D tSource;
uniform sampler2D tWider;
uniform vec2 uTexel;
uniform float uSpread;
varying vec2 vUv;

vec4 tap(float x, float y) {
    return texture2D(tWider, vUv + vec2(x, y) * uTexel);
}

void main() {
    vec4 wide = (tap(-1.0, 1.0) + tap(1.0, 1.0) + tap(-1.0, -1.0) + tap(1.0, -1.0)) * 0.0625 +
        (tap(0.0, 1.0) + tap(0.0, -1.0) + tap(-1.0, 0.0) + tap(1.0, 0.0)) * 0.125 +
        tap(0.0, 0.0) * 0.25;
    gl_FragColor = texture2D(tSource, vUv) + wide * uSpread;
}
`;

/**
 * Scene plus bloom plus ghosts, then tone mapping and the color space. With
 * PANINI, through Seat view's lens and with its shadow lift.
 */
const COMPOSITE = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tGhost;
uniform float uStrength;
uniform float uGhost;
uniform vec3 uGhostTint;
uniform float uInverseExposure;
varying vec2 vUv;

#ifdef PANINI
uniform vec2 uSourceTexel;
${PANINI_GLSL}
${EYE_LIFT_GLSL}
#endif

#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

/** The scene texture's coordinate the picture shows at uv. */
vec2 sourceAt(vec2 uv) {
#ifdef PANINI
    vec4 unused;
    return paniniSample(uv, unused);
#else
    return uv;
#endif
}

void main() {
#ifdef PANINI
    vec4 fp;
    vec2 c = paniniSample(vUv, fp);
    // The pixel's footprint in the source, in texels.
    vec2 dx = fp.xy;
    vec2 dy = fp.zw;
    float footprint = max(length(dx / uSourceTexel), length(dy / uSourceTexel));
    // One tap where a pixel covers a texel or less; past that, where the
    // sides compress, four taps on a rotated grid across the footprint so
    // the stands don't shimmer. The target has no mipmaps, so sampling
    // inside the branch is safe.
    float spread = clamp(footprint - 1.0, 0.0, 1.0);
    vec3 color;
    if (spread <= 0.0) {
        color = texture2D(tScene, c).rgb;
    } else {
        vec2 o1 = (0.375 * dx + 0.125 * dy) * spread;
        vec2 o2 = (-0.125 * dx + 0.375 * dy) * spread;
        color = 0.25 * (
            texture2D(tScene, c + o1).rgb + texture2D(tScene, c - o1).rgb +
            texture2D(tScene, c + o2).rgb + texture2D(tScene, c - o2).rgb);
    }
    // The adapted eye's shadow lift, on the scene's own light only: the
    // glow is added after, so a halo in the dark isn't lifted with it.
    color = eyeLift(color, toneMappingExposure);
#else
    vec2 c = vUv;
    vec3 color = texture2D(tScene, c).rgb;
#endif
    vec3 glow = vec3(0.0);
#ifdef BLOOM
    // The blur is of exposed light; the scene is not exposed yet. It was
    // blurred from the same source, so it is read at the same coordinate.
    glow = texture2D(tBloom, c).rgb * uStrength;
#endif
#ifdef LENS_GHOSTS
    // A lamp's ghost lands a little farther from the middle of the picture
    // than the lamp, and a fainter, larger one farther still.
    vec2 fromCenter = vUv - 0.5;
    float near = texture2D(tGhost, sourceAt(0.5 + fromCenter / 1.055)).a;
    float far = texture2D(tGhost, sourceAt(0.5 + fromCenter / 1.16)).a;
    glow += uGhostTint * uGhost * (near + 0.15 * far);
#endif
    gl_FragColor = vec4(color + glow * uInverseExposure, 1.0);

#ifdef LINEAR_TONE_MAPPING
    gl_FragColor.rgb = LinearToneMapping(gl_FragColor.rgb);
#elif defined(REINHARD_TONE_MAPPING)
    gl_FragColor.rgb = ReinhardToneMapping(gl_FragColor.rgb);
#elif defined(CINEON_TONE_MAPPING)
    gl_FragColor.rgb = CineonToneMapping(gl_FragColor.rgb);
#elif defined(ACES_FILMIC_TONE_MAPPING)
    gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
#elif defined(AGX_TONE_MAPPING)
    gl_FragColor.rgb = AgXToneMapping(gl_FragColor.rgb);
#elif defined(NEUTRAL_TONE_MAPPING)
    gl_FragColor.rgb = NeutralToneMapping(gl_FragColor.rgb);
#elif defined(CUSTOM_TONE_MAPPING)
    gl_FragColor.rgb = CustomToneMapping(gl_FragColor.rgb);
#endif

#ifdef SRGB_TRANSFER
    gl_FragColor = sRGBTransferOETF(gl_FragColor);
#endif
    // Half a display step of noise: dark gradients don't band.
    gl_FragColor.rgb += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
}
`;

const TONE_DEFINES: Partial<Record<ToneMapping, string>> = {
    [LinearToneMapping]: "LINEAR_TONE_MAPPING",
    [ReinhardToneMapping]: "REINHARD_TONE_MAPPING",
    [CineonToneMapping]: "CINEON_TONE_MAPPING",
    [ACESFilmicToneMapping]: "ACES_FILMIC_TONE_MAPPING",
    [AgXToneMapping]: "AGX_TONE_MAPPING",
    [NeutralToneMapping]: "NEUTRAL_TONE_MAPPING",
    [CustomToneMapping]: "CUSTOM_TONE_MAPPING",
};

/** The blur targets' sizes for a drawing buffer, widest blur last. */
export function bloomLevelSizes(
    width: number,
    height: number,
): [number, number][] {
    const sizes: [number, number][] = [];
    let w = Math.max(1, Math.floor(width / 2));
    let h = Math.max(1, Math.floor(height / 2));
    for (let i = 0; i < MAX_LEVELS; i++) {
        sizes.push([w, h]);
        if (Math.min(w, h) < MIN_LEVEL_SIZE * 2) break;
        w = Math.floor(w / 2);
        h = Math.floor(h / 2);
    }
    return sizes;
}

function pass(fragmentShader: string, uniforms: Record<string, unknown>) {
    return new RawShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader,
        uniforms: Object.fromEntries(
            Object.entries(uniforms).map(([k, value]) => [k, { value }]),
        ),
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
    });
}

// eslint-disable-next-line max-lines-per-function
export function createPostPipeline(
    gl: WebGLRenderer,
    settings: BloomSettings,
): PostPipeline {
    const size = gl.getDrawingBufferSize(new Vector2());
    const sceneTarget = new WebGLRenderTarget(size.x, size.y, {
        type: HalfFloatType,
        samples: 4,
        depthBuffer: true,
        stencilBuffer: false,
        resolveDepthBuffer: false,
    });
    sceneTarget.texture.name = "view3d.post.scene";

    const blurTarget = () =>
        new WebGLRenderTarget(1, 1, {
            type: HalfFloatType,
            minFilter: LinearFilter,
            magFilter: LinearFilter,
            depthBuffer: false,
            stencilBuffer: false,
        });
    // down[i] is the scene's bright light blurred i steps; up[i] is that
    // plus every wider blur. The widest level is its own `up`.
    let down: WebGLRenderTarget[] = [];
    let up: WebGLRenderTarget[] = [];
    let sizes: [number, number][] = [];
    // Seat view's source changes size every frame of its blend, so the
    // targets are resized in place where the chain keeps its length.
    const resize = (width: number, height: number) => {
        sceneTarget.setSize(width, height);
        sizes = bloomLevelSizes(width, height);
        if (down.length !== sizes.length) {
            [...down, ...up].forEach((t) => t.dispose());
            down = sizes.map(blurTarget);
            up = sizes.slice(0, -1).map(blurTarget);
        }
        down.forEach((t, i) => t.setSize(...sizes[i]));
        up.forEach((t, i) => t.setSize(...sizes[i]));
    };
    resize(size.x, size.y);

    const geometry = new BufferGeometry();
    geometry.setAttribute(
        "position",
        new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3),
    );
    geometry.setAttribute(
        "uv",
        new Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2),
    );
    const prefilter = pass(PREFILTER, {
        tSource: null,
        uTexel: new Vector2(),
        uExposure: 1,
        uThreshold: 1,
        uKnee: 0.5,
        uGhostThreshold: 8,
    });
    const downsample = pass(DOWN, { tSource: null, uTexel: new Vector2() });
    const upsample = pass(UP, {
        tSource: null,
        tWider: null,
        uTexel: new Vector2(),
        uSpread: 1,
    });
    const composite = pass(COMPOSITE, {
        tScene: null,
        tBloom: null,
        tGhost: null,
        uStrength: 0,
        uGhost: 0,
        uGhostTint: new Color(),
        uInverseExposure: 1,
        toneMappingExposure: 1,
        // Seat view's lens (`PANINI`).
        uSourceTexel: new Vector2(1, 1),
        uPictureTexel: new Vector2(1, 1),
        tPaniniColumns: null,
        uEyeLift: new Vector2(),
    });
    const quad = new Mesh(geometry, prefilter);
    quad.frustumCulled = false;
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const draw = (
        material: RawShaderMaterial,
        target: WebGLRenderTarget | null,
    ) => {
        quad.material = material;
        gl.setRenderTarget(target);
        gl.render(quad, camera);
    };

    // 2 and 3: the bloom chain, on whatever the scene was drawn into.
    const blur = (s: BloomSettings, exposure: number) => {
        // 2. The bright pass.
        const u = prefilter.uniforms;
        u.tSource.value = sceneTarget.texture;
        u.uTexel.value.set(1 / sceneTarget.width, 1 / sceneTarget.height);
        u.uExposure.value = exposure;
        u.uThreshold.value = s.threshold;
        u.uKnee.value = s.knee;
        u.uGhostThreshold.value = s.ghostThreshold;
        draw(prefilter, down[0]);
        // 3. Down, then back up.
        for (let i = 1; i < down.length; i++) {
            downsample.uniforms.tSource.value = down[i - 1].texture;
            downsample.uniforms.uTexel.value.set(
                1 / sizes[i - 1][0],
                1 / sizes[i - 1][1],
            );
            draw(downsample, down[i]);
        }
        upsample.uniforms.uSpread.value = s.radius;
        for (let i = up.length - 1; i >= 0; i--) {
            const wider = i === up.length - 1 ? down[i + 1] : up[i + 1];
            upsample.uniforms.tSource.value = down[i].texture;
            upsample.uniforms.tWider.value = wider.texture;
            upsample.uniforms.uTexel.value.set(
                1 / sizes[i + 1][0],
                1 / sizes[i + 1][1],
            );
            draw(upsample, up[i]);
        }
    };

    let compositeKey = "";
    const bufferSize = new Vector2();

    const pipeline: PostPipeline = {
        settings,
        sceneTarget,
        render(scene, sceneCamera, lens) {
            const s = pipeline.settings;
            gl.getDrawingBufferSize(bufferSize);
            const width = Math.max(1, bufferSize.x);
            const height = Math.max(1, bufferSize.y);
            // In Seat view, the scene is drawn at the source's size.
            const sw = lens ? lens.width : width;
            const sh = lens ? lens.height : height;
            if (sw !== sceneTarget.width || sh !== sceneTarget.height)
                resize(sw, sh);

            // 1. The scene, in linear light. Rendering to a target, three
            // leaves tone mapping and the color space to the composite.
            gl.setRenderTarget(sceneTarget);
            gl.render(scene, lens ? lens.camera : sceneCamera);

            const exposure = gl.toneMappingExposure;
            const glowing = s.strength > 0 || s.ghost > 0;
            if (glowing) blur(s, exposure);

            // 4. The composite, with the renderer's tone mapping.
            const withGhosts = glowing && s.ghost > 0;
            const key = `${gl.toneMapping} ${gl.outputColorSpace} ${glowing} ${withGhosts} ${!!lens}`;
            if (key !== compositeKey) {
                compositeKey = key;
                const defines: Record<string, string> = {};
                if (
                    ColorManagement.getTransfer(gl.outputColorSpace) ===
                    SRGBTransfer
                )
                    defines.SRGB_TRANSFER = "";
                const tone = TONE_DEFINES[gl.toneMapping];
                if (tone && gl.toneMapping !== NoToneMapping)
                    defines[tone] = "";
                if (glowing) defines.BLOOM = "";
                if (withGhosts) defines.LENS_GHOSTS = "";
                if (lens) defines.PANINI = "";
                composite.defines = defines;
                composite.needsUpdate = true;
            }
            const c = composite.uniforms;
            if (lens) {
                c.uSourceTexel.value.set(1 / sw, 1 / sh);
                c.uPictureTexel.value.set(1 / width, 1 / height);
                c.tPaniniColumns.value = lens.columns;
                c.uEyeLift.value.set(lens.lift, lens.liftKnee);
            }
            const bloom = up[0] ?? down[0];
            // The ghost is a soft disc: the hot light four blur steps down.
            const ghost = down[Math.min(3, down.length - 1)];
            // Each level adds `radius` of the next: keep the sum's weight 1.
            let weight = 0;
            for (let i = 0; i < down.length; i++) weight += s.radius ** i;
            c.tScene.value = sceneTarget.texture;
            c.tBloom.value = bloom.texture;
            c.tGhost.value = ghost.texture;
            c.uStrength.value = glowing ? s.strength / weight : 0;
            c.uGhost.value = s.ghost;
            c.uGhostTint.value.setHex(s.ghostTint);
            c.uInverseExposure.value = 1 / Math.max(exposure, 1e-4);
            c.toneMappingExposure.value = exposure;
            draw(composite, null);
        },
        composite() {
            draw(composite, null);
        },
        dispose() {
            sceneTarget.dispose();
            [...down, ...up].forEach((t) => t.dispose());
            geometry.dispose();
            [prefilter, downsample, upsample, composite].forEach((m) =>
                m.dispose(),
            );
        },
    };
    return pipeline;
}
