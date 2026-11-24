import type { QueryClient } from "@tanstack/react-query";
import tolgee from "@/global/singletons/Tolgee";
import { getActionLabel } from "@/shortcuts/labels";
import type { XY } from "../types";
import { closeHandleMenu, useHandleMenuStore } from "../field/handleMenu";
import { withAttach } from "../line/lineLinks";
import type { LineParams } from "../line/lineGeometry";
import { commitBox, type LinkedEdit } from "./commitBox";
import type { PlacedBox } from "./placedBox";
import { sideOf, type ShapeLink } from "./shapeLinks";

/**
 * **Detach** (#1235): linked shapes come apart. The shape that attached gets its own marcher on
 * its end again, its marchers re-spaced along it as an end holding one does; the shape it was
 * attached to keeps the joint's marcher. Nothing else moves, so the two ends still meet until one
 * is dragged away.
 */

/**
 * What Detach says (#1235): the shape it comes apart from, as the Shapes tab names its kind
 * ("Detach from Line"), seen from `from` (the selected shape; the joint marcher's own otherwise);
 * "Detach 2 linked shapes" for several links; the action's own label ("Detach linked shape") for
 * none. The joint's menu, the field's menu and the command palette all say it.
 */
export function detachLabel(
    links: readonly ShapeLink[],
    from?: PlacedBox | null,
): string {
    if (links.length > 1)
        return tolgee.t(
            "shapes.links.detachCount",
            "Detach {count} linked shapes",
            { count: links.length },
        );
    const link = links[0];
    if (!link)
        return getActionLabel("shapeDetach", (key, params) =>
            tolgee.t(key, params as never),
        );
    const side =
        from && from.recipe.id === link.attacher.recipe.id
            ? link.attacher
            : link.owner;
    return tolgee.t("shapes.links.detachFrom", "Detach from {shape}", {
        shape: sideOf(side, link).other.kind.shape.label,
    });
}

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
    from: PlacedBox,
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
                    items: [
                        { value: "detach", label: detachLabel([link], from) },
                    ],
                },
            ],
            pick(value) {
                closeHandleMenu();
                if (value === "detach") void detachLinks([link], queryClient);
            },
        },
    });
}
