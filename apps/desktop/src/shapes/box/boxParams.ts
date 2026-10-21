import {
    onField,
    scrubSize,
    scrubSpacing,
    withFieldCount,
    withSpacing,
} from "../editor/boxEdits";
import { formatSteps } from "../editor/format";
import { parseSize, parseSteps, scrubDistance } from "../editor/scrub";
import type { ToolParam } from "../tool/toolKind";
import { shortBy, type BoxParams } from "./boxGeometry";

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
        display(p, n) {
            const field = onField(p, n);
            return `${field.across} × ${field.deep}`;
        },
        note(p, n) {
            const short = shortBy(p, n);
            return short > 0 ? `${short} short` : null;
        },
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
            by(p, n, by, env) {
                const across = onField(p, n).across + by;
                if (across < 1 || across > n) return null;
                return withFieldCount(p, n, "across", across, env);
            },
        },
    },
    spacing("across"),
    spacing("deep"),
];

/** A spacing on the field: side to side (across) or front to back (deep) */
function spacing(way: "across" | "deep"): ToolParam<BoxParams> {
    const across = way === "across";
    /** Which of the box's own spacings runs this way on the field */
    const ownKey = (p: BoxParams, n: number) => {
        const field = onField(p, n);
        return across ? field.acrossKey : field.deepKey;
    };
    /** The spacing this way, in steps */
    const stepsOf = (p: BoxParams, n: number, stepPx: number) => {
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
            const field = onField(p, n);
            const steps =
                (across ? field.acrossSpacing : field.deepSpacing) /
                    env.stepPx +
                by;
            if (steps < 0.5 - 1e-9) return null;
            const next = withSpacing(p, ownKey(p, n), steps, n, env);
            return next === p ? null : next;
        },
    };
}
