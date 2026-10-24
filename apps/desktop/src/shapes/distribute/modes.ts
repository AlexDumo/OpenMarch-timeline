import type { AnyToolKind, ToolEnv } from "../tool/toolKind";
import {
    MODE_LABELS,
    reshuffled,
    takesStagger,
    type Distribution,
    type DistributionMode,
    type FilesLayout,
    type Fraction,
} from "./distribution";
import type { LayoutRow, ResolvedLayout } from "./layouts";

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

/** The layout picker's rows for `kind` at `n` (#387); none for a kind without layouts */
export function layoutRowsOf(
    kind: AnyToolKind,
    n: number,
): readonly LayoutRow[] {
    return kind.closed?.layouts?.catalogue(n) ?? [];
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

/**
 * The stagger offset a shape takes (#388): null for a kind without layouts, a shape outside
 * Files, or a layout that fixes or centers its lines (Stagger, Rounded, Notched)
 */
export function staggerOf(
    kind: AnyToolKind,
    params: unknown,
    n: number,
): Fraction | null {
    const closed = kind.closed;
    const d = closed?.distribution(params, n);
    if (!closed?.layouts || d?.mode !== "files") return null;
    const now = closed.layouts.resolved(params, n);
    return now && takesStagger(now.layout.family) ? d.stagger : null;
}

/** `params` with the stagger offset `stagger`; `params` itself where it takes none */
export function withStagger(
    kind: AnyToolKind,
    params: unknown,
    n: number,
    stagger: Fraction,
    env: ToolEnv,
): unknown {
    const now = staggerOf(kind, params, n);
    const d = kind.closed?.distribution(params, n);
    if (now === null || d?.mode !== "files") return params;
    if (now[0] * stagger[1] === stagger[0] * now[1]) return params;
    return kind.closed!.withDistribution(params, n, { ...d, stagger }, env);
}
