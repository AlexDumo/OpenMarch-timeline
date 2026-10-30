import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import type { FieldPointer } from "@/field/editor/fieldEditor";
import { NO_KEYS, type HeldKeys } from "@/input/modifierRoles";
import * as platform from "@/shortcuts/platform";
import { boxShape } from "../box/boxShape";
import { drawBox, type BoxParams } from "../box/boxGeometry";
import { boxTool } from "../box/boxTool";
import { setShapeField } from "../field/shapeField";
import { shapeContextFor } from "../field/shapeFieldContext";
import { frameControls } from "../frame/gestures";
import { canReachInside } from "../placed/boxSelection";
import { useBoxSelectionStore } from "../placed/boxSelectionStore";
import { LiveBoxMode } from "../placed/liveBoxMode";
import type { PlacedBox } from "../placed/placedBox";
import * as placedBoxStore from "../placed/placedBoxStore";
import { toolEnvFor } from "../tool/toolEnv";
import type { XY } from "../types";

/**
 * Reach inside ($mod) on a placed box (modifier-roles.md, press choices): a $mod press on a member
 * picks that marcher instead of the box, so the selected box's field mode lets it through to the
 * field editor, which selects the marcher and enters the box. It applies only to members of a box
 * that box selection is on for. Off a Mac here, so $mod is Ctrl.
 */

const fieldProperties =
    FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const STEP = fieldProperties.pixelsPerStep;
/** Away from the field's lines */
const FROM = { x: 30 * STEP + 1, y: 20 * STEP + 1 };

const field = () => ({
    fieldProperties,
    zoom: () => 1,
    marchers: () => [],
    drawn: () => new Map(),
});

const pointer = (at: XY, keys: Partial<HeldKeys> = {}): FieldPointer => ({
    field: at,
    screen: at,
    button: 0,
    ...NO_KEYS,
    ...keys,
});

/** A placed 2 × 2 box, 4 steps apart; marchers 1..4 */
function placed(): PlacedBox<BoxParams> {
    const env = toolEnvFor(field());
    const params = drawBox(
        FROM,
        { x: FROM.x + 4 * STEP, y: FROM.y + 4 * STEP },
        4,
        env,
    )!;
    const slots = boxShape.generate(params, 4, shapeContextFor(field()));
    return {
        recipe: {
            id: 7,
            timelineId: 3,
            kind: "block",
            kindVersion: 1,
            params: { ...params, spots: 4 },
            orderMode: "nearest",
            reverse: false,
            members: slots.map((s, i) => ({
                marcherId: i + 1,
                slot: i,
                x: s.x,
                y: s.y,
            })),
        },
        kind: boxTool,
        params,
        spots: 4,
        endBeat: 8,
    };
}

const box = placed();
const members = new Map(
    box.recipe.members.map((m) => [m.marcherId, { x: m.x, y: m.y }]),
);

beforeEach(() => {
    vi.spyOn(platform, "isMacPlatform").mockReturnValue(false);
    setShapeField({
        fieldProperties: () => fieldProperties,
        zoom: () => 1,
        marchers: () => [],
        drawn: (ids) =>
            new Map(
                ids.flatMap((id) => {
                    const at = members.get(id);
                    return at ? [[id, at] as const] : [];
                }),
            ),
    });
});

afterEach(() => {
    setShapeField(null);
    useBoxSelectionStore.setState({ inside: null, enabled: false });
    vi.restoreAllMocks();
});

describe("the selected box's field mode and reach inside", () => {
    const mode = () => new LiveBoxMode(box, new QueryClient());
    const member = members.get(2)!;

    it("claims a press on a member without $mod: the drag moves the box", () => {
        expect(mode().claims(pointer(member))).toBe(true);
    });

    it("lets a $mod press on a member through to the field editor", () => {
        expect(mode().claims(pointer(member, { ctrl: true }))).toBe(false);
        // Mac Ctrl is no $mod off a Mac either: Ctrl is $mod here, Meta isn't
        expect(mode().claims(pointer(member, { meta: true }))).toBe(true);
    });

    it("still claims a $mod press away from every member: the center dot pulls the pivot out", () => {
        const { center } = frameControls(
            box.kind,
            box.params,
            box.spots,
            toolEnvFor(field()),
        );
        expect(mode().claims(pointer(center, { ctrl: true }))).toBe(true);
    });
});

describe("canReachInside", () => {
    beforeEach(() => {
        vi.spyOn(placedBoxStore, "placedBoxesAt").mockReturnValue([box]);
    });

    it("applies to a member of a placed box while box selection is on", () => {
        useBoxSelectionStore.setState({ enabled: true });
        expect(canReachInside(2)).toBe(true);
        expect(canReachInside(9)).toBe(false);
    });

    it("doesn't apply while box selection is off (Shapes off, playback, the Shape tool open)", () => {
        useBoxSelectionStore.setState({ enabled: false });
        expect(canReachInside(2)).toBe(false);
    });
});
