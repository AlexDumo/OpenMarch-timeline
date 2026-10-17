import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BoxParams } from "../box/boxGeometry";
import { currentShapeField, shapeContextFor } from "../field/shapeFieldContext";
import {
    previewPlacedBox,
    useBoxSelectionStore,
    usePlacedBoxPreviewStore,
} from "../placed/boxSelectionStore";
import { commitBox } from "../placed/commitBox";
import { keptOf, orderOf } from "../placed/liveBox";
import { useDrawnOnPage } from "../placed/placedBoxText";
import {
    beginEdit,
    cancelGesture,
    edit,
    previewEdit,
    release,
    setOrder,
    type ToolOrder,
} from "../tool/toolMachine";
import { updateTool, useShapeToolStore } from "../tool/shapeToolStore";
import { useApplyShape } from "../tool/useShapeToolActions";

/**
 * What the floating editor edits (08-shape-system-ux.md, "The floating editor"): the shape the
 * tool has open, which waits for Place, or a selected placed shape, which saves each edit on
 * release. The editor itself doesn't know which.
 */
export interface ShapeEditTarget {
    readonly params: BoxParams;
    /** Spots in the box, holes included */
    readonly spots: number;
    /** Spots no member stands on any more (a placed box's holes) */
    readonly empty: number;
    readonly order: ToolOrder;
    /** Who goes where was kept through a turn or flip: neither order is lit */
    readonly kept: boolean;
    /** Place, for a new shape; absent for a placed one */
    readonly place?: () => void;
    /** "Page 3", when a placed shape was drawn on an earlier page than the one shown */
    readonly drawnOn: string | null;
    /** A number's drag starts, moves and ends: one change when it's kept */
    begin(): void;
    preview(params: BoxParams): void;
    end(keep: boolean): void;
    /** One change at once: a typed number, a button */
    apply(params: BoxParams): void;
    setOrder(order: ToolOrder): void;
}

const withField = (run: (ctx: ReturnType<typeof shapeContextFor>) => void) => {
    const field = currentShapeField();
    if (field) run(shapeContextFor(field));
};

/** The open tool's shape, or null with none open or none drawn yet */
export function useToolEditTarget(): ShapeEditTarget | null {
    const tool = useShapeToolStore((s) => s.tool);
    const place = useApplyShape();
    return useMemo(() => {
        if (!tool || tool.params === null) return null;
        return {
            params: tool.params as BoxParams,
            spots: tool.marchers.length,
            empty: 0,
            order: tool.order,
            kept: tool.kept,
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
            setOrder: (order) =>
                withField((ctx) => updateTool((t) => setOrder(t, order, ctx))),
        };
    }, [tool, place]);
}

/** How long a saved drag's preview may outlast the save before the box is read back */
const PREVIEW_HOLD_MS = 1000;

/** The selected placed box, or null with none selected */
export function usePlacedEditTarget(): ShapeEditTarget | null {
    const box = useBoxSelectionStore((s) => s.selected);
    const queryClient = useQueryClient();
    const drawnOn = useDrawnOnPage(box);
    return useMemo(() => {
        if (!box) return null;
        const save = (params: BoxParams) =>
            commitBox(box, params, queryClient).finally(() =>
                // Normally the box read back replaces the preview first (useShapeFieldModes)
                setTimeout(() => previewPlacedBox(null), PREVIEW_HOLD_MS),
            );
        return {
            params: box.params,
            spots: box.spots,
            empty: box.spots - box.recipe.members.length,
            order: orderOf(box),
            kept: keptOf(box),
            drawnOn,
            begin: () => previewPlacedBox(box.params),
            preview: (params) => previewPlacedBox(params),
            end: (keep) => {
                const { params } = usePlacedBoxPreviewStore.getState();
                if (keep && params && params !== box.params) void save(params);
                else previewPlacedBox(null);
            },
            apply: (params) => {
                if (params !== box.params) void save(params);
            },
            setOrder: (order) =>
                void commitBox(box, box.params, queryClient, order),
        };
    }, [box, queryClient, drawnOn]);
}
