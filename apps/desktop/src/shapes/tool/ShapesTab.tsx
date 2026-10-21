import clsx from "clsx";
import { useMemo } from "react";
import { ShapesIcon } from "@phosphor-icons/react";
import { performersOnly } from "@/global/classes/Marcher";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import ActionButton from "@/shortcuts/ActionButton";
import { getActionShortcutLabel } from "@/shortcuts/labels";
import { useShortcutOverridesStore } from "@/stores/ShortcutOverridesStore";
import ToolbarSection from "@/components/toolbar/ToolbarSection";
import { showShapeLibrary } from "../library/ShapeLibraryPanel";
import { kindPickGate, pickShapeKind } from "./pickKind";
import { SHAPE_TOOLS } from "./shapeTools";
import { useShapeToolStore } from "./shapeToolStore";
import { useStarredShapes } from "./starredShapes";

const BUTTON =
    "enabled:hover:text-accent text-text flex items-center gap-6 outline-hidden duration-150 ease-out focus-visible:-translate-y-4 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The top bar's Shapes tab (#348), the quick pick: every kind that can be drawn, with its icon and
 * name. A kind's button runs its action, which goes through the host's `pickShapeKind`: it arms
 * the kind, or turns the open shape into it. With nobody selected the kinds are greyed out and
 * say why. After a divider come the starred shapes (#352), picked the same way, and the Library
 * button, which opens the shape library in the left sidebar.
 */
export default function ShapesTab() {
    const selected = useSelectedMarchers()?.selectedMarchers;
    const performers = useMemo(
        () => performersOnly(selected ?? []),
        [selected],
    );
    const armed = useShapeToolStore((s) => s.tool?.kind ?? null);
    const gate = kindPickGate(armed !== null, performers);
    const overrides = useShortcutOverridesStore((s) => s.overrides);
    const ringKey = getActionShortcutLabel("openShapeRing", { overrides });
    const starred = useStarredShapes();
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
                <span
                    aria-hidden
                    className="bg-stroke h-20 w-px"
                    data-testid="shapes-tab-divider"
                />
                {starred.map((shape) => {
                    const Icon = shape.icon;
                    return (
                        <span
                            key={shape.id}
                            title={gate.ok ? undefined : gate.reason}
                        >
                            <button
                                type="button"
                                disabled={!gate.ok}
                                onClick={() =>
                                    pickShapeKind(shape.kind, performers)
                                }
                                title={gate.ok ? shape.label : undefined}
                                className={BUTTON}
                                data-testid={`shapes-tab-starred-${shape.id}`}
                            >
                                <Icon size={22} />
                                {shape.label}
                            </button>
                        </span>
                    );
                })}
                <button
                    type="button"
                    onClick={showShapeLibrary}
                    title="Open the shape library, to star shapes"
                    className={BUTTON}
                    data-testid="shapes-tab-library"
                >
                    <ShapesIcon size={22} />
                    Library
                </button>
            </ToolbarSection>
            {/* The ring has no button, so the tab says how to open it (sims, ring round 1) */}
            {ringKey && (
                <span
                    className="text-sub text-text-subtitle"
                    data-testid="shapes-tab-ring-hint"
                >
                    Hold {ringKey} on the field for the shape ring
                </span>
            )}
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
