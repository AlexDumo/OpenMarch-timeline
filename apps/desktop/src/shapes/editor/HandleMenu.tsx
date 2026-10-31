import { Fragment, useEffect, useId, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
    ArrowCounterClockwiseIcon,
    CheckIcon,
    TrashIcon,
} from "@phosphor-icons/react";
import { useTolgee } from "@tolgee/react";
import clsx from "clsx";
import {
    KEEP_MENU_EVENTS,
    MenuItemWithReason,
    TIMELINE_MENU_CONTENT_CLASS,
    TIMELINE_MENU_ITEM_CLASS,
    TimelineMenuClose,
} from "@/components/timeline/TimelineRangeMenu";
import type { ToolMenuItem, ToolMenuSection } from "../tool/toolKind";
import { closeHandleMenu, useHandleMenuStore } from "../field/handleMenu";

/**
 * A tick in front of the answer the shape has now; room for one in front of the others. Soft for
 * an answer the shape's setting gives, in the accent for one set over it (#568).
 */
const Tick = ({ item }: { item: ToolMenuItem }) =>
    item.checked === undefined ? null : (
        <span
            aria-hidden="true"
            data-tick={item.checked ? (item.source ?? "plain") : undefined}
            className={clsx(
                "inline-flex w-[14px] shrink-0",
                item.source === "setting" && "text-text-subtitle opacity-60",
                item.source === "override" && "text-accent",
            )}
        >
            {item.checked && (
                <CheckIcon
                    size={14}
                    weight={item.source === "override" ? "bold" : "regular"}
                />
            )}
        </span>
    );

const ICONS = {
    trash: TrashIcon,
    reset: ArrowCounterClockwiseIcon,
} as const;

/** Corner | Smooth side by side, as the app's segmented switches look (`SegmentedTextSwitch`) */
const SEGMENTS_CLASS =
    "bg-fg-1 border-stroke mx-4 flex gap-2 rounded-full border p-2 shadow-inner";
const SEGMENT_CLASS = clsx(
    "text-text-subtitle flex flex-1 cursor-default items-center justify-center rounded-full border border-transparent px-12 py-2 text-[12px] outline-hidden select-none",
    "transition-colors duration-150 ease-out",
    "data-[highlighted]:text-accent data-[highlighted]:ring-accent data-[highlighted]:ring-1",
    "data-[state=checked]:bg-fg-2 data-[state=checked]:text-text data-[state=checked]:border-accent",
    "data-[disabled]:opacity-50",
);

/**
 * A shape handle's right-click menu (#569, look #568): a Line's point (its corner type as a
 * Corner | Smooth either/or with roundness under it, whether a marcher stands on it as the line's
 * setting or an override of it, delete, close or open the line there) or a segment's middle (add a
 * point, straight or curved). Opened by the shape modes (`openHandleMenu`), at the right-click, a
 * Mac's Ctrl-click or a long press; each entry is one change of the shape. The field's shape mode
 * changing closes it (`useShapeFieldModes`).
 */
export default function HandleMenu() {
    const { t } = useTolgee();
    const menu = useHandleMenuStore((s) => s.menu);
    const labelId = useId();
    // The context-menu key and a Mac's Ctrl-click also fire the browser's own menu
    useEffect(() => {
        if (!menu) return;
        const block = (event: Event) => event.preventDefault();
        document.addEventListener("contextmenu", block, true);
        return () => document.removeEventListener("contextmenu", block, true);
    }, [menu]);
    if (!menu) return null;

    const entry = (item: ToolMenuItem) => {
        const testId = `shape-menu-${item.value}`;
        const Icon = item.icon ? ICONS[item.icon] : null;
        const words = (
            <>
                <Tick item={item} />
                {Icon && (
                    <span
                        aria-hidden="true"
                        className="inline-flex w-[14px] shrink-0"
                    >
                        <Icon size={14} />
                    </span>
                )}
                {item.label}
                {item.checked && item.source === "setting" && item.note && (
                    <span
                        data-testid={`${testId}-note`}
                        className="text-text-subtitle text-[11px]"
                    >
                        {item.note}
                    </span>
                )}
                {item.checked && item.source === "override" && (
                    <span
                        data-testid={`${testId}-override`}
                        className="bg-accent/15 text-accent rounded-4 ml-auto px-4 py-[1px] text-[10px] font-medium"
                    >
                        {t("shapes.menu.override", "Override")}
                    </span>
                )}
            </>
        );
        const className = clsx(
            TIMELINE_MENU_ITEM_CLASS,
            item.destructive && "data-[highlighted]:text-red",
        );
        if (item.disabled)
            return (
                <MenuItemWithReason
                    key={item.value}
                    testId={testId}
                    reason={item.disabled}
                    reasonTestId={`${testId}-reason`}
                    checked={item.checked}
                    className={className}
                    onSelect={() => {}}
                >
                    {words}
                </MenuItemWithReason>
            );
        return (
            <DropdownMenu.Item
                key={item.value}
                data-testid={testId}
                // An answer reads as one, with whether it's the shape's now
                {...(item.checked === undefined
                    ? {}
                    : {
                          role: "menuitemradio",
                          "aria-checked": item.checked,
                      })}
                onSelect={() => menu.pick(item.value)}
                className={className}
            >
                {words}
            </DropdownMenu.Item>
        );
    };

    /**
     * An either/or side by side, its answers a radio group the menu's keys reach; picking one
     * keeps the menu open, so the change shows. Its other entries list under the hint.
     */
    const segmented = (section: ToolMenuSection, id: string): ReactNode => {
        const answers = section.items.filter((i) => i.checked !== undefined);
        const others = section.items.filter((i) => i.checked === undefined);
        const hintId = `${id}-hint`;
        return (
            <>
                <DropdownMenu.RadioGroup
                    aria-labelledby={id}
                    aria-describedby={section.hint ? hintId : undefined}
                    value={answers.find((i) => i.checked)?.value}
                    className={SEGMENTS_CLASS}
                >
                    {answers.map((item) => (
                        <DropdownMenu.RadioItem
                            key={item.value}
                            value={item.value}
                            data-testid={`shape-menu-${item.value}`}
                            disabled={item.disabled !== undefined}
                            onSelect={(event) => {
                                event.preventDefault();
                                if (!item.checked) menu.pick(item.value);
                            }}
                            className={SEGMENT_CLASS}
                        >
                            {item.label}
                        </DropdownMenu.RadioItem>
                    ))}
                </DropdownMenu.RadioGroup>
                {section.hint && (
                    <p
                        id={hintId}
                        data-testid="shape-menu-hint"
                        className="text-text-subtitle px-8 text-[11px]"
                    >
                        {section.hint}
                    </p>
                )}
                {others.map(entry)}
            </>
        );
    };

    return (
        <DropdownMenu.Root
            open
            onOpenChange={(next) => {
                if (!next) closeHandleMenu();
            }}
        >
            <DropdownMenu.Trigger asChild>
                <div
                    data-testid="shape-menu-anchor"
                    aria-hidden
                    className="pointer-events-none absolute h-0 w-0"
                    style={{ left: menu.at.x, top: menu.at.y }}
                />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    data-testid="shape-menu"
                    data-handle={menu.key}
                    align="start"
                    side="bottom"
                    collisionPadding={8}
                    // The anchor is a hidden div: focus falls to the page, and the field's keys
                    // still work
                    onCloseAutoFocus={(event) => event.preventDefault()}
                    {...KEEP_MENU_EVENTS}
                    className={TIMELINE_MENU_CONTENT_CLASS}
                >
                    {/* An open reason tip gets Escape first: this closes the menu with it */}
                    <TimelineMenuClose.Provider value={closeHandleMenu}>
                        {menu.sections.map((section, i) => (
                            <Fragment key={section.items[0]?.value ?? i}>
                                {i > 0 && (
                                    <DropdownMenu.Separator className="bg-stroke mx-4 h-px" />
                                )}
                                {section.look === "segmented" ? (
                                    <div className="flex flex-col gap-4">
                                        {section.label && (
                                            <DropdownMenu.Label
                                                id={`${labelId}-${i}`}
                                                className="text-text-subtitle px-8 pt-4 text-[11px]"
                                            >
                                                {section.label}
                                            </DropdownMenu.Label>
                                        )}
                                        {segmented(section, `${labelId}-${i}`)}
                                    </div>
                                ) : section.label ? (
                                    // A labelled section's answers are read as one set, by its name
                                    <DropdownMenu.Group
                                        aria-labelledby={`${labelId}-${i}`}
                                    >
                                        <DropdownMenu.Label
                                            id={`${labelId}-${i}`}
                                            className="text-text-subtitle px-8 pt-4 text-[11px]"
                                        >
                                            {section.label}
                                        </DropdownMenu.Label>
                                        {section.items.map(entry)}
                                    </DropdownMenu.Group>
                                ) : (
                                    section.items.map(entry)
                                )}
                            </Fragment>
                        ))}
                    </TimelineMenuClose.Provider>
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}
