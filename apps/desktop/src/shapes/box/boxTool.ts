// cspell:words nesw nwse
import { blockKind } from "../kinds/block";
import type { ToolKind } from "../tool/toolKind";
import {
    BOX_HANDLE_KEYS,
    type BoxHandleKey,
    type BoxParams,
    drawBox,
    footprintOf,
    handlePoint,
    insideBox,
    moveBox,
    stretchBox,
} from "./boxGeometry";

const CURSORS: Readonly<Record<BoxHandleKey, string>> = {
    nw: "nwse-resize",
    se: "nwse-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
};

/** The box tool: drawn corner to corner, stretched by its corners and sides, moved from inside */
export const boxTool: ToolKind<BoxParams> = {
    shape: blockKind,
    draw: drawBox,
    handles(params, n) {
        const f = footprintOf(params, n);
        return BOX_HANDLE_KEYS.map((key) => ({
            key,
            at: handlePoint(f, key),
            cursor: CURSORS[key],
        }));
    },
    dragHandle: (base, n, key, to, env) =>
        stretchBox(base, n, key as BoxHandleKey, to, env),
    contains: insideBox,
    move: moveBox,
};
