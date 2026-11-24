import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { create } from "zustand";
import { actionDisabledReason, onRefusedPress } from "@/shortcuts/registry";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { useBoxSelectionStore } from "./boxSelectionStore";
import { joinCheck, joinShapes } from "./joinShapes";
import {
    placedBoxesAt,
    usePlacedBoxBeat,
    usePlacedBoxStore,
} from "./placedBoxStore";

/**
 * Whether the selection is placed shapes the field's menu offers **Join into one line** on, even
 * while it can't run (`JoinCheck.onShapes`): greyed there with its reason
 */
export const useJoinOfferStore = create<{ readonly offered: boolean }>(() => ({
    offered: false,
}));

/**
 * The **Join into one line** action (`shapeJoin`, #1220): two placed Lines, Curves or Arcs
 * selected whole, on the same move, joined into one (`joinShapes`). Refused with its reason
 * otherwise, in the palette and the field's menu; a key bound to it that's refused shows the reason
 * too, never a press that does nothing. Off while placed shapes can't be selected (the Shape tool
 * open, playback, the View tab's Shapes off).
 */
export function useJoinShapes(
    ready: boolean,
    selectedIds: readonly number[],
): void {
    const queryClient = useQueryClient();
    const enabled = useBoxSelectionStore((s) => s.enabled);
    const recipes = usePlacedBoxStore((s) => s.recipes);
    const ends = usePlacedBoxStore((s) => s.ends);
    const version = useTimelineResolverStore((s) => s.version);
    const beat = usePlacedBoxBeat();
    const check = useMemo(
        () =>
            ready && enabled
                ? joinCheck(new Set(selectedIds), placedBoxesAt(beat, recipes))
                : null,
        // `ends` and `version` change what `placedBoxesAt` reads from its stores
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [ready, enabled, selectedIds, recipes, ends, version, beat],
    );
    const offered = check !== null && (check.ok || check.onShapes);
    useEffect(() => {
        useJoinOfferStore.setState({ offered });
    }, [offered]);
    useEffect(() => () => useJoinOfferStore.setState({ offered: false }), []);

    useActionHandler(
        "shapeJoin",
        () => {
            if (check?.ok) void joinShapes(check.a, check.b, queryClient);
        },
        {
            enabled: check?.ok === true,
            ignoreRepeat: true,
            disabledReason: check && !check.ok ? check.reason : undefined,
        },
    );
    // No button shows a refused key's reason (`notifyRefusedPress`), so a toast does
    useEffect(
        () =>
            onRefusedPress((id) => {
                if (id !== "shapeJoin") return false;
                const reason = actionDisabledReason(id);
                if (!reason) return false;
                toast(reason, { id: "shapeJoin-refused" });
                return true;
            }),
        [],
    );
}
