import type { Distribution } from "../distribute/distribution";
import { storedDistribution } from "../distribute/distribution";
import type { BoxParams, FrameSize } from "./boxGeometry";

/**
 * What a box remembers across mode switches (#449): the frame the designer drew or last shaped,
 * which every switch fits, and each mode's numbers as it was left. A switch measured from the
 * frame the last switch left would walk the box, half-step rounding on rounding; and Outline's
 * spots across would replace Grid's file count. Stored in the recipe; a box without it (or one
 * reshaped since, whose frame isn't the one the last switch left) starts from its frame as it is.
 */
export interface ModeMemory {
    /** The frame every switch fits */
    readonly frame: FrameSize;
    /** The frame the last switch left, and its count: while the box still has them, nothing reshaped it */
    readonly seen: FrameSize;
    readonly count: number;
    /** Each mode's numbers as it was left, while the frame stands */
    readonly left: Partial<Record<Distribution["mode"], LeftAs>>;
}

/** A mode's numbers as a switch left them */
export type LeftAs = Pick<BoxParams, "files" | "across" | "deep"> & {
    readonly distribution: Distribution;
    readonly spreadAspect?: number;
};

/** A box's numbers in the mode it's in, to come back to */
export function leftAs(p: BoxParams, distribution: Distribution): LeftAs {
    return {
        files: p.files,
        across: p.across,
        deep: p.deep,
        distribution,
        ...(p.spreadAspect !== undefined && { spreadAspect: p.spreadAspect }),
    };
}

const positive = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v > 0;
/** Far wider than any field in field units: a larger stored length is a broken file */
const MOST = 1e6;
/** A length the box can have: positive, and nothing like a broken file's */
const length = (v: unknown): v is number => positive(v) && v <= MOST;
/** A whole number of marchers from 1 to `count` */
const marchers = (v: unknown, count: number): v is number =>
    positive(v) && Number.isInteger(v) && v <= count;
const size = (v: unknown): FrameSize | undefined => {
    const s = v as Partial<Record<keyof FrameSize, unknown>> | null;
    return s && length(s.width) && length(s.depth)
        ? { width: s.width, depth: s.depth }
        : undefined;
};

/**
 * The memory `params` stores, read defensively (recipes come from files): undefined for none or
 * a broken one, and a mode's numbers left out unless it has a whole number of files up to the
 * count and lengths a field could hold
 */
export function readMemory(params: unknown): ModeMemory | undefined {
    const m = (params as { modes?: unknown } | null)?.modes as
        | Partial<Record<keyof ModeMemory, unknown>>
        | undefined;
    if (!m || typeof m !== "object") return undefined;
    const frame = size(m.frame);
    const seen = size(m.seen);
    if (!frame || !seen || !marchers(m.count, Number.MAX_SAFE_INTEGER))
        return undefined;
    const count = m.count;
    const left: Partial<Record<Distribution["mode"], LeftAs>> = {};
    for (const [mode, v] of Object.entries((m.left ?? {}) as object)) {
        const l = v as Partial<Record<keyof LeftAs, unknown>> | null;
        const distribution = storedDistribution(
            { distribution: l?.distribution },
            1,
        );
        if (
            !l ||
            !distribution ||
            distribution.mode !== mode ||
            !marchers(l.files, count) ||
            !length(l.across) ||
            !length(l.deep)
        )
            continue;
        left[distribution.mode] = {
            files: l.files,
            across: l.across,
            deep: l.deep,
            distribution,
            ...(positive(l.spreadAspect) && { spreadAspect: l.spreadAspect }),
        };
    }
    return { frame, seen, count, left };
}

/** Whether two frames are the same, to a millionth of a field unit */
export const sameSize = (a: FrameSize, b: FrameSize): boolean =>
    Math.abs(a.width - b.width) < 1e-6 && Math.abs(a.depth - b.depth) < 1e-6;
