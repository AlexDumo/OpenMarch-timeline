import { LassoIcon, SelectionIcon, type Icon } from "@phosphor-icons/react";
import { useTranslate } from "@tolgee/react";
import clsx from "clsx";
import { ShortcutTooltip } from "@/components/timeline/ShortcutTooltip";
import {
    useFieldSelectToolStore,
    type FieldSelectTool,
} from "@/field/fieldSelectTool";
import { DISPLAY_BUTTON_CLASS } from "./displayButton";

const TOOLS: readonly {
    tool: FieldSelectTool;
    icon: Icon;
    labelKey: string;
    hintKey: string;
}[] = [
    {
        tool: "box",
        icon: SelectionIcon,
        labelKey: "fieldSelectTool.box",
        hintKey: "fieldSelectTool.boxHint",
    },
    {
        tool: "lasso",
        icon: LassoIcon,
        labelKey: "fieldSelectTool.lasso",
        hintKey: "fieldSelectTool.lassoHint",
    },
];

/**
 * Box or Lasso: what a mouse drag from empty field draws (`fieldSelectTool.ts`), above the
 * display bar at the field's top right. The picked one stays until the other is; the shortcut
 * switches between them, and each tooltip shows it. Before this bar a lasso was only a
 * double-click and drag away, which nobody found; that still works with Box.
 */
export default function SelectToolBar({ className }: { className?: string }) {
    const { t } = useTranslate();
    const current = useFieldSelectToolStore((s) => s.tool);
    const setTool = useFieldSelectToolStore((s) => s.setTool);
    return (
        <div
            role="group"
            aria-label={t("fieldSelectTool.label")}
            data-testid="field-select-tool"
            className={className}
        >
            {TOOLS.map(({ tool, icon: IconComponent, labelKey, hintKey }) => {
                const on = tool === current;
                return (
                    <ShortcutTooltip
                        key={tool}
                        label={t(labelKey)}
                        action="toggleLassoSelect"
                        hint={t(hintKey)}
                        side="left"
                    >
                        <button
                            type="button"
                            aria-label={t(labelKey)}
                            aria-pressed={on}
                            data-testid={`field-select-tool-${tool}`}
                            onClick={() => setTool(tool)}
                            className={clsx(
                                DISPLAY_BUTTON_CLASS,
                                on ? "bg-accent/10 text-accent" : "text-text",
                            )}
                        >
                            <IconComponent
                                size={16}
                                weight={on ? "bold" : "regular"}
                            />
                        </button>
                    </ShortcutTooltip>
                );
            })}
        </div>
    );
}
