import type { ReactNode } from "react";
import {
    ArrowUpRightIcon,
    CircleIcon,
    CursorIcon,
    DiamondIcon,
    EraserIcon,
    HandIcon,
    ImageIcon,
    LineSegmentIcon,
    LockSimpleIcon,
    LockSimpleOpenIcon,
    NoteBlankIcon,
    PencilSimpleIcon,
    SquareIcon,
    TextTIcon,
} from "@phosphor-icons/react";
import { Panel, PanelButton, PanelSeparator } from "./ui";

/** Excalidraw's tools we show, plus our sticky note */
export type ToolId =
    | "hand"
    | "selection"
    | "rectangle"
    | "diamond"
    | "ellipse"
    | "arrow"
    | "line"
    | "freedraw"
    | "text"
    | "image"
    | "eraser"
    | "sticky";

export interface ToolDef {
    id: ToolId;
    label: string;
    /** The key shown on the button; Excalidraw handles its own keys, we handle S */
    shortcut: string;
    icon: ReactNode;
}

const ICON = 18;

export const TOOLS: ToolDef[] = [
    {
        id: "hand",
        label: "Hand (pan)",
        shortcut: "H",
        icon: <HandIcon size={ICON} />,
    },
    {
        id: "selection",
        label: "Select",
        shortcut: "1",
        icon: <CursorIcon size={ICON} />,
    },
    {
        id: "rectangle",
        label: "Rectangle",
        shortcut: "2",
        icon: <SquareIcon size={ICON} />,
    },
    {
        id: "diamond",
        label: "Diamond",
        shortcut: "3",
        icon: <DiamondIcon size={ICON} />,
    },
    {
        id: "ellipse",
        label: "Ellipse",
        shortcut: "4",
        icon: <CircleIcon size={ICON} />,
    },
    {
        id: "arrow",
        label: "Arrow",
        shortcut: "5",
        icon: <ArrowUpRightIcon size={ICON} />,
    },
    {
        id: "line",
        label: "Line",
        shortcut: "6",
        icon: <LineSegmentIcon size={ICON} />,
    },
    {
        id: "freedraw",
        label: "Free draw",
        shortcut: "7",
        icon: <PencilSimpleIcon size={ICON} />,
    },
    {
        id: "text",
        label: "Text",
        shortcut: "8",
        icon: <TextTIcon size={ICON} />,
    },
    {
        id: "image",
        label: "Image",
        shortcut: "9",
        icon: <ImageIcon size={ICON} />,
    },
    {
        id: "eraser",
        label: "Eraser",
        shortcut: "0",
        icon: <EraserIcon size={ICON} />,
    },
    {
        id: "sticky",
        label: "Sticky note",
        shortcut: "S",
        icon: <NoteBlankIcon size={ICON} />,
    },
];

/** Long names with the letter keys, for tooltips */
const KEYS: Record<ToolId, string> = {
    hand: "H",
    selection: "V or 1",
    rectangle: "R or 2",
    diamond: "D or 3",
    ellipse: "O or 4",
    arrow: "A or 5",
    line: "L or 6",
    freedraw: "P or 7",
    text: "T or 8",
    image: "9",
    eraser: "E or 0",
    sticky: "S",
};

export function Toolbar({
    active,
    locked,
    onTool,
    onToggleLock,
}: {
    active: ToolId;
    locked: boolean;
    onTool: (tool: ToolId) => void;
    onToggleLock: () => void;
}) {
    return (
        <Panel
            label="Tools"
            testId="sketch-toolbar"
            className="flex items-center gap-2 p-4"
        >
            <PanelButton
                pressed={locked}
                onClick={onToggleLock}
                label="Keep tool after drawing"
                title="Keep the tool after drawing (Q)"
                shortcut="Q"
                testId="tool-lock"
            >
                {locked ? (
                    <LockSimpleIcon size={ICON} />
                ) : (
                    <LockSimpleOpenIcon size={ICON} />
                )}
            </PanelButton>
            <PanelSeparator />
            {TOOLS.map((tool) => (
                <span key={tool.id} className="contents">
                    {tool.id === "sticky" && <PanelSeparator />}
                    <PanelButton
                        pressed={active === tool.id}
                        onClick={() => onTool(tool.id)}
                        label={tool.label}
                        title={`${tool.label} (${KEYS[tool.id]})`}
                        shortcut={tool.shortcut}
                        testId={`tool-${tool.id}`}
                    >
                        {tool.icon}
                    </PanelButton>
                </span>
            ))}
        </Panel>
    );
}
