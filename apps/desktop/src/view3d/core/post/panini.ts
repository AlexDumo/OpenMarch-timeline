// cspell:ignore Panini Pannini Sharpless Ballestrem HDRP hfov vfov
/**
 * Seat view's lens (docs/3d/ui.md UI-3): a Panini projection, as game engines
 * use for wide views (Sharpless, Ballestrem and Laurent, "Pannini: A New
 * Projection for Rendering Wide Angle Perspective Images", 2010; Unreal's
 * and Unity HDRP's Panini post pass). Pure math plus the GLSL that applies
 * it, framework-free (ADR 0010 D-1), so it can join a post pipeline as one
 * remap of the scene texture.
 *
 * A rectilinear camera (`u`, `v` = camera-space x/-z, y/-z) widened past
 * about 80° stretches the sides and shrinks the middle. Panini maps a ray's
 * azimuth `phi` and its height on a unit cylinder `t` to
 *
 *     S = (d + 1) / (d + cos phi)
 *     x = S sin phi
 *     y = S lerp(t, t / cos phi, s)
 *
 * `d` is the distance of the projection center behind the cylinder axis: 0 is
 * rectilinear, 1 the classic Panini. `s` is the vertical compression, as in
 * Unreal (0 keeps shapes at the sides their true proportions; toward 1 bends
 * horizontal lines less). Verticals stay straight for every `d` and `s`, and
 * the middle keeps scale 1, so a wide view keeps the field full size.
 */

/** A Panini lens: `d` in [0, 1], `s` in [0, 1]. */
export interface PaniniLens {
    d: number;
    s: number;
}

/**
 * Where one picture's corners fall, on the Panini plane and in the
 * rectilinear source it samples. The picture spans `[-halfX, halfX]` by
 * `[-halfY, halfY]` on the Panini plane; the source camera must see at least
 * `sourceTanX` by `sourceTanY` (tangents of its half angles).
 */
export interface PaniniFrame extends PaniniLens {
    halfX: number;
    halfY: number;
    sourceTanX: number;
    sourceTanY: number;
}

/** Panini plane coordinates of the rectilinear direction (`u`, `v`). */
export function paniniForward(
    u: number,
    v: number,
    { d, s }: PaniniLens,
): [number, number] {
    const inv = 1 / Math.sqrt(1 + u * u);
    const sinPhi = u * inv;
    const cosPhi = inv;
    const t = v * inv;
    const scale = (d + 1) / (d + cosPhi);
    return [scale * sinPhi, scale * (t * (1 - s) + s * v)];
}

/**
 * The inverse of {@link paniniForward} for one column of the Panini plane:
 * every point at `x` shows the rectilinear direction (`u`, `g * y`). The
 * inverse is separable, so a picture can look its columns up in a table
 * (`paniniColumnTable`). With `k = x / (d + 1)`,
 * `sin phi - k cos phi = k d`, so `phi = atan(k) + asin(k d / sqrt(1 + k^2))`.
 */
export function paniniColumn(
    x: number,
    { d, s }: PaniniLens,
): [u: number, g: number] {
    const k = x / (d + 1);
    const r = Math.sqrt(1 + k * k);
    const phi =
        Math.atan(k) + Math.asin(Math.max(-1, Math.min(1, (k * d) / r)));
    const cosPhi = Math.cos(phi);
    const scale = (d + 1) / (d + cosPhi);
    // y = scale (t (1 - s) + s v) with t = v cos phi.
    return [Math.tan(phi), 1 / (scale * ((1 - s) * cosPhi + s))];
}

/** The rectilinear direction (`u`, `v`) a Panini plane point shows, in closed form. */
export function paniniInverse(
    x: number,
    y: number,
    lens: PaniniLens,
): [number, number] {
    const [u, g] = paniniColumn(x, lens);
    return [u, g * y];
}

const DEG = Math.PI / 180;

/** The horizontal field of view (degrees) of a rectilinear camera. */
export function rectilinearHfovDeg(vfovDeg: number, aspect: number): number {
    return (2 * Math.atan(Math.tan((vfovDeg * DEG) / 2) * aspect)) / DEG;
}

export interface PaniniFrameInput extends PaniniLens {
    /** Horizontal field of view across the picture, in degrees (< 180). */
    hfovDeg: number;
    /** Picture width over height. */
    aspect: number;
    /**
     * The most the middle column may see top to bottom, in degrees. A tall
     * window narrows the view rather than look past this.
     */
    maxVfovDeg?: number;
}

/** Samples along the top edge when finding how tall the source must be. */
const EDGE_SAMPLES = 16;

/** The picture's extents for a field of view, a shape and a lens. */
export function paniniFrame({
    hfovDeg,
    aspect,
    d,
    s,
    maxVfovDeg = 170,
}: PaniniFrameInput): PaniniFrame {
    const lens = { d, s };
    let halfX = paniniForward(Math.tan((hfovDeg * DEG) / 2), 0, lens)[0];
    let halfY = halfX / aspect;
    // The middle column is rectilinear vertically (x = 0 gives y = v).
    const maxHalfY = Math.tan((maxVfovDeg * DEG) / 2);
    if (halfY > maxHalfY) {
        halfY = maxHalfY;
        halfX = halfY * aspect;
    }
    const sourceTanX = Math.abs(paniniInverse(halfX, 0, lens)[0]);
    let sourceTanY = halfY;
    for (let i = 0; i <= EDGE_SAMPLES; i++) {
        const v = Math.abs(
            paniniInverse((halfX * i) / EDGE_SAMPLES, halfY, lens)[1],
        );
        if (v > sourceTanY) sourceTanY = v;
    }
    return { d, s, halfX, halfY, sourceTanX, sourceTanY };
}

/** The rectilinear direction (`u`, `v`) shown at a picture point (NDC, -1..1). */
export function screenToSource(
    ndcX: number,
    ndcY: number,
    frame: PaniniFrame,
): [number, number] {
    return paniniInverse(ndcX * frame.halfX, ndcY * frame.halfY, frame);
}

/** Where (NDC) the picture shows the rectilinear direction (`u`, `v`). */
export function sourceToScreen(
    u: number,
    v: number,
    frame: PaniniFrame,
): [number, number] {
    const [x, y] = paniniForward(u, v, frame);
    return [x / frame.halfX, y / frame.halfY];
}

/**
 * The source size, in pixels, for a picture `width` by `height`. At
 * `sharpness` 1 the source has as many pixels per degree at the middle as
 * the picture, so the middle is as sharp as a plain camera; less trades
 * sharpness at the middle for fewer pixels drawn. Capped at `maxSize` a side.
 */
export function paniniSourceSize(
    width: number,
    height: number,
    frame: PaniniFrame,
    sharpness: number,
    maxSize: number,
): [number, number] {
    const w = width * (frame.sourceTanX / frame.halfX) * sharpness;
    const h = height * (frame.sourceTanY / frame.halfY) * sharpness;
    const fit = Math.min(1, maxSize / Math.max(w, h));
    return [Math.max(1, Math.ceil(w * fit)), Math.max(1, Math.ceil(h * fit))];
}

/**
 * Source pixels per picture pixel at the picture's middle, horizontally: 1
 * is as sharp as a plain camera, below 1 is softer.
 */
export function centerSharpness(
    pictureWidth: number,
    sourceWidth: number,
    frame: PaniniFrame,
): number {
    // At the middle, a unit on the Panini plane is a unit of `u`.
    return (
        sourceWidth /
        (2 * frame.sourceTanX) /
        (pictureWidth / (2 * frame.halfX))
    );
}

/** A lens part way between a plain camera (0) and `lens` (1). */
export function mixLens(lens: PaniniLens, amount: number): PaniniLens {
    return { d: lens.d * amount, s: lens.s * amount };
}

/**
 * The eye-like shadow lift: the gain on a color whose exposed luminance is
 * `luminance`. Deep shadows get `1 + lift`, and the gain falls off past
 * `knee`, so a bright field is nearly untouched. Mirrors `EYE_LIFT_GLSL`.
 */
export function eyeLiftGain(
    luminance: number,
    lift: number,
    knee: number,
): number {
    return 1 + (lift * knee) / (knee + Math.max(0, luminance));
}

/**
 * The remap's column table for a picture `width` pixels wide: four floats a
 * column, RGBA in a `width` by 1 float texture read with nearest filtering.
 * For column `i`:
 *
 * - R: the source texture's x coordinate (0..1) the column shows;
 * - G: the source y per picture NDC y, about the middle: the source y
 *   coordinate is `0.5 + ndcY * G`;
 * - B, A: how much R and G change to the next column, for the pixel's
 *   footprint.
 *
 * Looking the lens up per column keeps the per-pixel work to two fetches
 * and a few multiplies; the closed form a pixel cost three times as much.
 */
export function paniniColumnTable(
    width: number,
    frame: PaniniFrame,
    out?: Float32Array,
): Float32Array {
    const table =
        out && out.length === width * 4 ? out : new Float32Array(width * 4);
    const column = (i: number): [number, number] => {
        const [u, g] = paniniColumn(
            (((i + 0.5) / width) * 2 - 1) * frame.halfX,
            frame,
        );
        return [
            (u / frame.sourceTanX) * 0.5 + 0.5,
            ((g * frame.halfY) / frame.sourceTanY) * 0.5,
        ];
    };
    let next = column(0);
    for (let i = 0; i < width; i++) {
        const here = next;
        next = column(i + 1);
        table[i * 4] = here[0];
        table[i * 4 + 1] = here[1];
        table[i * 4 + 2] = next[0] - here[0];
        table[i * 4 + 3] = next[1] - here[1];
    }
    return table;
}

/**
 * GLSL for the remap. `paniniSample(uv, footprint)` returns the source
 * texture coordinate the picture shows at `uv` (0..1) and writes the
 * pixel's footprint there: how far the source coordinate moves to the next
 * pixel across (xy) and down (zw). Needs `tPaniniColumns` (the
 * {@link paniniColumnTable} for the picture's width) and `uPictureTexel`
 * (1 / the picture's size).
 */
export const PANINI_GLSL = /* glsl */ `
uniform sampler2D tPaniniColumns;
uniform vec2 uPictureTexel;

vec2 paniniSample(vec2 uv, out vec4 footprint) {
    vec4 col = texture2D(tPaniniColumns, vec2(uv.x, 0.5));
    float ndcY = uv.y * 2.0 - 1.0;
    footprint = vec4(col.z, ndcY * col.w, 0.0, 2.0 * uPictureTexel.y * col.y);
    return vec2(col.x, 0.5 + ndcY * col.y);
}
`;

/**
 * GLSL for the eye-like shadow lift, on linear color before tone mapping:
 * `eyeLift(color, exposure)`. Uniform `uEyeLift` is (lift, knee). Mirrors
 * {@link eyeLiftGain}.
 */
export const EYE_LIFT_GLSL = /* glsl */ `
uniform vec2 uEyeLift;

vec3 eyeLift(vec3 color, float exposure) {
    float l = max(dot(color, vec3(0.2126, 0.7152, 0.0722)) * exposure, 0.0);
    return color * (1.0 + uEyeLift.x * uEyeLift.y / (uEyeLift.y + l));
}
`;
