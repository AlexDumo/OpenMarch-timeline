import clsx from "clsx";
import { SquaresFourIcon } from "@phosphor-icons/react";
import { getButtonClassName } from "@openmarch/ui";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import ActionButton from "@/shortcuts/ActionButton";
import { useShapeAway, useShapeToolStore } from "./shapeToolStore";
import { momentLabel } from "./shapeMoment";
import { PlacedBoxSection } from "../placed/PlacedBoxSection";
import { usePlacedEditTarget, useToolEditTarget } from "../editor/editTargets";
import { currentShapeField } from "../field/shapeFieldContext";
import { SaveShapeButton } from "../library/SaveShapeButton";
import { ModeSwitch } from "../editor/ModeSwitch";
import { LayoutPicker } from "../editor/LayoutPicker";
import { OutlineGap } from "../editor/OutlineGap";
import { ReshuffleButton } from "../editor/ReshuffleButton";
import { CloseUpButton } from "../editor/CloseUpButton";
import { toolEnvFor } from "./toolEnv";

/** The field's tool environment with no keys held, for a change made from the inspector */
const inspectorEnv = () => {
    const field = currentShapeField();
    return field ? toolEnvFor(field, { shift: false, alt: false }) : null;
};

/**
 * The inspector's way into the shape tool: with marchers selected, a Box button (also B). While
 * the tool is open, what the keys do. With a shape open or a placed one selected, how it is
 * filled (the mode switch, for kinds with more than one mode; the layout picker, for a box in
 * Files; Reshuffle for a spread), Close up for a placed shape with holes, and ☆ Save.
 */
export function ShapeToolSection() {
    const selected = useSelectedMarchers()?.selectedMarchers ?? [];
    const tool = useShapeToolStore((s) => s.tool);
    const moment = useShapeToolStore((s) => s.moment);
    const away = useShapeAway() && moment !== null;
    // The open shape, or the selected placed one, which ☆ Save keeps (#353)
    const open = useToolEditTarget();
    const placed = usePlacedEditTarget();
    const target = tool ? open : placed;
    const field = currentShapeField();
    if (selected.length === 0 && !tool) return null;
    return (
        <div className="flex flex-col gap-8" data-testid="shape-tool-section">
            <h5 className="text-h5">Shapes</h5>
            {tool ? (
                <p className="text-sub text-text/80">
                    {away
                        ? `The shape is open at ${momentLabel(moment)}. Go back to edit or place it.`
                        : tool.params === null
                          ? `Drag on the field to draw a ${tool.kind.shape.label.toLowerCase()}.`
                          : "Drag a handle to resize it, the knob to turn it, or inside to move it. Enter places the marchers, Esc cancels."}
                </p>
            ) : (
                <div className="flex flex-wrap gap-8">
                    <PlacedBoxSection />
                    <ActionButton
                        action="shapeBlock"
                        className={clsx(
                            getButtonClassName({
                                variant: "secondary",
                                size: "compact",
                            }),
                            "flex items-center gap-6",
                        )}
                        data-testid="shape-tool-box"
                    >
                        <SquaresFourIcon size={16} weight="bold" />
                        Box
                    </ActionButton>
                </div>
            )}
            {target && <ModeSwitch target={target} envFor={inspectorEnv} />}
            {target && <LayoutPicker target={target} envFor={inspectorEnv} />}
            {target && <OutlineGap target={target} envFor={inspectorEnv} />}
            {target && (
                <ReshuffleButton
                    target={target}
                    envFor={inspectorEnv}
                    className={clsx(
                        getButtonClassName({
                            variant: "secondary",
                            size: "compact",
                        }),
                        "self-start",
                    )}
                    testId="shape-section-reshuffle"
                />
            )}
            {target && (
                <CloseUpButton
                    target={target}
                    className={clsx(
                        getButtonClassName({
                            variant: "secondary",
                            size: "compact",
                        }),
                        "self-start",
                    )}
                    testId="shape-section-close-up"
                />
            )}
            {target && field && (
                <SaveShapeButton
                    shape={target}
                    stepPx={field.fieldProperties.pixelsPerStep}
                    className={clsx(
                        getButtonClassName({
                            variant: "secondary",
                            size: "compact",
                        }),
                        "self-start",
                    )}
                    testId="shape-section-save"
                />
            )}
        </div>
    );
}
