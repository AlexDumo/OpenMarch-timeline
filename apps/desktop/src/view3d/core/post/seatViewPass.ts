// cspell:ignore Panini tonemapping Cineon CINEON REINHARD AGX highp OETF hfov vfov multisampling
/**
 * Seat view's draw (docs/3d/ui.md UI-3): what a person in the seat sees, not
 * a phone photo from it. Framework-free three.js (ADR 0010 D-1); the window
 * mounts it (`window/SeatView.tsx`).
 *
 * A frame is:
 *
 * 1. the scene, drawn in linear light into a half-float target with 4x
 *    multisampling, by a rectilinear camera at the view's eye and turned as
 *    it is, but wide enough to cover the whole picture (`paniniFrame`);
 * 2. one full-screen remap to the canvas: each pixel samples the source
 *    through the Panini lens (`panini.ts`), lifts the shadows a little as an
 *    adapted eye does, then applies the renderer's tone mapping and color
 *    space.
 *
 * The remap is separable, so the lens is worked out once per column on the
 * CPU (`paniniColumnTable`) and a pixel costs a table fetch, a few
 * multiplies and one to four taps. Where the sides compress, a pixel covers more than one source texel,
 * and it takes four taps across its footprint instead of one so the stands
 * don't shimmer. Nothing keeps state between frames, so a still view draws
 * nothing more (`drawPolicy.ts`).
 *
 * With `d`, `s` and `lift` at 0 and the camera's own field of view, this
 * draws exactly what the camera would, so the window blends into and out of
 * seat view by moving the settings.
 */
import {
    AgXToneMapping,
    ACESFilmicToneMapping,
    BufferGeometry,
    CineonToneMapping,
    ColorManagement,
    CustomToneMapping,
    DataTexture,
    FloatType,
    Float32BufferAttribute,
    HalfFloatType,
    LinearFilter,
    LinearToneMapping,
    Mesh,
    NearestFilter,
    NeutralToneMapping,
    NoToneMapping,
    OrthographicCamera,
    PerspectiveCamera,
    RawShaderMaterial,
    ReinhardToneMapping,
    RGBAFormat,
    SRGBTransfer,
    Vector2,
    WebGLRenderTarget,
    type Scene,
    type ToneMapping,
    type WebGLRenderer,
} from "three";
import {
    EYE_LIFT_GLSL,
    PANINI_GLSL,
    paniniColumnTable,
    paniniFrame,
    paniniSourceSize,
    type PaniniFrame,
    type PaniniLens,
} from "./panini";

export interface SeatViewSettings extends PaniniLens {
    /** Horizontal field of view across the picture, in degrees. */
    hfovDeg: number;
    /** The most the middle of the picture sees top to bottom, in degrees. */
    maxVfovDeg: number;
    /** Shadow lift: deep shadows are brightened by 1 + lift. 0 is none. */
    lift: number;
    /** Exposed luminance where the lift has halved. */
    liftKnee: number;
    /**
     * Source pixels per picture pixel at the middle: 1 is as sharp as a
     * plain camera. Below 1 draws fewer pixels.
     */
    sharpness: number;
    /** Multisampling of the source. */
    samples: number;
}

/**
 * Seat view's look. 105° is about what both eyes take in with attention,
 * against a phone's 60-70°. `d` 1 is the classic Panini; `s` 0.25 keeps
 * people at the sides near their true shape while bending the sidelines
 * only a little. The lift brightens the darkest parts by 45% and the field
 * by under 5%.
 */
export const SEAT_VIEW_DEFAULTS: Readonly<SeatViewSettings> = {
    hfovDeg: 105,
    maxVfovDeg: 85,
    d: 1,
    s: 0.25,
    lift: 0.45,
    liftKnee: 0.04,
    sharpness: 1,
    samples: 4,
};

export interface SeatViewPass {
    /** Live: change a field and the next frame uses it. */
    settings: SeatViewSettings;
    /**
     * Where the scene is drawn. Shaders compiled ahead of time must be
     * compiled with this bound: a material compiles differently for a
     * target than for the canvas.
     */
    readonly sceneTarget: WebGLRenderTarget;
    /** The wide camera the scene is drawn with, following the view's camera. */
    readonly sourceCamera: PerspectiveCamera;
    /** The lens and extents of the last frame drawn, for picking. */
    readonly frame: PaniniFrame | null;
    /** Draws one frame to the canvas, as `camera` sees it with the lens. */
    render(scene: Scene, camera: PerspectiveCamera): void;
    /** Draws the last frame's remap again (for measuring its cost). */
    composite(): void;
    /** The source target's size in pixels. */
    sourceSize(): [number, number];
    dispose(): void;
}

/** True where the renderer can draw into half-float targets. */
export function supportsSeatView(gl: WebGLRenderer): boolean {
    return (
        gl.capabilities.isWebGL2 &&
        (gl.extensions.has("EXT_color_buffer_float") ||
            gl.extensions.has("EXT_color_buffer_half_float"))
    );
}

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

const REMAP = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform vec2 uSourceTexel;
varying vec2 vUv;

${PANINI_GLSL}
${EYE_LIFT_GLSL}

#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>

void main() {
    vec4 step;
    vec2 c = paniniSample(vUv, step);
    // The pixel's footprint in the source, in texels.
    vec2 dx = step.xy;
    vec2 dy = step.zw;
    float footprint = max(length(dx / uSourceTexel), length(dy / uSourceTexel));
    // One tap where a pixel covers a texel or less; past that, four taps
    // on a rotated grid across the footprint. The target has no mipmaps, so
    // sampling inside the branch is safe.
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
    gl_FragColor = vec4(eyeLift(color, toneMappingExposure), 1.0);

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

const DEG = 180 / Math.PI;

// eslint-disable-next-line max-lines-per-function
export function createSeatViewPass(
    gl: WebGLRenderer,
    settings: SeatViewSettings,
): SeatViewPass {
    const sceneTarget = new WebGLRenderTarget(1, 1, {
        type: HalfFloatType,
        samples: settings.samples,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
        resolveDepthBuffer: false,
    });
    sceneTarget.texture.name = "view3d.seatView.scene";
    const sourceCamera = new PerspectiveCamera();

    const geometry = new BufferGeometry();
    geometry.setAttribute(
        "position",
        new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3),
    );
    geometry.setAttribute(
        "uv",
        new Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2),
    );
    // The lens per picture column (`paniniColumnTable`), rebuilt when the
    // picture's width or the frame changes.
    let columns = new DataTexture(
        new Float32Array(4),
        1,
        1,
        RGBAFormat,
        FloatType,
    );
    let columnsKey = "";
    const columnTable = (width: number, f: PaniniFrame) => {
        const key = `${width} ${f.halfX} ${f.halfY} ${f.sourceTanX} ${f.sourceTanY} ${f.d} ${f.s}`;
        if (key === columnsKey) return;
        columnsKey = key;
        if (columns.image.width !== width) {
            columns.dispose();
            columns = new DataTexture(
                new Float32Array(width * 4),
                width,
                1,
                RGBAFormat,
                FloatType,
            );
            columns.minFilter = NearestFilter;
            columns.magFilter = NearestFilter;
            columns.generateMipmaps = false;
        }
        paniniColumnTable(width, f, columns.image.data as Float32Array);
        columns.needsUpdate = true;
        remap.uniforms.tPaniniColumns.value = columns;
    };

    const remap = new RawShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: REMAP,
        uniforms: {
            tScene: { value: sceneTarget.texture },
            uSourceTexel: { value: new Vector2(1, 1) },
            uPictureTexel: { value: new Vector2(1, 1) },
            tPaniniColumns: { value: columns },
            uEyeLift: { value: new Vector2() },
            toneMappingExposure: { value: 1 },
        },
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
    });
    const quad = new Mesh(geometry, remap);
    quad.frustumCulled = false;
    const screenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    let frame: PaniniFrame | null = null;
    let toneMapping: ToneMapping | null = null;
    let colorSpace: string | null = null;
    const bufferSize = new Vector2();
    const context = gl.getContext();
    const maxSize = Math.min(
        gl.capabilities.maxTextureSize,
        context.getParameter(context.MAX_RENDERBUFFER_SIZE) as number,
    );

    const composite = () => {
        if (
            toneMapping !== gl.toneMapping ||
            colorSpace !== gl.outputColorSpace
        ) {
            toneMapping = gl.toneMapping;
            colorSpace = gl.outputColorSpace;
            const defines: Record<string, string> = {};
            if (ColorManagement.getTransfer(colorSpace) === SRGBTransfer)
                defines.SRGB_TRANSFER = "";
            const tone = TONE_DEFINES[toneMapping];
            if (tone && toneMapping !== NoToneMapping) defines[tone] = "";
            remap.defines = defines;
            remap.needsUpdate = true;
        }
        remap.uniforms.toneMappingExposure.value = gl.toneMappingExposure;
        gl.setRenderTarget(null);
        gl.render(quad, screenCamera);
    };

    const pass: SeatViewPass = {
        settings,
        sceneTarget,
        sourceCamera,
        get frame() {
            return frame;
        },
        render(scene, camera) {
            const s = pass.settings;
            gl.getDrawingBufferSize(bufferSize);
            const width = Math.max(1, bufferSize.x);
            const height = Math.max(1, bufferSize.y);
            frame = paniniFrame({
                hfovDeg: s.hfovDeg,
                aspect: width / height,
                d: s.d,
                s: s.s,
                maxVfovDeg: s.maxVfovDeg,
            });
            const [sw, sh] = paniniSourceSize(
                width,
                height,
                frame,
                s.sharpness,
                maxSize,
            );
            if (sceneTarget.width !== sw || sceneTarget.height !== sh)
                sceneTarget.setSize(sw, sh);
            if (sceneTarget.samples !== s.samples) {
                sceneTarget.samples = s.samples;
                sceneTarget.dispose();
            }

            // 1. The scene, from the view's eye, wide enough for the lens.
            camera.updateMatrixWorld();
            camera.matrixWorld.decompose(
                sourceCamera.position,
                sourceCamera.quaternion,
                sourceCamera.scale,
            );
            sourceCamera.layers.mask = camera.layers.mask;
            const fov = 2 * Math.atan(frame.sourceTanY) * DEG;
            const aspect = frame.sourceTanX / frame.sourceTanY;
            if (
                sourceCamera.fov !== fov ||
                sourceCamera.aspect !== aspect ||
                sourceCamera.near !== camera.near ||
                sourceCamera.far !== camera.far
            ) {
                sourceCamera.fov = fov;
                sourceCamera.aspect = aspect;
                sourceCamera.near = camera.near;
                sourceCamera.far = camera.far;
                sourceCamera.updateProjectionMatrix();
            }
            gl.setRenderTarget(sceneTarget);
            gl.render(scene, sourceCamera);

            // 2. The remap, the lift and the tone curve, to the canvas.
            const u = remap.uniforms;
            u.uSourceTexel.value.set(1 / sw, 1 / sh);
            u.uPictureTexel.value.set(1 / width, 1 / height);
            columnTable(width, frame);
            u.uEyeLift.value.set(s.lift, s.liftKnee);
            composite();
        },
        composite,
        sourceSize: () => [sceneTarget.width, sceneTarget.height],
        dispose() {
            sceneTarget.dispose();
            geometry.dispose();
            columns.dispose();
            remap.dispose();
        },
    };
    return pass;
}
