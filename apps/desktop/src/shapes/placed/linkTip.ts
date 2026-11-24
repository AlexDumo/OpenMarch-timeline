import tolgee from "@/global/singletons/Tolgee";
import type { FieldModeDrawing } from "@/field/editor/fieldEditor";
import type { XY } from "../types";

/**
 * What the readout by the pointer says about linking while a placed Line, Curve or Arc is dragged
 * (#1235): with an end in reach of another shape's end, that letting go links them (`release`,
 * the readout's numbers left out); while an end that could link is dragged with a free end to go
 * to on its move, where to drop it (`drop`, after the numbers). While a Line or Curve is drawn by
 * clicking points, with the pointer in reach of another shape's end, that a click there links them
 * (`click`, the numbers left out).
 */
export type LinkTip =
    | { readonly kind: "release" | "click"; readonly shape: string }
    | { readonly kind: "drop" };

/** The words of `tip` */
export const linkTipText = (tip: LinkTip): string =>
    tip.kind === "release"
        ? tolgee.t("shapes.links.releaseTip", "Release to link to {shape}", {
              shape: tip.shape,
          })
        : tip.kind === "click"
          ? tolgee.t("shapes.links.clickTip", "Click to link to {shape}", {
                shape: tip.shape,
            })
          : tolgee.t(
                "shapes.links.dropTip",
                "Drop on another shape's end to link",
            );

/** `drawing`'s pointer readout with `tip` in it, at `pointer` */
export function linkDragTip<T extends Pick<FieldModeDrawing, "tip">>(
    drawing: T,
    pointer: XY | null,
    tip: LinkTip | null,
): T {
    if (!tip || !pointer) return drawing;
    const text = linkTipText(tip);
    const was = drawing.tip?.text;
    return {
        ...drawing,
        tip: {
            at: drawing.tip?.at ?? pointer,
            text: tip.kind === "drop" && was ? `${was} · ${text}` : text,
        },
    };
}
