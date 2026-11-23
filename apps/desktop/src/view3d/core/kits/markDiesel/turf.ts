import { BufferGeometry, Float32BufferAttribute, Mesh } from "three";
import { GROUND_LAYER, setGroundLayer } from "../../environment";
import { FIELD_SURFACE_Y, type TurfColors } from "../../field";
import { TURF } from "../../field/turfPlan";
import type { DieselCtx, DieselPart } from "./frame";

/**
 * Mark Diesel's turf: FieldTurf-style synthetic grass, as in the reference
 * photos. Its green is a saturated yellow-green (hue about 70, saturation
 * about 0.7 in photos 1, 4, 6 and 10, against the shared turf's bluer 110),
 * not a lawn's; under this venue's lamps and exposure the base comes out
 * near `#b2c840`, as in the photos. The fibers' specular is dull
 * (`TURF_SPECULAR`): a plain dielectric's grazing Fresnel washed the far
 * field out pale. The 5-yard rolls
 * are only a little apart in the paint: most of their light and dark comes
 * from the fibers' lay against the view, with the fibers' sheen, blade
 * grain and rubber crumb on top (`surface: "synthetic"`,
 * `field/turfSheen.ts`).
 * Only the grass changes: lines, numbers and logos keep the shared paint
 * white.
 */
export const DIESEL_TURF: TurfColors = {
    base: "#8b9b2c",
    stripeDark: "#87972a",
    stripeLight: "#8f9f2f",
    surface: "synthetic",
};

/** The NFL's 6 ft white border round the field, outside the sidelines and end lines. */
export const DIESEL_BORDER_WIDTH = 6 * 0.3048;

/**
 * The white border round the field (the reference photos' wide white band
 * along each sideline): a 6 ft frame just outside the field surface, on the
 * apron, painted in the field's white. One draw call.
 */
export function buildDieselFieldBorder(ctx: DieselCtx): DieselPart {
    const { frame, shared, quality } = ctx;
    const hx = frame.FIELD_HALF_LENGTH;
    const hz = frame.FIELD_HALF_WIDTH;
    const w = DIESEL_BORDER_WIDTH;
    const y = FIELD_SURFACE_Y;
    const positions: number[] = [];
    // Each quad wound to face up: (x0, z0) to (x1, z1) with x0 < x1, z0 < z1.
    const quad = (x0: number, z0: number, x1: number, z1: number) =>
        positions.push(
            x0,
            y,
            z0,
            x0,
            y,
            z1,
            x1,
            y,
            z1,
            x0,
            y,
            z0,
            x1,
            y,
            z1,
            x1,
            y,
            z0,
        );
    quad(-hx - w, -hz - w, hx + w, -hz);
    quad(-hx - w, hz, hx + w, hz + w);
    quad(-hx - w, -hz, -hx, hz);
    quad(hx, -hz, hx + w, hz);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const material = setGroundLayer(
        shared.std(parseInt(TURF.paint.slice(1), 16), { roughness: 0.95 }),
        GROUND_LAYER.decal,
    );
    const mesh = new Mesh(geometry, material);
    mesh.name = "markDiesel.fieldBorder";
    mesh.receiveShadow = quality === "high";
    return {
        object: mesh,
        setLighting() {},
        dispose() {
            geometry.dispose();
        },
    };
}
