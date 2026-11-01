/**
 * Where the 3D View stands each prop at a moment (C4.5, props-spec section 5 "Platforms and
 * obstacles", ADR 0002 D-10): its Outline at real size around where the timeline has it, raised
 * onto the platform under it.
 *
 * - A prop is drawn from the count it was made on, and not while it is Off field. A held prop is
 *   its holder's to draw (C4.6), so it is left out here.
 * - A platform or an obstacle sits on the top of the tallest platform under its footprint center.
 *   Of two platforms over each other's centers, the smaller stands on the larger, and of two the
 *   same size the later made (the higher id) on the earlier, so stacking makes steps. A loop of
 *   three or more (each center over the next) is broken where it is entered.
 * - A Floor prop stays flat on the Base floor and lifts nothing; obstacles are never stood on.
 *
 * Plain TypeScript only: this module lives under `view3d/core/`. Outlines are in world meters on
 * the ground plane (+X toward side 2, +Z toward the audience), turned as the 2D field turns them.
 */
import {
    itemGeometryAt,
    placementAt,
    type GeometryChange,
    type ItemGeometry,
    type PlacementChange,
} from "@openmarch/core";
import type { SurfaceType } from "@/db-functions/items";
import {
    insideOutline,
    outlineShape,
    PIXELS_PER_METER,
} from "@/items/itemOutlines";

/** A point on the ground plane, in world meters. */
export interface GroundPoint {
    x: number;
    z: number;
}

/** One prop, by its marchers row id, with its stored changes. */
export interface PropInput {
    id: number;
    surface: SurfaceType;
    /** Its Outline changes, by beat ordinal */
    changes: readonly GeometryChange[];
    /** Its Placement changes, by beat ordinal */
    placements: readonly PlacementChange[];
}

/** A prop as the 3D View draws it at one moment. */
export interface PropSolid {
    id: number;
    surface: SurfaceType;
    center: GroundPoint;
    /** The height of its underside: the top of the platform it stands on, or 0 */
    base: number;
    /** Its vertical size, 0 for a Floor prop */
    height: number;
    /** Its Outline on the ground, placed and turned */
    outline: readonly GroundPoint[];
    /** False for an open freehand path, which has no inside */
    closed: boolean;
    geometry: ItemGeometry;
}

type Footprint = Omit<PropSolid, "base">;

/** The prop's Outline on the ground, as the 2D field places it (`placeOutline`), in meters. */
function footprintOf(
    input: PropInput,
    geometry: ItemGeometry,
    center: GroundPoint,
): Footprint {
    const shape = outlineShape(
        geometry.outlineType,
        geometry.customOutline,
        geometry.width * PIXELS_PER_METER,
        geometry.depth * PIXELS_PER_METER,
    );
    const radians = (geometry.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    // The field's +y is the world's +z, so its turn reads the same seen from above
    const outline = shape.points.map((p) => ({
        x: center.x + (p.x * cos - p.y * sin) / PIXELS_PER_METER,
        z: center.z + (p.x * sin + p.y * cos) / PIXELS_PER_METER,
    }));
    return {
        id: input.id,
        surface: input.surface,
        center,
        height: input.surface === "floor" ? 0 : geometry.height,
        outline,
        closed: shape.closed,
        geometry,
    };
}

const area = (outline: readonly GroundPoint[]) => {
    let twice = 0;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++)
        twice += outline[j].x * outline[i].z - outline[i].x * outline[j].z;
    return Math.abs(twice) / 2;
};

/** Two areas this close are the same size (m²) */
const SAME_AREA = 1e-6;

/** Whether `point` is inside the footprint's Outline (an open path has no inside). */
export const holds = (
    f: Pick<PropSolid, "closed" | "outline">,
    point: GroundPoint,
) =>
    f.closed &&
    insideOutline(
        f.outline.map((p) => ({ x: p.x, y: p.z })),
        { x: point.x, y: point.z },
    );

/**
 * Every prop drawn at `beat`, in the order given, standing where it stands.
 *
 * @param beat a beat ordinal, fractional between beats
 * @param positionOf where the timeline has a prop at `beat`, or null when it has none
 */
export function propsAt(
    props: readonly PropInput[],
    beat: number,
    positionOf: (id: number) => GroundPoint | null,
): PropSolid[] {
    const drawn: Footprint[] = [];
    for (const input of props) {
        const geometry = itemGeometryAt(input.changes, beat);
        if (!geometry) continue;
        if (placementAt(input.placements, beat).state !== "placed") continue;
        const center = positionOf(input.id);
        if (!center) continue;
        drawn.push(footprintOf(input, geometry, { ...center }));
    }

    const platforms = drawn.filter((f) => f.surface === "platform" && f.closed);
    const areas = new Map(platforms.map((f) => [f.id, area(f.outline)]));
    // Of two platforms over each other's centers, which is under: the larger, then the earlier
    const lower = (a: Footprint, b: Footprint) =>
        areas.get(a.id)! - areas.get(b.id)! > SAME_AREA ||
        (Math.abs(areas.get(a.id)! - areas.get(b.id)!) <= SAME_AREA &&
            a.id < b.id);
    const standsOn = (f: Footprint, under: Footprint) =>
        under.id !== f.id &&
        holds(under, f.center) &&
        (f.surface !== "platform" ||
            !holds(f, under.center) ||
            lower(under, f));
    const top = new Map<number, number>();
    const visiting = new Set<number>();
    /** Set when a loop was broken: values worked out meanwhile depend on the way in */
    let brokeLoop = false;
    const baseOf = (f: Footprint): number => {
        if (f.surface === "floor") return 0;
        visiting.add(f.id);
        let base = 0;
        for (const under of platforms) {
            if (!standsOn(f, under)) continue;
            if (visiting.has(under.id)) brokeLoop = true;
            else base = Math.max(base, topOf(under));
        }
        visiting.delete(f.id);
        return base;
    };
    const topOf = (f: Footprint): number => {
        const known = top.get(f.id);
        if (known !== undefined) return known;
        const outer = brokeLoop;
        brokeLoop = false;
        const t = baseOf(f) + f.height;
        if (!brokeLoop) top.set(f.id, t);
        brokeLoop ||= outer;
        return t;
    };

    return drawn.map((f) => ({ ...f, base: baseOf(f) }));
}

/** The top of the tallest platform under `point`, or 0 (the ground) where there is none. */
export function platformTopAt(
    solids: readonly PropSolid[],
    point: GroundPoint,
): number {
    let top = 0;
    for (const s of solids)
        if (s.surface === "platform" && holds(s, point))
            top = Math.max(top, s.base + s.height);
    return top;
}
