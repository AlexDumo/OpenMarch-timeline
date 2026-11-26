import type { QueryClient } from "@tanstack/react-query";
import { runAction } from "@/shortcuts/registry";
import type { LineParams } from "../line/lineGeometry";
import type { PlacedBox } from "./placedBox";
import { splitShape } from "./splitShape";

/**
 * Splits from the scissors or a line's own menu (#1336) through the `shapeSplitHere` action, so
 * every way in runs the one action (tablet parity 1) and is counted as it. The action's handler
 * (`useSplitHere`) splits where it's told while one of these runs, and where the field's menu was
 * opened otherwise.
 */

/** The split one of these is running, while it runs */
let running: { box: PlacedBox<LineParams>; k: number } | null = null;

/** The split the scissors or a line's menu asked for, while `shapeSplitHere` runs for it */
export const scissorsSplit = () => running;

/**
 * Splits `box` after its first `k` spots along it by running `shapeSplitHere`; straight through
 * `splitShape` where nothing handles the action (the field's modes not mounted)
 */
export function splitThroughAction(
    box: PlacedBox<LineParams>,
    k: number,
    queryClient: QueryClient,
): void {
    running = { box, k };
    try {
        if (runAction("shapeSplitHere")) return;
    } finally {
        running = null;
    }
    void splitShape(box, k, queryClient);
}
