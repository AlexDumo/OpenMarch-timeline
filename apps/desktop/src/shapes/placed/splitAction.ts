import type { QueryClient } from "@tanstack/react-query";
import { runAction } from "@/shortcuts/registry";
import type { PlacedBox } from "./placedBox";
import { splitShape, type SplitCut } from "./splitShape";

/**
 * Splits from the scissors or a line's own menu (#1336) through the `shapeSplitHere` action, so
 * every way in runs the one action (tablet parity 1) and is counted as it. The action's handler
 * (`useSplitHere`) splits where it's told while one of these runs, and where the field's menu was
 * opened otherwise.
 */

/** The split one of these is running, while it runs */
let running: { box: PlacedBox; cut: SplitCut } | null = null;

/** The split the scissors or a line's menu asked for, while `shapeSplitHere` runs for it */
export const scissorsSplit = () => running;

/**
 * Splits `box` along `cut` by running `shapeSplitHere`; straight through `splitShape` where
 * nothing handles the action (the field's modes not mounted)
 */
export function splitThroughAction(
    box: PlacedBox,
    cut: SplitCut,
    queryClient: QueryClient,
): void {
    running = { box, cut };
    try {
        if (runAction("shapeSplitHere")) return;
    } finally {
        running = null;
    }
    void splitShape(box, cut, queryClient);
}
