/**
 * The platform and obstacle checks (C4.5, props-spec section 5 "Platforms and obstacles"), for the
 * show's notes list. Quiet notes, never a block:
 *
 * - a performer stepping up or down more than 16 in at once: "P12 steps up 24 in onto Stage";
 * - a performer whose dot is inside an obstacle, who clips through it in 3D, over the counts they
 *   are in it: "T4 is inside Wall A";
 * - a dot leaving a platform while the platform moves: riders aren't carried with it.
 *
 * Checked on every count, as the 3D View stands them (`propsAt`, `platformTopAt`), so a step is
 * the change in platform height from one count to the next; a step taken within a count is that
 * count's. Beats are ordinals.
 */
import { propsAt, platformTopAt } from "@/view3d/core/props/propLayout";
import type {
    GroundPoint,
    PropInput,
    PropSolid,
} from "@/view3d/core/props/propLayout";
import type { XY } from "@openmarch/core";
import { insideOutline } from "@/items/itemOutlines";
import type { ShowNote } from "./showNotes";

/** A step of more than this, in meters, gets a note: 16 in. */
export const STEP_NOTE_HEIGHT = 16 * 0.0254;

const SAME = 1e-6;

export interface PlatformNotesInput {
    /** The show's props, by their marchers rows */
    props: readonly PropInput[];
    /** A prop's item id, from its marchers row */
    itemIdOf: (marcherId: number) => number;
    /** The performers (not items), by marcher id */
    performers: readonly number[];
    /** How many beats the show has: ordinals run from 0 to `beatCount - 1` */
    beatCount: number;
    /** The resolver's position (put-downs included), in field units; null where it has none */
    positionAt: (marcherId: number, beat: number) => XY | null;
    /** Field units in a meter */
    unitsPerMeter: number;
}

const holds = (s: PropSolid, p: GroundPoint) =>
    s.closed &&
    insideOutline(
        s.outline.map((q) => ({ x: q.x, y: q.z })),
        { x: p.x, y: p.z },
    );

interface Bounds {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

const boundsOf = (solids: readonly PropSolid[]): Bounds => {
    const b = {
        minX: Infinity,
        maxX: -Infinity,
        minZ: Infinity,
        maxZ: -Infinity,
    };
    for (const s of solids)
        for (const p of s.outline) {
            b.minX = Math.min(b.minX, p.x);
            b.maxX = Math.max(b.maxX, p.x);
            b.minZ = Math.min(b.minZ, p.z);
            b.maxZ = Math.max(b.maxZ, p.z);
        }
    return b;
};

const within = (b: Bounds, p: GroundPoint) =>
    p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;

/** The platform and obstacle notes. Nothing when the show has neither. */
export function platformNotes(input: PlatformNotesInput): ShowNote[] {
    const standing = input.props.filter(
        (p) => p.surface === "platform" || p.surface === "obstacle",
    );
    if (standing.length === 0 || input.performers.length === 0) return [];
    const ground = (id: number, beat: number): GroundPoint | null => {
        const p = input.positionAt(id, beat);
        return p
            ? { x: p[0] / input.unitsPerMeter, z: p[1] / input.unitsPerMeter }
            : null;
    };

    const notes: ShowNote[] = [];
    /** Each performer's platform height on the last count, and the platforms under them */
    const last = new Map<number, { top: number; on: Set<number> }>();
    /** Open obstacle notes, by performer and obstacle */
    const inside = new Map<string, ShowNote>();
    let before: Map<number, PropSolid> = new Map();

    for (let beat = 0; beat < input.beatCount; beat++) {
        const solids = propsAt(standing, beat, (id) => ground(id, beat));
        const byId = new Map(solids.map((s) => [s.id, s]));
        const platforms = solids.filter((s) => s.surface === "platform");
        const obstacles = solids.filter((s) => s.surface === "obstacle");
        const bounds = boundsOf(solids);
        for (const marcherId of input.performers) {
            const dot = ground(marcherId, beat);
            if (!dot) {
                last.delete(marcherId);
                continue;
            }
            // Most performers are nowhere near a prop
            const near = within(bounds, dot);
            const top = near ? platformTopAt(platforms, dot) : 0;
            const on = new Set(
                near
                    ? platforms.filter((s) => holds(s, dot)).map((s) => s.id)
                    : [],
            );
            const was = last.get(marcherId);
            if (was) {
                const rise = top - was.top;
                if (Math.abs(rise) > STEP_NOTE_HEIGHT + SAME) {
                    // Named by the platform stepped onto, or off
                    const highest = (
                        ids: Set<number>,
                        from: Map<number, PropSolid>,
                    ) =>
                        [...ids]
                            .map((id) => from.get(id))
                            .filter((s): s is PropSolid => !!s)
                            .sort(
                                (a, b) =>
                                    b.base + b.height - (a.base + a.height),
                            )[0];
                    const platform =
                        rise > 0 ? highest(on, byId) : highest(was.on, before);
                    notes.push({
                        id: `platform_step:${marcherId}:${beat}`,
                        kind: "platform_step",
                        source: "items",
                        beat,
                        until: beat + 1,
                        what: {
                            itemIds: platform
                                ? [input.itemIdOf(platform.id)]
                                : [],
                            marcherIds: [marcherId],
                            cueIds: [],
                        },
                        detail: { rise },
                    });
                }
                for (const id of was.on) {
                    const then = before.get(id);
                    const now = byId.get(id);
                    if (on.has(id) || !then || !now) continue;
                    const moved =
                        Math.abs(now.center.x - then.center.x) > SAME ||
                        Math.abs(now.center.z - then.center.z) > SAME;
                    if (!moved) continue;
                    notes.push({
                        id: `leaves_moving_platform:${marcherId}:${id}:${beat}`,
                        kind: "leaves_moving_platform",
                        source: "items",
                        beat,
                        until: beat + 1,
                        what: {
                            itemIds: [input.itemIdOf(id)],
                            marcherIds: [marcherId],
                            cueIds: [],
                        },
                    });
                }
            }
            last.set(marcherId, { top, on });

            for (const obstacle of obstacles) {
                const key = `${marcherId}:${obstacle.id}`;
                const open = inside.get(key);
                if (near && holds(obstacle, dot)) {
                    if (open) open.until = beat + 1;
                    else {
                        const note: ShowNote = {
                            id: `inside_obstacle:${marcherId}:${obstacle.id}:${beat}`,
                            kind: "inside_obstacle",
                            source: "items",
                            beat,
                            until: beat + 1,
                            what: {
                                itemIds: [input.itemIdOf(obstacle.id)],
                                marcherIds: [marcherId],
                                cueIds: [],
                            },
                        };
                        inside.set(key, note);
                        notes.push(note);
                    }
                } else if (open) inside.delete(key);
            }
        }
        // An obstacle no longer drawn closes its notes
        for (const [key, note] of inside)
            if (note.until !== beat + 1) inside.delete(key);
        before = byId;
    }
    return notes;
}
