import { orderChoiceOf, type AssignMarcher, type OrderChoice } from "../assign";
import type { PlacedBox } from "./placedBox";

/**
 * Who goes where and placed shapes (#528, spec #522). Everything here is pure.
 */

/**
 * The marchers, each with their place along the placed Line they stand on, when every one of them
 * is a member of that one Line (a kind with an order, `ToolKind.ordered`): a shape opened on them
 * can keep their order along it. Unchanged otherwise.
 *
 * @param boxes the placed shapes shown where the marchers were selected
 */
export function withPlacedOrder(
    marchers: readonly AssignMarcher[],
    boxes: readonly PlacedBox[],
): AssignMarcher[] {
    const first = marchers[0];
    const line = first
        ? boxes.find(
              (b) =>
                  b.kind.ordered &&
                  b.recipe.members.some((m) => m.marcherId === first.id),
          )
        : undefined;
    if (!line) return [...marchers];
    const slotOf = new Map(
        line.recipe.members.map((m) => [m.marcherId, m.slot] as const),
    );
    if (!marchers.every((m) => slotOf.has(m.id))) return [...marchers];
    return marchers.map((m) => ({ ...m, along: slotOf.get(m.id)! }));
}

/** Who goes where a placed shape was laid out by: its recipe's order mode and reverse */
export const placedOrderChoice = (box: PlacedBox): OrderChoice =>
    box.kind.ordered
        ? orderChoiceOf(box.recipe.orderMode, box.recipe.reverse)
        : "nearest";
