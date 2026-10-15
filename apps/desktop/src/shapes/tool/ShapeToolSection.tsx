import clsx from "clsx";
import { SquaresFourIcon } from "@phosphor-icons/react";
import { getButtonClassName } from "@openmarch/ui";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import ActionButton from "@/shortcuts/ActionButton";
import { useShapeToolStore } from "./shapeToolStore";
import { PlacedBoxSection } from "../placed/PlacedBoxSection";

/**
 * The inspector's way into the shape tool: with marchers selected, a Box button (also B). While
 * the tool is open, what the keys do.
 */
export function ShapeToolSection() {
    const selected = useSelectedMarchers()?.selectedMarchers ?? [];
    const tool = useShapeToolStore((s) => s.tool);
    if (selected.length === 0 && !tool) return null;
    return (
        <div className="flex flex-col gap-8" data-testid="shape-tool-section">
            <h5 className="text-h5">Shapes</h5>
            {tool ? (
                <p className="text-sub text-text/80">
                    {tool.params === null
                        ? "Drag on the field to draw a box."
                        : "Drag a corner or side to stretch it, or inside to move it. Enter places the marchers, Esc cancels."}
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
        </div>
    );
}
