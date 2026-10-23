import {
    onField,
    scrubSize,
    scrubSpacing,
    stepSize,
    withFieldCount,
    withSpacing,
} from "../editor/boxEdits";
import { fallbackNote } from "../distribute/layouts";
import { formatSteps } from "../editor/format";
import { parseSize, parseSteps, scrubDistance } from "../editor/scrub";
import type { ToolParam } from "../tool/toolKind";
import { boxBlock, isSpread, shortBy, type BoxParams } from "./boxGeometry";

/**
 * The box's numbers (#344, "The kind contract"; 08-shape-system-ux.md, "The floating editor"):
 * `6 × 2 │ ↔ 2 ↕ 2 steps`. They follow the field: across is side to side however the box is
 * turned (owner, 2026-10-17), so each works out which of the box's own spacings that is.
 */
export const BOX_PARAMS: readonly ToolParam<BoxParams>[] = [
    {
        key: "size",
        label: "Size, across × deep",
        unit: "count",
        primary: true,
        drag: "both",
        interval: false,
        blends: false,
        range: { min: 1 },
        // A spread has no files or ranks: its handles shape it
        shown: (p) => !isSpread(p),
        display(p, n) {
            const field = onField(p, n);
            return `${field.across} × ${field.deep}`;
        },
        note: sizeNote,
        type(p, n, text, env) {
            const size = parseSize(text);
            if (!size) return null;
            const field = onField(p, n);
            return size.across !== field.across || size.deep === undefined
                ? withFieldCount(p, n, "across", size.across, env)
                : withFieldCount(p, n, "deep", size.deep, env);
        },
        scrub: (base, n, m, env) =>
            scrubSize(
                base,
                m.axis === "x" ? "across" : "deep",
                scrubDistance(m.axis, m.dx, m.dy),
                n,
                env,
            ),
        stepper: {
            less: "One fewer across",
            more: "One more across",
            by: stepSize,
        },
    },
    spacing("across"),
    spacing("deep"),
];

/**
 * The note after the box's size: "1 short" for Short back, or for Short back standing in for a
 * layout that can't make the count, what would (#387): "Full needs 1 more or 2 fewer". Other
 * layouts leave nothing out of their block by accident, so they have none.
 */
export function sizeNote(p: BoxParams, n: number): string | null {
    // A spread has no ranks to be short
    if (isSpread(p)) return null;
    const block = boxBlock(p, n);
    if (block.fellBack) return fallbackNote(block.fellBack, n);
    if (block.layout.family !== "shortBack") return null;
    const short = shortBy(p, n);
    return short > 0 ? `${short} short` : null;
}

/** A spacing on the field: side to side (across) or front to back (deep) */
function spacing(way: "across" | "deep"): ToolParam<BoxParams> {
    const across = way === "across";
    /** Which of the box's own spacings runs this way on the field (a spread's is `across`) */
    const ownKey = (p: BoxParams, n: number) => {
        if (isSpread(p)) return "across";
        const field = onField(p, n);
        return across ? field.acrossKey : field.deepKey;
    };
    /** The spacing this way, in steps */
    const stepsOf = (p: BoxParams, n: number, stepPx: number) => {
        if (isSpread(p)) return p.across / stepPx;
        const field = onField(p, n);
        return (across ? field.acrossSpacing : field.deepSpacing) / stepPx;
    };
    return {
        key: way,
        label: across
            ? "Side-to-side spacing, in steps"
            : "Front-to-back spacing, in steps",
        unit: "steps",
        primary: true,
        drag: across ? "x" : "y",
        interval: true,
        blends: true,
        default: 2,
        range: { min: 0.5 },
        glyph: across ? "↔" : "↕",
        shown(p, n) {
            // A spread has one interval, the closest pair: the across one
            if (isSpread(p)) return across && n > 1;
            const field = onField(p, n);
            return (across ? field.across : field.deep) > 1;
        },
        display: (p, n, stepPx) => formatSteps(stepsOf(p, n, stepPx)),
        value: stepsOf,
        type(p, n, text, env) {
            const steps = parseSteps(text);
            if (steps === null) return null;
            return withSpacing(p, ownKey(p, n), steps, n, env);
        },
        scrub: (base, n, m, env) =>
            scrubSpacing(
                base,
                ownKey(base, n),
                scrubDistance(across ? "x" : "y", m.dx, m.dy),
                n,
                env,
            ),
        widen(p, n, by, env) {
            const steps = stepsOf(p, n, env.stepPx) + by;
            if (steps < 0.5 - 1e-9) return null;
            const next = withSpacing(p, ownKey(p, n), steps, n, env);
            return next === p ? null : next;
        },
    };
}
