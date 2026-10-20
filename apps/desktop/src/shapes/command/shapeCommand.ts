import { planCanvasEdit } from "@/timeline/timelineCoordinateWrites";
import type { CommandRun, CommandStep } from "@/shortcuts/palette/commandBar";
import { closeDockedCommand } from "@/shortcuts/palette/commandBar";
import {
    currentShapeField,
    marchersOnField,
    shapeContextFor,
} from "../field/shapeFieldContext";
import { toolEnvFor } from "../tool/toolEnv";
import type { AnyToolKind, ToolEnv } from "../tool/toolKind";
import type { ShapeField } from "../field/shapeField";
import { edit, openTool, startsOf, type ToolState } from "../tool/toolMachine";
import { useShapeToolStore } from "../tool/shapeToolStore";
import { shapeSteps, startingParams, switchedParams } from "./shapeSteps";

/**
 * What the command starts from: the open shape (switched to `kind` keeping its frame if it's
 * another kind), or a new one of `kind`'s defaults on `ids`. Null when there's nothing to open.
 */
function startFrom(
    kind: AnyToolKind,
    ids: readonly number[],
    field: ShapeField,
    env: ToolEnv,
): { start: ToolState; base: unknown; keeps: boolean } | null {
    const open = useShapeToolStore.getState().tool;
    if (open !== null && open.params !== null && !open.gesture) {
        if (open.kind === kind)
            return { start: open, base: open.params, keeps: true };
        const start = openTool(kind, open.marchers);
        const base = switchedParams(
            kind,
            open.kind,
            open.params,
            startsOf(start),
            start.spots,
            env,
        );
        return base === null ? null : { start, base, keeps: true };
    }
    if (ids.length === 0) return null;
    const start = openTool(kind, marchersOnField(field, ids));
    if (start.spots === 0) return null;
    const base = startingParams(kind, startsOf(start), start.spots, env);
    return base === null ? null : { start, base, keeps: false };
}

/**
 * Shape › kind in the command bar (#354): opens a shape of `kind` on `ids` (the selection, past
 * the selection gate) and asks its parameters, the shape showing live on the field as each is
 * typed. It starts from the open shape when there is one: the same kind keeps its numbers, and
 * another kind is switched to keeping its frame. Otherwise it starts from the kind's defaults
 * around where the marchers stand.
 *
 * The answers are one undo step in the shape's own history. Finishing leaves the shape open for
 * the chip and Place (Enter); Escape puts back whatever was open before. If the shape ends
 * another way while the bar is up (a scrub or a new selection places it), the bar closes.
 */
export function beginShapeCommand(
    kind: AnyToolKind,
    ids: readonly number[],
    path: readonly string[],
): CommandRun | null {
    const field = currentShapeField();
    if (!field) return null;
    const before = useShapeToolStore.getState();
    const ctx = shapeContextFor(field);
    const env = toolEnvFor(field, { shift: false, alt: false });
    const from = startFrom(kind, ids, field, env);
    if (!from) return null;
    const { start, base } = from;
    const openedAt = from.keeps ? before.openedAt : planCanvasEdit();

    /** The tool this command last showed; anything else means the shape ended another way */
    let shown: ToolState | null = null;
    let unsubscribe = () => {};
    const run: CommandRun = {
        path,
        preview(answers) {
            const { params, steps } = shapeSteps(
                kind,
                base,
                start.spots,
                env,
                answers,
            );
            const tool =
                params === start.params ? start : edit(start, params, ctx);
            if (tool !== shown) {
                shown = tool;
                useShapeToolStore.setState({
                    tool,
                    openedAt,
                    discarded: null,
                });
            }
            return steps.map(
                (s): CommandStep => ({
                    key: s.param.key,
                    label: s.param.label,
                    initial: s.initial,
                    invalid: s.invalid,
                }),
            );
        },
        finish(answers) {
            unsubscribe();
            run.preview(answers);
        },
        cancel() {
            unsubscribe();
            useShapeToolStore.setState({
                tool: before.tool,
                openedAt: before.openedAt,
                discarded: before.discarded,
            });
        },
    };
    unsubscribe = useShapeToolStore.subscribe((state) => {
        if (shown !== null && state.tool !== shown) {
            unsubscribe();
            closeDockedCommand(run);
        }
    });
    return run;
}
