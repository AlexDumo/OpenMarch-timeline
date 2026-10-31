import { Fragment, useEffect, useId } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CheckIcon } from "@phosphor-icons/react";
import { useTolgee } from "@tolgee/react";
import {
    KEEP_MENU_EVENTS,
    MenuItemWithReason,
    TIMELINE_MENU_CONTENT_CLASS,
    TIMELINE_MENU_ITEM_CLASS,
    TimelineMenuClose,
} from "@/components/timeline/TimelineRangeMenu";
import Keycaps from "@/components/ui/Keycaps";
import type { ToolMenuItem } from "../tool/toolKind";
import { closeHandleMenu, useHandleMenuStore } from "../field/handleMenu";

/** A tick in front of the answer the shape has now; room for one in front of the others */
const Tick = ({ checked }: { checked?: boolean }) =>
    checked === undefined ? null : (
        <span aria-hidden="true" className="inline-flex w-[14px] shrink-0">
            {checked && <CheckIcon size={14} />}
        </span>
    );

/**
 * A shape handle's right-click menu (#569): a Line's point (corner or smooth, roundness, whether
 * a marcher stands on it, delete, close or open the line there) or a segment's middle (add a
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

    const doubleClick = (
        <span className="text-text-subtitle ml-auto pl-16">
            <Keycaps keys={[t("shapes.menu.doubleClick", "Double-click")]} />
        </span>
    );
    const entry = (item: ToolMenuItem) => {
        const testId = `shape-menu-${item.value}`;
        const words = (
            <>
                <Tick checked={item.checked} />
                {item.label}
            </>
        );
        if (item.disabled)
            return (
                <MenuItemWithReason
                    key={item.value}
                    testId={testId}
                    reason={item.disabled}
                    reasonTestId={`${testId}-reason`}
                    checked={item.checked}
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
                className={TIMELINE_MENU_ITEM_CLASS}
            >
                {words}
                {item.doubleClick && doubleClick}
            </DropdownMenu.Item>
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
                                {section.label ? (
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
