import { toast } from "sonner";
import tolgee from "@/global/singletons/Tolgee";
import { planCanvasEdit } from "@/timeline/timelineCoordinateWrites";
import {
    currentShapeField,
    marchersOnField,
    shapeContextFor,
} from "../field/shapeFieldContext";
import { useBoxSelectionStore } from "../placed/boxSelectionStore";
import { startOverWaitingShape } from "../tool/shapeLeave";
import {
    isShapeShown,
    openShapeTool,
    useShapeToolStore,
} from "../tool/shapeToolStore";
import { openDrawn } from "../tool/toolMachine";
import { pictureOf, planPaste } from "./picture";
import {
    copiedPicture,
    keepPicture,
    useCopiedPictureStore,
} from "./pictureStore";

/**
 * Copy and paste of a formation (#961, owner 2026-11-15). Copy keeps where the marchers `ids`
 * stand at the moment on screen; Paste shows that picture on the marchers selected then, as an
 * open shape of the shape host, so it's moved, turned and placed (Enter, one undo step) like a
 * shape drawn here, and Escape throws it away. Pasting rearranges: no marcher is ever added.
 */

const COPIED_TOAST = "formation-copied";
const LEFT_TOAST = "formation-paste-left";

/**
 * Copies the formation of the marchers `ids`, in selection order: as its shape when they are
 * exactly one placed shape, as loose dots otherwise. Nothing on the field changes. False when
 * there was nothing to copy.
 */
export function copyFormation(ids: readonly number[]): boolean {
    const field = currentShapeField();
    if (!field) return false;
    const drawn = field.drawn(ids);
    const positions = ids.flatMap((id) => drawn.get(id) ?? []);
    // The placed shape whose members are exactly the selection, if any
    const { selected } = useBoxSelectionStore.getState();
    const picked = new Set(ids);
    const shape =
        selected &&
        selected.recipe.members.length === picked.size &&
        selected.recipe.members.every((m) => picked.has(m.marcherId))
            ? selected
            : null;
    const picture = pictureOf({
        positions,
        shape,
        stepPx: field.fieldProperties.pixelsPerStep,
    });
    if (!picture) return false;
    keepPicture(picture);
    toast.message(
        shape
            ? tolgee.t(
                  "shapes.clipboard.copiedShape",
                  "{shape} copied ({count, plural, one {# marcher} other {# marchers}})",
                  {
                      shape: shape.kind.shape.label,
                      count: positions.length,
                  },
              )
            : tolgee.t(
                  "shapes.clipboard.copied",
                  "{count, plural, one {# marcher copied} other {# marchers copied}}",
                  { count: positions.length },
              ),
        // One notice, however often it's copied
        { id: COPIED_TOAST },
    );
    return true;
}

/** Whether Paste can open now: something is copied, and no shape is open and showing */
export const canPaste = (): boolean =>
    copiedPicture() !== null && !isShapeShown();

/**
 * Pastes the copied picture onto the marchers `ids`: opens it as the open shape, centered on
 * them, or where it was copied when `inPlace`. Nobody moves until it's placed. Marchers a loose
 * picture has no dot for are left out, and a message says how many. False when nothing opened.
 */
export function pasteFormation(
    ids: readonly number[],
    { inPlace = false }: { inPlace?: boolean } = {},
): boolean {
    const field = currentShapeField();
    const picture = copiedPicture();
    if (!field || !picture || isShapeShown()) return false;
    const plan = planPaste({
        picture,
        marchers: marchersOnField(field, ids),
        stepPx: field.fieldProperties.pixelsPerStep,
        inPlace,
        asPositions: useCopiedPictureStore.getState().pasteAs === "positions",
    });
    if (!plan) return false;
    // One waiting away from its moment is dismissed, as a new shape started there does (#416)
    const startingOver = useShapeToolStore.getState().tool !== null;
    startOverWaitingShape();
    openShapeTool(
        openDrawn(
            plan.kind,
            plan.marchers,
            plan.params,
            shapeContextFor(field),
            plan.pivotMoved,
        ),
        planCanvasEdit(),
        undefined,
        { keepDiscarded: startingOver },
    );
    if (plan.left > 0)
        toast.message(
            tolgee.t(
                "shapes.clipboard.left",
                "{count, plural, one {# marcher has no spot and stays put} other {# marchers have no spot and stay put}}",
                { count: plan.left },
            ),
            { id: LEFT_TOAST },
        );
    return true;
}
