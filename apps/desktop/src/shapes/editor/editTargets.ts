import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { carryPivot } from "../frame/pivot";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import {
    previewPlacedBox,
    useBoxSelectionStore,
    usePlacedBoxPreviewStore,
} from "../placed/boxSelectionStore";
import { originsAtStart } from "../field/previewContext";
import { commitBox } from "../placed/commitBox";
import { recalculatedTargets } from "../placed/liveBox";
import {
    canCloseUp,
    closedUpParams,
    type PlacedBox,
} from "../placed/placedBox";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { toolEnvFor } from "../tool/toolEnv";
import { useDrawnOnPage } from "../placed/placedBoxText";
import {
    beginEdit,
    cancelGesture,
    edit,
    canRecalculate,
    previewEdit,
    recalculate,
    release,
} from "../tool/toolMachine";
import {
    updateTool,
    useShapeHidden,
    useShapeToolStore,
} from "../tool/shapeToolStore";
import type { AnyToolKind } from "../tool/toolKind";
import { useApplyShape } from "../tool/useShapeToolActions";

/**
 * What the floating editor edits (08-shape-system-ux.md, "The floating editor"): the shape the
 * tool has open, which waits for Place, or a selected placed shape, which saves each edit on
 * release. The editor itself doesn't know which, nor the shape's kind: it shows the numbers the
 * kind declares.
 */
export interface ShapeEditTarget {
    readonly kind: AnyToolKind;
    readonly params: unknown;
    /** Spots in the shape, holes included */
    readonly spots: number;
    /** Spots no member stands on any more (a placed shape's holes) */
    readonly empty: number;
    /** Place, for a new shape; absent for a placed one */
    readonly place?: () => void;
    /** "Page 3", when a placed shape was drawn on an earlier page than the one shown */
    readonly drawnOn: string | null;
    /** A number's drag starts, moves and ends: one change when it's kept */
    begin(): void;
    preview(params: unknown): void;
    end(keep: boolean): void;
    /** One change at once: a typed number, a button */
    apply(params: unknown): void;
    /**
     * Recalculate who goes where (#429): the marchers on the shape's spots by least travel from
     * where they come from, as one change. Null when that changes nothing, so the button is
     * disabled; moving and turning keep who goes where until it's pressed.
     */
    readonly recalculate: (() => void) | null;
    /**
     * Close up (#392): a placed closed shape with holes laid out again for its members, as one
     * change. Absent for a new shape, and for a placed one with no holes or an open kind.
     */
    readonly closeUp?: () => void;
}

const withField = (run: (ctx: ReturnType<typeof shapeContextFor>) => void) => {
    const field = currentShapeField();
    if (field) run(shapeContextFor(field));
};

/**
 * The open tool's shape, or null with none open, none drawn yet, or the shape waiting out of
 * sight (#416, `useShapeHidden`)
 */
export function useToolEditTarget(): ShapeEditTarget | null {
    const tool = useShapeToolStore((s) => s.tool);
    const away = useShapeHidden();
    const place = useApplyShape();
    return useMemo(() => {
        if (!tool || tool.params === null || away) return null;
        return {
            kind: tool.kind,
            params: tool.params,
            spots: tool.spots,
            empty: 0,
            place: () => void place(),
            drawnOn: null,
            begin: () => updateTool(beginEdit),
            preview: (params) => updateTool((t) => previewEdit(t, params)),
            end: (keep) =>
                keep
                    ? withField((ctx) => updateTool((t) => release(t, ctx)))
                    : updateTool(cancelGesture),
            apply: (params) =>
                withField((ctx) => updateTool((t) => edit(t, params, ctx))),
            recalculate: toolCanRecalculate(tool)
                ? () =>
                      withField((ctx) => updateTool((t) => recalculate(t, ctx)))
                : null,
        };
    }, [tool, away, place]);
}

/** How long a saved drag's preview may outlast the save before the box is read back */
const PREVIEW_HOLD_MS = 1000;

/** The selected placed shape, of any kind, or null with none selected */
export function usePlacedEditTarget(): ShapeEditTarget | null {
    const box = useBoxSelectionStore((s) => s.selected);
    const queryClient = useQueryClient();
    const drawnOn = useDrawnOnPage(box);
    // Where the members come from moves with the start flag
    const startFlag = useTimelineSelectionStore((s) =>
        s.isolation
            ? s.isolation.start
            : s.selection.kind === "range"
              ? s.selection.start
              : null,
    );
    return useMemo(() => {
        if (!box) return null;
        const save = (params: unknown) =>
            commitBox(box, params, queryClient).finally(() =>
                // Normally the box read back replaces the preview first (useShapeFieldModes)
                setTimeout(() => previewPlacedBox(null), PREVIEW_HOLD_MS),
            );
        return {
            kind: box.kind,
            params: box.params,
            spots: box.spots,
            empty: box.spots - box.recipe.members.length,
            drawnOn,
            begin: () => previewPlacedBox(box.params),
            preview: (params) =>
                previewPlacedBox(carryPivot(box.params, params)),
            end: (keep) => {
                const { params } = usePlacedBoxPreviewStore.getState();
                if (keep && params && params !== box.params) void save(params);
                else previewPlacedBox(null);
            },
            apply: (params) => {
                if (params !== box.params)
                    void save(carryPivot(box.params, params));
            },
            // With no start flag (at home) there's nowhere else to come from
            recalculate:
                startFlag !== null && placedCanRecalculate(box)
                    ? () =>
                          void commitBox(
                              box,
                              box.params,
                              queryClient,
                              true,
                              originsOf(box),
                          )
                    : null,
            ...(canCloseUp(box) && {
                closeUp: () => {
                    const field = currentShapeField();
                    if (!field) return;
                    const params = closedUpParams(
                        box,
                        box.recipe.members.length,
                        toolEnvFor(field, { shift: false, alt: false }),
                    );
                    // Least travel, whatever order it was laid out in (spec #385)
                    if (params !== null)
                        void commitBox(box, params, queryClient, true);
                },
            }),
        };
    }, [box, queryClient, drawnOn, startFlag]);
}

/** Not worked out during a drag: it's a full least-travel solve */
const toolCanRecalculate = (tool: Parameters<typeof canRecalculate>[0]) => {
    const field = currentShapeField();
    return (
        !tool.gesture && !!field && canRecalculate(tool, shapeContextFor(field))
    );
};

/** Where a placed shape's members come from: the start flag */
const originsOf = (box: PlacedBox) =>
    originsAtStart(box.recipe.members.map((m) => m.marcherId));

const placedCanRecalculate = (box: PlacedBox) => {
    const field = currentShapeField();
    return (
        !!field &&
        recalculatedTargets(box, shapeContextFor(field), originsOf(box)) !==
            null
    );
};
