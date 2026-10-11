import { toast } from "sonner";
import tolgee from "@/global/singletons/Tolgee";
import { shapeKind } from "../registry";
import type { ShapeSession } from "../session";
import { useShapeToolStore } from "../shapeToolStore";

/**
 * Says that a shape closed without being placed, with a way to bring it back (sims, round 8:
 * Escape meant for a toolbar, or a click on another set, silently dropped a shape being tuned).
 * `bringBack` defaults to opening the session again as it was.
 */
export function offerBringBack(
    session: ShapeSession,
    bringBack: () => void = () => useShapeToolStore.getState().restore(session),
): void {
    const kind = shapeKind(session.kindId)?.label ?? session.kindId;
    toast.info(
        tolgee.t(
            "inspector.shapeTool.leftUnplaced",
            "The {kind} wasn't placed",
            {
                kind: kind.toLowerCase(),
            },
        ),
        {
            action: {
                label: tolgee.t(
                    "inspector.shapeTool.bringBack",
                    "Bring it back",
                ),
                onClick: bringBack,
            },
        },
    );
}
