import type { AnyToolKind, ToolEnv } from "../tool/toolKind";
import {
    MODE_LABELS,
    reshuffled,
    SEED_MAX,
    spreadDistribution,
    type Distribution,
    type DistributionMode,
    type FilesLayout,
} from "./distribution";
import type { ResolvedLayout } from "./layouts";

/**
 * The mode switch's rules (spec #385), the same for the inspector and the command bar, without
 * knowing the kind. Everything is pure.
 */

/**
 * The modes a switch offers for `kind`: its own, and none while it has only one (an open kind
 * has none)
 */
export function switchModes(kind: AnyToolKind): readonly DistributionMode[] {
    const modes = kind.closed?.modes ?? [];
    return modes.length > 1 ? modes : [];
}

/** How a shape of `kind` is filled now; null for an open kind */
export function distributionOf(
    kind: AnyToolKind,
    params: unknown,
    n: number,
): Distribution | null {
    return kind.closed ? kind.closed.distribution(params, n) : null;
}

/**
 * `params` filled in `mode`, starting from the kind's defaults for it; `params` itself when
 * it's already in that mode or the kind can't be filled that way
 */
export function withMode(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    mode: DistributionMode,
    env: ToolEnv,
): unknown {
    const closed = kind.closed;
    if (!closed || !closed.modes.includes(mode)) return params;
    if (closed.distribution(params, n).mode === mode) return params;
    return closed.withDistribution(
        params,
        n,
        closed.startMode(params, n, mode),
        env,
    );
}

/**
 * Reshuffle (spec #385): a spread's next seed, laid out for the `n` spots there are now; null
 * when the shape isn't a spread. One change, so one undo step.
 */
export function reshuffle(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    env: ToolEnv,
): unknown {
    const closed = kind.closed;
    const d = closed?.distribution(params, n);
    if (!closed || d?.mode !== "spread") return null;
    return closed.withDistribution(params, n, reshuffled(d, n), env);
}

/**
 * A spread laid out with `seed` for the `n` spots there are now (#437, for advanced users): the
 * same seed gives the same spread. Null when the shape isn't a spread or the seed isn't a whole
 * number from 1 to `SEED_MAX`. One change, so one undo step.
 */
export function withSeed(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    seed: number,
    env: ToolEnv,
): unknown {
    const closed = kind.closed;
    const d = closed?.distribution(params, n);
    if (!closed || d?.mode !== "spread") return null;
    if (!Number.isSafeInteger(seed) || seed < 1 || seed > SEED_MAX) return null;
    return closed.withDistribution(params, n, spreadDistribution(seed, n), env);
}

/** A typed seed: a whole number from 1 to `SEED_MAX`, or null */
export function parseSeed(text: string): number | null {
    const t = text.trim();
    if (!/^\d+$/.test(t)) return null;
    const seed = Number(t);
    return Number.isSafeInteger(seed) && seed >= 1 && seed <= SEED_MAX
        ? seed
        : null;
}

/** The mode a typed answer names among `modes`: its label or the start of it ("out") */
export function parseMode(
    text: string,
    modes: readonly DistributionMode[],
): DistributionMode | null {
    const t = text.trim().toLowerCase();
    if (t === "") return null;
    return (
        modes.find((m) => MODE_LABELS[m].toLowerCase().startsWith(t)) ?? null
    );
}

/**
 * The layout a shape is laid out in now, for the picker to mark: null for a kind without layouts
 * or a shape outside Files
 */
export function layoutOf(
    kind: AnyToolKind,
    params: unknown,
    n: number,
): ResolvedLayout | null {
    return kind.closed?.layouts?.resolved(params, n) ?? null;
}

/**
 * `params` laid out in `layout`, its stagger kept; `params` itself for a kind without layouts or
 * a shape outside Files
 */
export function withLayout(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    layout: FilesLayout,
    env: ToolEnv,
): unknown {
    const closed = kind.closed;
    if (!closed?.layouts) return params;
    const d = closed.distribution(params, n);
    if (d.mode !== "files") return params;
    return closed.withDistribution(params, n, { ...d, layout }, env);
}
