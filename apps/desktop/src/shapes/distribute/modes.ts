import type { AnyToolKind, ToolEnv } from "../tool/toolKind";
import {
    MODE_LABELS,
    type Distribution,
    type DistributionMode,
} from "./distribution";

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
