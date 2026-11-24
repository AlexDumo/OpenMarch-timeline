import type { QueryClient } from "@tanstack/react-query";
import tolgee from "@/global/singletons/Tolgee";
import { getActionLabel } from "@/shortcuts/labels";
import type { XY } from "../types";
import { closeHandleMenu, useHandleMenuStore } from "../field/handleMenu";
import { withAttach } from "../line/lineLinks";
import type { LineParams } from "../line/lineGeometry";
import { commitBox, type LinkedEdit } from "./commitBox";
import type { PlacedBox } from "./placedBox";
import type { ShapeLink } from "./shapeLinks";

/**
 * **Detach** (#1235): linked shapes come apart. The shape that attached gets its own marcher on
 * its end again, its marchers re-spaced along it as an end holding one does; the shape it was
 * attached to keeps the joint's marcher. Nothing else moves, so the two ends still meet until one
 * is dragged away.
 */

/** "Detach", the action's label: the joint's menu and the command palette say the same */
export const detachLabel = (): string =>
    getActionLabel("shapeDetach", (key, params) =>
        tolgee.t(key, params as never),
    );

/**
 * `links` detached, as one undo step: each shape that attached saved without those attachments
 * (`commitBox`, the first with the rest beside it)
 */
export function detachLinks(
    links: readonly ShapeLink[],
    queryClient: QueryClient,
): Promise<void> {
    const byAttacher = new Map<number, LinkedEdit>();
    for (const link of links) {
        const id = link.attacher.recipe.id;
        const was = byAttacher.get(id);
        const params = withAttach(
            (was?.params ?? link.attacher.params) as LineParams,
            link.attacherEnd,
            undefined,
        );
        byAttacher.set(id, {
            box: link.attacher as PlacedBox,
            params,
        });
    }
    const [first, ...rest] = byAttacher.values();
    if (!first) return Promise.resolve();
    return commitBox(
        first.box,
        first.params,
        queryClient,
        undefined,
        undefined,
        undefined,
        rest,
    );
}

/**
 * The joint's menu (#1235), at `at` in the field's element: a right-click, a Mac's Ctrl-click or
 * a long press on the joint of the selected shape. Headed by which shape holds the joint's marcher.
 */
export function openJointMenu(
    link: ShapeLink,
    at: XY,
    queryClient: QueryClient,
): void {
    useHandleMenuStore.setState({
        menu: {
            at,
            key: "joint",
            sections: [
                {
                    label: tolgee.t(
                        "shapes.links.jointMenu",
                        "Joint marcher: {shape}'s",
                        { shape: link.owner.kind.shape.label },
                    ),
                    items: [{ value: "detach", label: detachLabel() }],
                },
            ],
            pick(value) {
                closeHandleMenu();
                if (value === "detach") void detachLinks([link], queryClient);
            },
        },
    });
}
