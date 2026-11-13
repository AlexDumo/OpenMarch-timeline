import { Tabs, TabContent, TabItem, TabsList } from "@openmarch/ui";
import { FileTab } from "./tabs/FileTab";
import AlignmentTab from "./tabs/AlignmentTab";
import ShapesTab from "@/shapes/tool/ShapesTab";
import { useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { T, useTranslate } from "@tolgee/react";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import SelectTab from "./tabs/SelectTab";
import WorkspaceViewSwitch from "./WorkspaceViewSwitch";
import View3dButton from "./View3dButton";
import { useIsTouchMode } from "@/stores/InputModeStore";
import { useToolbarTabsSlot } from "@/components/titlebar/toolbarSlot";
import {
    TOOLBAR_TABS,
    type ToolbarTab,
    useToolbarPanelStore,
} from "@/stores/ToolbarPanelStore";

/**
 * Touch layout: each tab's controls are one row that scrolls sideways, so the panel keeps its
 * height whatever the tab shows and never wraps over more of the field.
 */
const touchTabRowClassName =
    "[&>div]:flex-nowrap [&>div]:overflow-x-auto [&>div]:[scrollbar-width:none] [&>div>*]:shrink-0";

const isToolbarTab = (value: string): value is ToolbarTab =>
    TOOLBAR_TABS.includes(value as ToolbarTab);

function ToolbarTabsList({
    tabProps,
}: {
    tabProps?: (
        value: ToolbarTab,
    ) => Omit<React.ComponentProps<typeof TabItem>, "value" | "children">;
}) {
    const props = (value: ToolbarTab) =>
        tabProps ? tabProps(value) : undefined;
    return (
        <TabsList className="gap-0 border-none">
            <TabItem value="file" {...props("file")}>
                <T keyName="inspector.shape.fileTab" />
            </TabItem>
            <TabItem value="alignment" {...props("alignment")}>
                <T keyName="inspector.shape.alignmentTab" />
            </TabItem>
            <TabItem
                value="shapes"
                data-testid="toolbar-shapes-tab"
                {...props("shapes")}
            >
                <T keyName="inspector.shape.shapesTab" />
            </TabItem>
            <TabItem value="select" {...props("select")}>
                <T keyName="inspector.shape.selectTab" />
            </TabItem>
        </TabsList>
    );
}

function ToolbarTabContents({ className }: { className?: string }) {
    return (
        <>
            <TabContent value="file" className={className}>
                <FileTab />
            </TabContent>

            <TabContent value="alignment" className={className}>
                <AlignmentTab />
            </TabContent>

            <TabContent value="shapes" className={className}>
                <ShapesTab />
            </TabContent>

            <TabContent value="select" className={className}>
                <SelectTab />
            </TabContent>
        </>
    );
}

/** The 3D View button and the Editor/Preview switch, at the toolbar's right end */
function ToolbarEnd({ className }: { className?: string }) {
    return (
        <div className={className}>
            {/* Its words go first, then the whole button, so it never covers the tabs at the
                narrowest window (the shortcut and ⌘K still open the 3D View) */}
            <View3dButton
                className="@max-[480px]:hidden"
                labelClassName="@max-[600px]:sr-only"
            />
            <WorkspaceViewSwitch />
        </div>
    );
}

/**
 * Below this window width the title bar can't hold the tabs, the 3D View button and the
 * workspace switch together (iPad portrait), so the last two move into the panel and the tabs
 * keep their room.
 */
const NARROW_TOUCH_QUERY = "(max-width: 900px)";

const subscribeNarrow = (onChange: () => void) => {
    if (typeof window.matchMedia !== "function") return () => {};
    const query = window.matchMedia(NARROW_TOUCH_QUERY);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
};
const isNarrow = () =>
    typeof window.matchMedia === "function" &&
    window.matchMedia(NARROW_TOUCH_QUERY).matches;

export default function Topbar() {
    // In the tablet layout the title bar holds the tabs. Without its slot (it isn't shown),
    // the toolbar keeps the mouse layout
    const isTouch = useIsTouchMode();
    const tabsSlot = useToolbarTabsSlot();
    if (isTouch && tabsSlot) return <TouchToolbar tabsSlot={tabsSlot} />;
    return <MouseToolbar />;
}

function MouseToolbar() {
    const [activeTab, setActiveTab] = useState("alignment");
    // The Collisions tab (CollisionsTab.tsx) is hidden for now, with collision detection
    // unmounted (TimelineResolverHost): the field never drew the markers it reviews.

    return (
        <div className="group @container relative">
            <ToolbarEnd className="absolute top-0 right-0 z-10 flex items-center gap-8" />
            <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex flex-col gap-0 overflow-hidden"
            >
                <ToolbarTabsList />
                <ToolbarTabContents />
            </Tabs>
        </div>
    );
}

/**
 * Tablet layout (ported from upstream #1060): the tab row moves into the title bar, so the
 * top of the screen is one row, and the tab's controls are a panel over the top of the field.
 * Tap a tab to open its panel, tap the open tab or the chevron to close it. The panel takes
 * no layout space, so opening it never resizes the field. The controls inside are the same
 * as the mouse toolbar's and run the same actions.
 */
function TouchToolbar({ tabsSlot }: { tabsSlot: HTMLElement }) {
    const { t } = useTranslate();
    const tab = useToolbarPanelStore((s) => s.tab);
    const open = useToolbarPanelStore((s) => s.open);
    const { setTab, setOpen, pressTab } = useToolbarPanelStore.getState();
    const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);

    // The tab list selects a tab as the press begins, so whether the tapped tab was already
    // open is read then, before the tap ends
    const pressedOpenTab = useRef<boolean | null>(null);
    const isOpenOn = (value: ToolbarTab) => {
        const state = useToolbarPanelStore.getState();
        return state.open && state.tab === value;
    };
    const tabProps = (value: ToolbarTab) => ({
        "aria-expanded": open && tab === value,
        onPointerDown: () => {
            pressedOpenTab.current = isOpenOn(value);
        },
        onClick: () => {
            // A keyboard click (Enter, Space) has no press before it
            pressTab(value, pressedOpenTab.current ?? isOpenOn(value));
            pressedOpenTab.current = null;
        },
    });

    return (
        <Tabs
            value={tab}
            onValueChange={(value) => {
                if (isToolbarTab(value)) setTab(value);
            }}
            // Takes no height: the panel floats over the field
            className="relative h-0 gap-0"
            data-testid="touch-toolbar"
        >
            {createPortal(
                // The whole toolbar row, as on the desktop: the tabs, then the 3D View button and
                // the workspace switch at the end (the field's top right is its display bar's).
                // The tabs come first: they only scroll once nothing else is left beside them
                <div className="@container flex w-full min-w-0 items-center gap-8">
                    <div className="flex max-w-full min-w-0 shrink-0 items-center">
                        <div className="min-w-0 overflow-x-auto [scrollbar-width:none]">
                            <ToolbarTabsList tabProps={tabProps} />
                        </div>
                        <button
                            type="button"
                            aria-expanded={open}
                            aria-controls="toolbar-panel"
                            aria-label={t(
                                open
                                    ? "toolbar.hideControls"
                                    : "toolbar.showControls",
                            )}
                            onClick={() => setOpen(!open)}
                            data-testid="toolbar-panel-toggle"
                            className="hover:text-accent text-text focus-visible:text-accent flex size-44 shrink-0 cursor-pointer items-center justify-center rounded-full outline-hidden duration-150 ease-out"
                        >
                            {open ? (
                                <CaretUpIcon size={18} />
                            ) : (
                                <CaretDownIcon size={18} />
                            )}
                        </button>
                    </div>
                    {!narrow && (
                        <ToolbarEnd className="ml-auto flex min-w-0 shrink-0 items-center gap-8" />
                    )}
                </div>,
                tabsSlot,
            )}
            <div
                id="toolbar-panel"
                data-testid="toolbar-panel"
                hidden={!open}
                className="rounded-6 border-stroke bg-modal backdrop-blur-32 shadow-modal absolute inset-x-0 top-0 z-50 flex items-start gap-8 border p-8"
            >
                <div className="min-w-0 flex-1">
                    <ToolbarTabContents className={touchTabRowClassName} />
                </div>
                {narrow && (
                    <ToolbarEnd className="flex shrink-0 items-center gap-8 self-center" />
                )}
            </div>
        </Tabs>
    );
}
