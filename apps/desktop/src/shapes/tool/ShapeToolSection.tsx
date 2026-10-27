import clsx from "clsx";
import { SquaresFourIcon } from "@phosphor-icons/react";
import { getButtonClassName } from "@openmarch/ui";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import ActionButton from "@/shortcuts/ActionButton";
import { useShapeToolStore } from "./shapeToolStore";
import { SelectWholeShape } from "../placed/SelectWholeShape";
import { useBoxSelectionStore } from "../placed/boxSelectionStore";

/**
 * The inspector's way into the shape tool for a plain selection: a Box button (also B), and
 * Select box when the selection is part of a placed one. Everything about an open shape or a
 * selected placed one is in its floating editor (#435), so the section hides then.
 */
export function ShapeToolSection() {
    const selected = useSelectedMarchers()?.selectedMarchers ?? [];
    const toolOpen = useShapeToolStore((s) => s.tool !== null);
    const placed = useBoxSelectionStore((s) => s.selected !== null);
    if (selected.length === 0 || toolOpen || placed) return null;
    return (
        <div className="flex flex-col gap-8" data-testid="shape-tool-section">
            <h5 className="text-h5">Shapes</h5>
            <div className="flex flex-wrap gap-8">
                <SelectWholeShape />
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
        </div>
    );
}
