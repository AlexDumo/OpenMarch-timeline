import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import tolgee from "@/global/singletons/Tolgee";
import { useActionHandler } from "@/shortcuts/useActionHandler";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { useBoxSelectionStore } from "./boxSelectionStore";
import { detachLabel, detachLinks } from "./detachLinks";
import type { PlacedBox } from "./placedBox";
import {
    placedBoxesAt,
    usePlacedBoxBeat,
    usePlacedBoxStore,
} from "./placedBoxStore";
import {
    JOINT_TOLERANCE,
    linksOf,
    liveLinks,
    type ShapeLink,
} from "./shapeLinks";

/**
 * The links the selection (`selected` marcher ids) can detach, among the placed shapes `boxes`
 * shown at `beat`, each once: those of every shape selected whole, and the link whose joint's
 * marcher is selected (a right-click on the joint, which selects that marcher)
 */
export function selectedLinks(
    selected: ReadonlySet<number>,
    boxes: readonly PlacedBox[],
    beat: number,
): ShapeLink[] {
    const whole = boxes.filter(
        (b) =>
            b.recipe.members.length > 0 &&
            b.recipe.members.every((m) => selected.has(m.marcherId)),
    );
    const links = liveLinks(boxes, beat);
    const out = new Set<ShapeLink>();
    for (const box of whole) for (const l of linksOf(box, links)) out.add(l);
    for (const l of links) {
        const onJoint = l.owner.recipe.members.some(
            (m) =>
                selected.has(m.marcherId) &&
                Math.hypot(m.x - l.at.x, m.y - l.at.y) <= JOINT_TOLERANCE,
        );
        if (onJoint) out.add(l);
    }
    return [...out];
}

/**
 * The **Detach** action (`shapeDetach`, #1235): every link of the placed shapes selected whole,
 * or of the joint whose marcher is selected, comes apart, as one undo step (`detachLinks`). The
 * selected shape's joint has its own menu, which detaches that link. Refused with its reason when
 * nothing selected is linked; off while placed shapes can't be selected (the Shape tool open,
 * playback, the View tab's Shapes off).
 */
export function useDetachLinks(
    ready: boolean,
    selectedIds: readonly number[],
): void {
    const queryClient = useQueryClient();
    const enabled = useBoxSelectionStore((s) => s.enabled);
    const recipes = usePlacedBoxStore((s) => s.recipes);
    const ends = usePlacedBoxStore((s) => s.ends);
    const version = useTimelineResolverStore((s) => s.version);
    const beat = usePlacedBoxBeat();
    const links = useMemo(
        () =>
            ready && enabled
                ? selectedLinks(
                      new Set(selectedIds),
                      placedBoxesAt(beat, recipes),
                      beat,
                  )
                : [],
        // `ends` and `version` change what `placedBoxesAt` reads from its stores
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [ready, enabled, selectedIds, recipes, ends, version, beat],
    );
    // Named from the shape selected whole, if one side of the link is
    const label = useMemo(() => {
        if (links.length === 0) return undefined;
        const selected = new Set(selectedIds);
        const from = links
            .flatMap((l) => [l.attacher, l.owner])
            .find(
                (b) =>
                    b.recipe.members.length > 0 &&
                    b.recipe.members.every((m) => selected.has(m.marcherId)),
            );
        return detachLabel(links, from);
    }, [links, selectedIds]);
    useActionHandler(
        "shapeDetach",
        () => {
            if (links.length > 0) void detachLinks(links, queryClient);
        },
        {
            enabled: links.length > 0,
            label,
            ignoreRepeat: true,
            disabledReason:
                ready && enabled
                    ? tolgee.t(
                          "shapes.links.detachNeedsLink",
                          "Select a linked line, curve or arc to detach it",
                      )
                    : undefined,
        },
    );
}
