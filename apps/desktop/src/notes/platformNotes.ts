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
import {
    platformTopAt,
    propsAt,
    type GroundPoint,
    type PropInput,
    type PropSolid,
} from "@/view3d/core/props/propLayout";
import type { XY } from "@openmarch/core";
import { insideOutline } from "@/items/itemOutlines";
import type { ShowNote, ShowNoteKind } from "./showNotes";

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

const topOf = (s: PropSolid) => s.base + s.height;

/** One beat's props, as the checks read them. */
interface Standing {
    byId: Map<number, PropSolid>;
    platforms: PropSolid[];
    obstacles: PropSolid[];
    /** Around every prop: most performers are nowhere near one */
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

function standingAt(solids: readonly PropSolid[]): Standing {
    const bounds = {
        minX: Infinity,
        maxX: -Infinity,
        minZ: Infinity,
        maxZ: -Infinity,
    };
    for (const s of solids)
        for (const p of s.outline) {
            bounds.minX = Math.min(bounds.minX, p.x);
            bounds.maxX = Math.max(bounds.maxX, p.x);
            bounds.minZ = Math.min(bounds.minZ, p.z);
            bounds.maxZ = Math.max(bounds.maxZ, p.z);
        }
    return {
        byId: new Map(solids.map((s) => [s.id, s])),
        platforms: solids.filter((s) => s.surface === "platform"),
        obstacles: solids.filter((s) => s.surface === "obstacle"),
        bounds,
    };
}

const near = ({ bounds: b }: Standing, p: GroundPoint) =>
    p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;

/** Where a performer stood on a count: the platform height, and the platforms under them. */
interface Footing {
    top: number;
    on: ReadonlySet<number>;
}

function footingAt(standing: Standing, dot: GroundPoint): Footing {
    if (!near(standing, dot)) return { top: 0, on: new Set() };
    return {
        top: platformTopAt(standing.platforms, dot),
        on: new Set(
            standing.platforms.filter((s) => holds(s, dot)).map((s) => s.id),
        ),
    };
}

/** The tallest of these platforms, or undefined. */
const tallest = (ids: ReadonlySet<number>, standing: Standing) =>
    [...ids]
        .map((id) => standing.byId.get(id))
        .filter((s): s is PropSolid => !!s)
        .sort((a, b) => topOf(b) - topOf(a))[0];

class PlatformChecks {
    readonly notes: ShowNote[] = [];
    private readonly last = new Map<number, Footing>();
    /** Open obstacle notes, by performer and obstacle */
    private readonly inside = new Map<string, ShowNote>();

    constructor(private readonly itemIdOf: (marcherId: number) => number) {}

    private note(
        kind: ShowNoteKind,
        key: string,
        beat: number,
        propId: number | undefined,
        marcherId: number,
    ): ShowNote {
        const note: ShowNote = {
            id: `${kind}:${key}:${beat}`,
            kind,
            source: "items",
            beat,
            until: beat + 1,
            what: {
                itemIds: propId === undefined ? [] : [this.itemIdOf(propId)],
                marcherIds: [marcherId],
                cueIds: [],
            },
        };
        this.notes.push(note);
        return note;
    }

    /** A performer with no position on this count: nothing to step from on the next. */
    lost(marcherId: number) {
        this.last.delete(marcherId);
    }

    /** One performer on one count, against this count's props and the last count's. */
    check(
        marcherId: number,
        dot: GroundPoint,
        beat: number,
        now: Standing,
        before: Standing,
    ) {
        const footing = footingAt(now, dot);
        const was = this.last.get(marcherId);
        if (was) {
            const rise = footing.top - was.top;
            if (Math.abs(rise) > STEP_NOTE_HEIGHT + SAME) {
                // Named by the platform stepped onto, or off
                const platform =
                    rise > 0
                        ? tallest(footing.on, now)
                        : tallest(was.on, before);
                this.note(
                    "platform_step",
                    `${marcherId}`,
                    beat,
                    platform?.id,
                    marcherId,
                ).detail = { rise };
            }
            for (const id of was.on) {
                const then = before.byId.get(id);
                const it = now.byId.get(id);
                if (footing.on.has(id) || !then || !it) continue;
                if (
                    Math.abs(it.center.x - then.center.x) > SAME ||
                    Math.abs(it.center.z - then.center.z) > SAME
                )
                    this.note(
                        "leaves_moving_platform",
                        `${marcherId}:${id}`,
                        beat,
                        id,
                        marcherId,
                    );
            }
        }
        this.last.set(marcherId, footing);

        const inRange = near(now, dot);
        for (const obstacle of now.obstacles) {
            const key = `${marcherId}:${obstacle.id}`;
            const open = this.inside.get(key);
            if (!inRange || !holds(obstacle, dot)) this.inside.delete(key);
            else if (open) open.until = beat + 1;
            else
                this.inside.set(
                    key,
                    this.note(
                        "inside_obstacle",
                        key,
                        beat,
                        obstacle.id,
                        marcherId,
                    ),
                );
        }
    }

    /** After every performer's check on a count: an obstacle no longer drawn closes its notes. */
    endBeat(beat: number) {
        for (const [key, note] of this.inside)
            if (note.until !== beat + 1) this.inside.delete(key);
    }
}

/** The platform and obstacle notes. Nothing when the show has neither. */
export function platformNotes(input: PlatformNotesInput): ShowNote[] {
    const props = input.props.filter(
        (p) => p.surface === "platform" || p.surface === "obstacle",
    );
    if (props.length === 0 || input.performers.length === 0) return [];
    const ground = (id: number, beat: number): GroundPoint | null => {
        const p = input.positionAt(id, beat);
        return p
            ? { x: p[0] / input.unitsPerMeter, z: p[1] / input.unitsPerMeter }
            : null;
    };
    const checks = new PlatformChecks(input.itemIdOf);
    let before = standingAt([]);
    for (let beat = 0; beat < input.beatCount; beat++) {
        const now = standingAt(propsAt(props, beat, (id) => ground(id, beat)));
        for (const marcherId of input.performers) {
            const dot = ground(marcherId, beat);
            if (dot) checks.check(marcherId, dot, beat, now, before);
            else checks.lost(marcherId);
        }
        checks.endBeat(beat);
        before = now;
    }
    return checks.notes;
}
