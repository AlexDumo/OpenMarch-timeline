import clsx from "clsx";
import { useMemo } from "react";
import { performersOnly } from "@/global/classes/Marcher";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import ActionButton from "@/shortcuts/ActionButton";
import ToolbarSection from "@/components/toolbar/ToolbarSection";
import { kindPickGate } from "./pickKind";
import { SHAPE_TOOLS } from "./shapeTools";
import { useShapeToolStore } from "./shapeToolStore";

/**
 * The top bar's Shapes tab (#348), the quick pick: every kind that can be drawn, with its icon and
 * name. A kind's button runs its action, which goes through the host's `pickShapeKind`: it arms
 * the kind, or turns the open shape into it. With nobody selected the kinds are greyed out and
 * say why. Starred shapes and the Library button join after a divider once the library exists
 * (#351).
 */
export default function ShapesTab() {
    const selected = useSelectedMarchers()?.selectedMarchers;
    const performers = useMemo(
        () => performersOnly(selected ?? []),
        [selected],
    );
    const armed = useShapeToolStore((s) => s.tool?.kind ?? null);
    const gate = kindPickGate(armed !== null, performers);
    return (
        <div className="flex w-full flex-wrap items-center gap-8">
            <ToolbarSection aria-label="Shape kinds">
                {SHAPE_TOOLS.map(({ kind, action }) => {
                    const Icon = kind.shape.icon;
                    const on = kind === armed;
                    return (
                        // A disabled button gets no hover, so its reason sits on the wrapper
                        <span
                            key={kind.shape.id}
                            title={gate.ok ? undefined : gate.reason}
                        >
                            <ActionButton
                                action={action}
                                disabled={!gate.ok}
                                aria-pressed={on}
                                data-testid={`shapes-tab-${kind.shape.id}`}
                                className={clsx(
                                    "flex items-center gap-6",
                                    on ? "text-accent" : "text-text",
                                )}
                            >
                                <Icon
                                    size={22}
                                    weight={on ? "bold" : "regular"}
                                />
                                {kind.shape.label}
                            </ActionButton>
                        </span>
                    );
                })}
            </ToolbarSection>
            {!gate.ok && (
                <span
                    className="text-sub text-text-subtitle"
                    data-testid="shapes-tab-reason"
                >
                    {gate.reason}
                </span>
            )}
        </div>
    );
}
