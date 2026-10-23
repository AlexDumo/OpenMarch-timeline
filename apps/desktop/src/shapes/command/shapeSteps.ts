import { MODE_LABELS } from "../distribute/distribution";
import {
    distributionOf,
    parseMode,
    switchModes,
    withMode,
} from "../distribute/modes";
import { formatSteps } from "../editor/format";
import type { AnyToolKind, ToolEnv, ToolParam } from "../tool/toolKind";
import type { XY } from "../types";

/**
 * The command bar's steps for a shape kind (#344, #354): Shape › Box asks each of the kind's
 * declared parameters in turn, so a new kind gets its steps without code here. Everything is
 * pure; `shapeCommand.ts` opens the shape and shows it on the field.
 */

/** One question the bar asks, as the shape stands after the answers before it */
export interface ShapeStep {
    readonly param: ToolParam<unknown>;
    /** The answer typed when the step opens: the shape's number now ("4 × 3", "2") */
    readonly initial: string;
    /** The step's answer isn't understood, so the shape ignores it */
    readonly invalid: boolean;
}

/** A parameter's value in its unit, typed the way the chip shows it: 2.5 steps is "2½" */
export function typedValue(param: ToolParam<unknown>, value: number): string {
    return param.unit === "steps" ? formatSteps(value) : String(value);
}

/**
 * The shape after `answers`, one per step in order, and every step it asks. A step hides while
 * its parameter does (a spacing with only one marcher that way), so an answer can change the
 * steps after it. An empty answer keeps the number as it is; one that isn't understood is
 * marked invalid and changes nothing.
 */
export function shapeSteps(
    kind: AnyToolKind,
    base: unknown,
    n: number,
    env: ToolEnv,
    answers: readonly string[],
): { params: unknown; steps: ShapeStep[] } {
    let params = base;
    const steps: ShapeStep[] = [];
    const mode = modeStep(kind);
    for (const param of [
        ...(mode ? [mode] : []),
        ...(kind.params as readonly ToolParam<unknown>[]),
    ]) {
        if (param.shown && !param.shown(params, n)) continue;
        const initial = param.display(params, n, env.stepPx);
        const answer = answers[steps.length];
        let invalid = false;
        if (answer !== undefined && answer.trim() !== "") {
            const next = param.type(params, n, answer, env);
            if (next === null) invalid = true;
            else params = next;
        }
        steps.push({ param, initial, invalid });
    }
    return { params, steps };
}

/**
 * A one-liner's answers on the kind's steps: one that doesn't name a mode leaves the mode step as
 * it is, so "box 4x2 3" still sizes the box and "box outline 4x2" fills it in Outline
 */
export function fillAhead(
    kind: AnyToolKind,
    answers: readonly string[],
): readonly string[] {
    const modes = switchModes(kind);
    if (modes.length === 0 || answers.length === 0) return answers;
    return parseMode(answers[0]!, modes) === null ? ["", ...answers] : answers;
}

/**
 * The host's first step for a closed kind with more than one mode (spec #385): how it is filled,
 * typed by name ("Outline", or "out"). None for a kind with one mode, or an open kind.
 */
export function modeStep(kind: AnyToolKind): ToolParam<unknown> | null {
    const modes = switchModes(kind);
    if (modes.length === 0) return null;
    return {
        key: "mode",
        label: `Fill: ${modes.map((m) => MODE_LABELS[m]).join(", ")}`,
        unit: "choice",
        primary: false,
        drag: "x",
        interval: false,
        blends: false,
        display(params, n) {
            const d = distributionOf(kind, params, n);
            return d ? MODE_LABELS[d.mode] : "";
        },
        type(params, n, text, env) {
            const mode = parseMode(text, modes);
            return mode === null ? null : withMode(kind, params, n, mode, env);
        },
        scrub: (base) => base,
    };
}

/**
 * The shape the bar starts from when no shape of this kind is open: the kind filling a
 * rectangle around where the marchers start, about one default interval apart, then set to
 * each parameter's declared default. Kind-agnostic, so a new kind needs nothing extra.
 */
export function startingParams(
    kind: AnyToolKind,
    starts: readonly XY[],
    n: number,
    env: ToolEnv,
): unknown {
    const center = env.gridSnap(middleOf(starts));
    const interval =
        (kind.params.find((p) => p.interval && p.default !== undefined)
            ?.default ?? 2) * env.stepPx;
    // About square, a little wider than deep, as forms usually are
    const across = Math.ceil(Math.sqrt(Math.max(1, n)));
    const deep = Math.ceil(Math.max(1, n) / across);
    const halfWidth = Math.max(env.stepPx, ((across - 1) * interval) / 2);
    const halfDepth = Math.max(env.stepPx, ((deep - 1) * interval) / 2);
    // Filling a frame, not drawing: kinds draw differently (a box corner to corner, a circle
    // from its center out), but every kind fills a frame the same way
    let params: unknown = kind.fromFrame(
        {
            center,
            halfWidth,
            halfDepth,
            rotation: 0,
            flipX: false,
            flipY: false,
        },
        n,
        env,
    );
    for (const param of kind.params as readonly ToolParam<unknown>[]) {
        if (param.default === undefined) continue;
        if (param.shown && !param.shown(params, n)) continue;
        params =
            param.type(params, n, typedValue(param, param.default), env) ??
            params;
    }
    return params;
}

function middleOf(points: readonly XY[]): XY {
    if (points.length === 0) return { x: 0, y: 0 };
    const sum = points.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), {
        x: 0,
        y: 0,
    });
    return { x: sum.x / points.length, y: sum.y / points.length };
}
