import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type { FieldModePress, FieldPointer } from "@/field/editor/fieldEditor";
import type { PointerKind } from "@/field/editor/pointerThresholds";
import { NO_KEYS } from "@/input/modifierRoles";
import * as platform from "@/shortcuts/platform";
import { setShapeField } from "../../field/shapeField";
import { lineShape } from "../../line/lineShape";
import { lineSpots, type LineParams } from "../../line/lineGeometry";
import type { XY } from "../../types";
import { LiveBoxMode } from "../liveBoxMode";
import { boxesAt, type PlacedBox, type PlacedRecipe } from "../placedBox";
import { splitShape } from "../splitShape";
import { useSplitPreviewStore } from "../splitPreview";
import { splitCheckAt } from "../useSplitHere";

vi.mock("../commitBox", async (original) => ({
    ...(await original<typeof import("../commitBox")>()),
    commitBox: vi.fn(),
}));
vi.mock("../splitShape", async (original) => ({
    ...(await original<typeof import("../splitShape")>()),
    splitShape: vi.fn(() => Promise.resolve()),
}));

/**
 * Split here on a tablet (#1336): a finger or pen has no hover to show the scissors over a gap of
 * the selected line, so a tap on the gap shows them, they stay, and a tap on them splits there.
 * A mouse keeps its hover.
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const STEP = fieldProperties.pixelsPerStep;
const FROM = { x: 30 * STEP + 1, y: 20 * STEP + 1 };
/** Five marchers ten steps apart along a straight line: gaps wide enough for a finger's scissors */
const TO = { x: FROM.x + 40 * STEP, y: FROM.y };

/** The line, `dy` further down the field */
function placedLine(dy = 0): PlacedBox<LineParams> {
    const params: LineParams = {
        points: [
            { x: FROM.x, y: FROM.y + dy, tension: 0 },
            { x: TO.x, y: TO.y + dy, tension: 0 },
        ],
        spacing: { mode: "fit" },
    };
    const spots = lineSpots(params, 5);
    const recipe: PlacedRecipe = {
        id: 1,
        timelineId: 3,
        kind: lineShape.id,
        kindVersion: lineShape.version,
        params: { ...params, spots: 5 },
        orderMode: "nearest",
        reverse: false,
        members: spots.map((s, slot) => ({
            marcherId: slot + 1,
            slot,
            x: s.x,
            y: s.y,
        })),
    };
    const at = new Map(recipe.members.map((m) => [m.marcherId, m]));
    return boxesAt({
        recipes: [recipe],
        endBeatOf: () => 0,
        beat: 0,
        positionOf: (id) => at.get(id),
    })[0] as PlacedBox<LineParams>;
}

const line = placedLine();
/** Between the second and third marchers, on the line */
const GAP: XY = { x: FROM.x + 15 * STEP, y: FROM.y };

const pointer = (at: XY, kind: PointerKind): FieldPointer => ({
    field: at,
    screen: at,
    button: 0,
    kind,
    ...NO_KEYS,
});
const PRESS: FieldModePress = { reachesInside: () => false, isMac: false };
const CLICK = { double: false };

const shown = () => useSplitPreviewStore.getState().scissors;

/** A tap: press and let go in place, if the mode takes the press */
function tap(mode: LiveBoxMode, p: FieldPointer): boolean {
    if (!mode.claims(p, PRESS)) return false;
    mode.press(p, PRESS);
    mode.release(p, CLICK);
    return true;
}

beforeEach(() => {
    vi.spyOn(platform, "isMacPlatform").mockReturnValue(false);
    setShapeField({
        fieldProperties: () => fieldProperties,
        zoom: () => 1,
        marchers: () => [],
        drawn: (ids) =>
            new Map(
                line.recipe.members
                    .filter((m) => ids.includes(m.marcherId))
                    .map((m) => [m.marcherId, { x: m.x, y: m.y }] as const),
            ),
    });
    useSplitPreviewStore.setState({ gap: null, scissors: null, hot: false });
    vi.mocked(splitShape).mockClear();
});

afterEach(() => {
    setShapeField(null);
    vi.restoreAllMocks();
});

describe("scissors on a tablet", () => {
    it.each(["touch", "pen"] as const)(
        "a %s's tap on a gap shows the scissors, which stay; a tap on them splits there",
        (kind) => {
            const mode = new LiveBoxMode(line, new QueryClient());
            expect(tap(mode, pointer(GAP, kind))).toBe(true);
            const scissors = shown();
            expect(scissors).not.toBeNull();
            // The finger lifting off the field leaves them
            mode.leave();
            expect(shown()).toEqual(scissors);
            expect(tap(mode, pointer(scissors!, kind))).toBe(true);
            expect(splitShape).toHaveBeenCalledTimes(1);
            // Between the second and third marchers: two in the first piece
            expect(vi.mocked(splitShape).mock.calls[0]![1]).toBe(2);
            expect(shown()).toBeNull();
        },
    );

    it("a press anywhere else puts them away, and splits nothing", () => {
        const mode = new LiveBoxMode(line, new QueryClient());
        tap(mode, pointer(GAP, "touch"));
        expect(shown()).not.toBeNull();
        const marcher = line.recipe.members[0]!;
        mode.press(pointer(marcher, "touch"), PRESS);
        expect(shown()).toBeNull();
        mode.release(pointer(marcher, "touch"), CLICK);
        expect(splitShape).not.toHaveBeenCalled();
    });

    it("the shape changed under them (an undo) puts them away", () => {
        const mode = new LiveBoxMode(line, new QueryClient());
        tap(mode, pointer(GAP, "touch"));
        expect(shown()).not.toBeNull();
        const moved = placedLine(5 * STEP);
        mode.setBox(moved);
        expect(shown()).toBeNull();
        // Read again unchanged, they'd have stayed
        tap(mode, pointer({ x: GAP.x, y: GAP.y + 5 * STEP }, "touch"));
        expect(shown()).not.toBeNull();
        mode.setBox(placedLine(5 * STEP));
        expect(shown()).not.toBeNull();
    });

    it("a drag from a gap shows no scissors", () => {
        const mode = new LiveBoxMode(line, new QueryClient());
        const p = pointer(GAP, "touch");
        mode.claims(p, PRESS);
        mode.press(p, PRESS);
        mode.move(pointer({ x: GAP.x, y: GAP.y + 5 * STEP }, "touch"));
        mode.release(pointer({ x: GAP.x, y: GAP.y + 5 * STEP }, "touch"), null);
        expect(shown()).toBeNull();
    });

    it("a mouse's click on a gap is as before: its scissors come with hovering", () => {
        const mode = new LiveBoxMode(line, new QueryClient());
        const p = pointer(GAP, "mouse");
        if (mode.claims(p, PRESS)) {
            mode.press(p, PRESS);
            mode.release(p, CLICK);
        }
        mode.leave();
        expect(shown()).toBeNull();
    });
});

describe("scissors with a mouse", () => {
    it("light up under the pointer, and a click anywhere on the button as drawn splits", () => {
        const mode = new LiveBoxMode(line, new QueryClient());
        mode.cursorAt(pointer(GAP, "mouse"));
        const at = shown()!;
        expect(useSplitPreviewStore.getState().hot).toBe(false);
        // On the ring, past a mouse's 10 px reach but on the 11 px button and its ring
        const rim = pointer({ x: at.x + 12, y: at.y }, "mouse");
        expect(mode.cursorAt(rim)).toBe("pointer");
        expect(useSplitPreviewStore.getState().hot).toBe(true);
        expect(tap(mode, rim)).toBe(true);
        expect(splitShape).toHaveBeenCalledTimes(1);
    });
});

describe("Split here from a long press", () => {
    // 15 px before the third marcher's spot: a mouse's reach (10) doesn't get there, a finger's
    // (22) does, which keeps that marcher in the first piece
    const nearThird = { x: FROM.x + 20 * STEP - 15, y: FROM.y };

    it("judges on a marcher with a finger's reach", () => {
        const touch = splitCheckAt(line, nearThird, "touch");
        expect(touch).toMatchObject({ ok: true, k: 3 });
        const mouse = splitCheckAt(line, nearThird, "mouse");
        expect(mouse).toMatchObject({ ok: true, k: 2 });
    });
});
