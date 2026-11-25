import { TICKS_PER_BEAT } from "@openmarch/core";
import {
    createExactPathReader,
    type OpenMarchShowData,
} from "@openmarch/schema";
import { toSteps, type StepAxes } from "../exact-paths-export";

/**
 * Plays an exported `.om` show as a reader does (spec M.7, EP-R2), for the export's tests: the
 * schema package's reader where the marcher has an exact path in the page, and a straight line
 * between sets where it has none.
 */

/**
 * A reader's straight line between sets: in the page holding `tick`, from the set before to the
 * page's own, by share of the page's ticks. The last page runs to `endTick`.
 */
export function straightLines(show: OpenMarchShowData, endTick: number) {
    const pages = [...show.pages].sort(
        (a, b) => a.startBeatIndex - b.startBeatIndex,
    );
    const starts = pages.map((p) => p.startBeatIndex * TICKS_PER_BEAT);
    const at = new Map<string, readonly [number, number]>();
    for (const c of show.coordinates)
        at.set(`${c.marcherId}:${c.pageId}`, [c.xSteps, c.ySteps]);
    return (marcherId: string, tick: number): readonly [number, number] => {
        let k = 0;
        while (k + 1 < starts.length && starts[k + 1]! <= tick) k++;
        const to = at.get(`${marcherId}:${pages[k]!.id}`)!;
        if (k === 0) return to;
        const from = at.get(`${marcherId}:${pages[k - 1]!.id}`)!;
        const end = starts[k + 1] ?? endTick;
        const s =
            end > starts[k]! ? (tick - starts[k]!) / (end - starts[k]!) : 1;
        return [
            from[0] + s * (to[0] - from[0]),
            from[1] + s * (to[1] - from[1]),
        ];
    };
}

/** What the comparison needs from the app: every marcher's position at a beat, in canvas pixels. */
export interface AppPositions {
    marcherIds(): readonly number[];
    positionsAt(beat: number, out: Float64Array): void;
}

/**
 * The largest gap, in steps, between the show as a reader plays it and the app's positions, at
 * every tick from 0 to `endTick`, for every performer in the show.
 */
export function worstGapToApp({
    show,
    app,
    axes,
    endTick,
}: {
    show: OpenMarchShowData;
    app: AppPositions;
    axes: StepAxes;
    endTick: number;
}): { worst: number; at: string } {
    const reader = createExactPathReader(show);
    const straight = straightLines(show, endTick);
    const ids = app.marcherIds();
    const performers = new Set(show.performers.map((p) => p.id));
    const checked = ids
        .map((id, i) => [String(id), i] as const)
        .filter(([id]) => performers.has(Number(id)));
    const buffer = new Float64Array(2 * ids.length);
    let worst = 0;
    let at = "";
    for (let tick = 0; tick <= endTick; tick++) {
        app.positionsAt(tick / TICKS_PER_BEAT, buffer);
        for (const [id, i] of checked) {
            const [ax, ay] = toSteps(axes, buffer[2 * i]!, buffer[2 * i + 1]!);
            const [x, y] = reader.positionAt(id, tick) ?? straight(id, tick);
            const gap = Math.hypot(x - ax, y - ay);
            if (gap > worst) {
                worst = gap;
                at = `marcher ${id} beat ${(tick / TICKS_PER_BEAT).toFixed(3)}`;
            }
        }
    }
    return { worst, at };
}
