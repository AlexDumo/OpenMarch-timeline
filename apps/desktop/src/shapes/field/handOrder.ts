import { useEffect } from "react";
import { db } from "@/global/database/db";
import { rememberedOrderAt } from "@/db-functions/rememberedOrder";
import {
    displayedBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { updateTool, useShapeToolStore } from "../tool/shapeToolStore";
import { takeHandOrder } from "../tool/toolMachine";
import { currentShapeField, shapeContextFor } from "./shapeFieldContext";

/**
 * The beat a shape's marchers come from: the start of the move being edited (its start flag, or
 * the isolated move's start), else the beat shown. An order set by hand there is theirs.
 */
function startBeat(): number {
    const state = useTimelineSelectionStore.getState();
    const { selection, isolation } = state;
    if (isolation) return isolation.start;
    if (selection.kind === "range") return selection.start;
    return displayedBeat(state);
}

/**
 * Keep order follows an order set by hand (Set order, Reverse; 09-who-goes-where.md): when a shape
 * opens on marchers that aren't all on one placed Line, the order the show remembers for them where
 * they start is read, and the open shape takes it as their order along a line. Read once per
 * shape; a shape whose marchers already have an order (a placed Line's) keeps that.
 */
export function useHandOrder(): void {
    const marchers = useShapeToolStore((s) => s.tool?.marchers ?? null);
    useEffect(() => {
        if (!marchers || marchers.length < 2) return;
        if (marchers.some((m) => m.along !== undefined)) return;
        const ids = marchers.map((m) => m.id);
        let stale = false;
        void rememberedOrderAt(db, ids, startBeat()).then((order) => {
            const field = currentShapeField();
            if (stale || !order || order.length !== ids.length || !field)
                return;
            updateTool((t) =>
                t.marchers === marchers
                    ? takeHandOrder(t, order, shapeContextFor(field))
                    : t,
            );
        });
        return () => {
            stale = true;
        };
    }, [marchers]);
}
