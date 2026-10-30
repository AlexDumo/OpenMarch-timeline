import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import {
    FieldEditor,
    type DropResult,
    type FieldModePress,
    type FieldPoint,
    type FieldPointer,
} from "@/field/editor/fieldEditor";
import type { MarcherPosition } from "@/field/editor/moveGesture";
import { ruledMove } from "@/field/editor/moveRules";
import { NO_KEYS, type HeldKeys } from "@/input/modifierRoles";
import * as platform from "@/shortcuts/platform";
import { boxShape } from "../box/boxShape";
import { drawBox, type BoxParams } from "../box/boxGeometry";
import { boxTool } from "../box/boxTool";
import { setShapeField } from "../field/shapeField";
import { shapeContextFor } from "../field/shapeFieldContext";
import { frameControls } from "../frame/gestures";
import {
    boxPressSelection,
    canReachInside,
    enterBox,
} from "../placed/boxSelection";
import { useBoxSelectionStore } from "../placed/boxSelectionStore";
import { commitBox } from "../placed/commitBox";
import { LiveBoxMode } from "../placed/liveBoxMode";
import type { PlacedBox } from "../placed/placedBox";
import * as placedBoxStore from "../placed/placedBoxStore";
import { toolEnvFor } from "../tool/toolEnv";
import type { XY } from "../types";

vi.mock("../placed/commitBox", () => ({ commitBox: vi.fn() }));

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

/**
 * A placed box, 4 steps apart: 2 × 2 (marchers 1..4, each under a corner handle), or 5 × 3 (1..15
 * from the back left, file by file across: 8 stands on the center dot, and 7 and 9 beside it on no
 * handle)
 */
function placed(n: 4 | 15 = 4): PlacedBox<BoxParams> {
    const env = toolEnvFor(field());
    const size = n === 4 ? { x: 4, y: 4 } : { x: 16, y: 8 };
    const params = drawBox(
        FROM,
        { x: FROM.x + size.x * STEP, y: FROM.y + size.y * STEP },
        n,
        env,
    )!;
    const slots = boxShape.generate(params, n, shapeContextFor(field()));
    return {
        recipe: {
            id: n === 4 ? 7 : 8,
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
        spots: n,
        endBeat: 8,
    };
}

const box = placed();
const membersOf = (b: PlacedBox) =>
    new Map(b.recipe.members.map((m) => [m.marcherId, { x: m.x, y: m.y }]));
let members = membersOf(box);

/** What the field editor tells a mode of a press: the marcher its hit test finds there */
const editorSees = (hit: number | null, isMac = false): FieldModePress => ({
    marcherAt: () => hit,
    isMac,
});

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
    members = membersOf(box);
    setShapeField(null);
    useBoxSelectionStore.setState({ inside: null, enabled: false });
    vi.restoreAllMocks();
});

const bigMode = (b: PlacedBox) => new LiveBoxMode(b, new QueryClient());

describe("the selected box's field mode and reach inside", () => {
    const mode = () => new LiveBoxMode(box, new QueryClient());
    // Marcher 2 is the back-right corner: the ne handle sits on it
    const member = members.get(2)!;

    it("claims a press on a member without $mod: the drag moves the box", () => {
        expect(mode().claims(pointer(member), editorSees(2))).toBe(true);
    });

    it("lets a $mod press on a member through to the field editor, away from the box's controls", () => {
        const big = placed(15);
        members = membersOf(big);
        const beside = bigMode(big).claims(
            pointer(members.get(7)!, { ctrl: true }),
            editorSees(7),
        );
        expect(beside).toBe(false);
        // Mac Ctrl is no $mod off a Mac: Ctrl is $mod here, Meta isn't
        expect(
            bigMode(big).claims(
                pointer(members.get(7)!, { meta: true }),
                editorSees(7),
            ),
        ).toBe(true);
    });

    it("keeps a $mod press on a handle, over its marcher: $mod is constrain there, for an equal-spaced resize", () => {
        expect(
            mode().claims(pointer(member, { ctrl: true }), editorSees(2)),
        ).toBe(true);
    });

    it("keeps a $mod press on the pivot drawn over a member: the center dot pulls the pivot out", () => {
        const big = placed(15);
        members = membersOf(big);
        expect(
            bigMode(big).claims(
                pointer(members.get(8)!, { ctrl: true }),
                editorSees(8),
            ),
        ).toBe(true);
    });

    it("still claims a $mod press away from every member: the center dot pulls the pivot out", () => {
        const { center } = frameControls(
            box.kind,
            box.params,
            box.spots,
            toolEnvFor(field()),
        );
        expect(
            mode().claims(pointer(center, { ctrl: true }), editorSees(null)),
        ).toBe(true);
    });

    it("asks the field editor's hit test which marcher is under the press", () => {
        const big = placed(15);
        members = membersOf(big);
        const beside = pointer(members.get(7)!, { ctrl: true });
        // Hidden or dimmed there: the editor finds no marcher, so the press is the box's
        expect(bigMode(big).claims(beside, editorSees(null))).toBe(true);
        // A marcher in no box drawn over it is nearer: the editor's, not this box's
        expect(bigMode(big).claims(beside, editorSees(42))).toBe(true);
    });

    it("lays the 5 × 3 box out as these tests read it", () => {
        const big = placed(15);
        const at = membersOf(big);
        const { center } = frameControls(
            big.kind,
            big.params,
            big.spots,
            toolEnvFor(field()),
        );
        expect(at.get(8)!.x).toBeCloseTo(center.x);
        expect(at.get(8)!.y).toBeCloseTo(center.y);
        expect(at.get(7)!.y).toBeCloseTo(center.y);
        expect(at.get(7)!.x).toBeCloseTo(center.x - 4 * STEP);
    });

    it("reads $mod as the field editor does: Cmd on a Mac", () => {
        const big = placed(15);
        members = membersOf(big);
        const beside = members.get(7)!;
        expect(
            bigMode(big).claims(
                pointer(beside, { meta: true }),
                editorSees(7, true),
            ),
        ).toBe(false);
        expect(
            bigMode(big).claims(
                pointer(beside, { ctrl: true }),
                editorSees(7, true),
            ),
        ).toBe(true);
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

    it("boxPressSelection with reachInside goes inside the box and leaves the pick to the editor", () => {
        useBoxSelectionStore.setState({ enabled: true });
        expect(boxPressSelection(2, false, [], true)).toBeNull();
        expect(useBoxSelectionStore.getState().inside).toBe(7);
        // Without it, a press on a member selects the whole box
        useBoxSelectionStore.setState({ inside: null });
        expect(boxPressSelection(2, false, [], false)).toEqual([1, 2, 3, 4]);
    });

    it("doesn't apply inside the box already: a click there picks one marcher anyway", () => {
        useBoxSelectionStore.setState({ enabled: true, inside: 7 });
        expect(canReachInside(2)).toBe(false);
        useBoxSelectionStore.setState({ inside: 12 });
        expect(canReachInside(2)).toBe(true);
    });
});

/**
 * The field editor with the app's box ports (`ThreeField`): `boxPressSelection` and
 * `canReachInside` over the 2 × 2 box (marchers 1..4), and marcher 9 loose, 8 steps right of it.
 * The selected box's field mode is on while the whole box is selected, as `useShapeFieldModes`
 * puts it.
 */
describe("reaching inside through the field editor", () => {
    const LOOSE = { x: FROM.x + 12 * STEP, y: FROM.y };
    let running: FieldEditor | undefined;

    beforeEach(() => {
        vi.spyOn(placedBoxStore, "placedBoxesAt").mockReturnValue([box]);
        useBoxSelectionStore.setState({ enabled: true, inside: null });
        vi.mocked(commitBox).mockClear();
    });

    afterEach(() => running?.pointerCancel());

    function app({ selected = [] as number[] } = {}) {
        const state = {
            selected: [...selected] as readonly number[],
            drops: [] as (readonly MarcherPosition[])[],
            shown: null as ReadonlyMap<number, FieldPoint> | null,
        };
        const drawn = [...members.entries(), [9, LOOSE] as const];
        const editor = new FieldEditor(
            {
                selection: {
                    get: () => state.selected,
                    set: (ids) => {
                        state.selected = ids;
                        syncMode();
                    },
                },
                marchers: () => ({
                    ids: drawn.map(([id]) => id),
                    positions: Float64Array.from(
                        drawn.flatMap(([, at]) => [at.x, at.y]),
                    ),
                }),
                zoom: () => 1,
                canSelect: () => true,
                // The selection box's handles sit off the marchers, as on the field
                selectionBoxPadding: () => STEP,
                pressSelection: (hit, shift, reachInside) =>
                    boxPressSelection(hit, shift, state.selected, reachInside),
                reachesInside: canReachInside,
                doubleClickMarcher: enterBox,
                showPositions: (positions) => {
                    state.shown = positions;
                },
                drop: (positions) => {
                    state.drops.push(positions);
                    return new Promise<DropResult>(() => {});
                },
            },
            { isMac: false, moveTransform: ruledMove(() => RULES) },
        );
        const whole = new LiveBoxMode(box, new QueryClient());
        function syncMode() {
            const all = [...members.keys()].every((id) =>
                state.selected.includes(id),
            );
            editor.setMode(all && state.selected.length === 4 ? whole : null);
        }
        syncMode();
        running = editor;
        return { editor, state };
    }

    const RULES = {
        rounding: undefined,
        lockX: false,
        lockY: false,
        grid: {
            pixelsPerStep: STEP,
            centerFrontPoint: { xPixels: 0, yPixels: 0 },
        },
    };

    const press = (editor: FieldEditor, at: XY, keys: Partial<HeldKeys>) =>
        editor.pointerDown(pointer(at, keys));
    const click = (editor: FieldEditor, at: XY, keys: Partial<HeldKeys>) => {
        press(editor, at, keys);
        editor.pointerUp(pointer(at, keys));
    };
    const drag = (
        editor: FieldEditor,
        from: XY,
        by: XY,
        keys: Partial<HeldKeys>,
    ) => {
        const to = { x: from.x + by.x, y: from.y + by.y };
        press(editor, from, keys);
        editor.pointerMove(
            pointer({ x: from.x + by.x / 2, y: from.y + by.y / 2 }, keys),
        );
        editor.pointerMove(pointer(to, keys));
        editor.pointerUp(pointer(to, keys));
    };
    const BY = { x: 37, y: 21 };
    const m = (id: number) => members.get(id)!;

    it("picks just the marcher a $mod-click lands on and goes inside its box", () => {
        const { editor, state } = app();
        click(editor, m(3), { ctrl: true });
        expect(state.selected).toEqual([3]);
        expect(useBoxSelectionStore.getState().inside).toBe(7);
    });

    it("inside the box, a $mod drag on a member is constrained to one axis from the start", () => {
        const { editor, state } = app();
        click(editor, m(3), { ctrl: true });
        drag(editor, m(4), BY, { ctrl: true });
        expect(state.selected).toEqual([4]);
        expect(state.drops[0]).toEqual([
            { id: 4, x: m(4).x + BY.x, y: m(4).y },
        ]);
    });

    it("toggles a member with Shift+$mod, from outside the box and inside it", () => {
        const { editor, state } = app({ selected: [9] });
        click(editor, m(1), { shift: true, ctrl: true });
        expect(state.selected).toEqual([9, 1]);
        expect(useBoxSelectionStore.getState().inside).toBe(7);
        click(editor, m(2), { shift: true, ctrl: true });
        expect(state.selected).toEqual([9, 1, 2]);
        click(editor, m(1), { shift: true, ctrl: true });
        expect(state.selected).toEqual([9, 2]);
    });

    it("adds an unselected member with a Shift+$mod drag and moves the selection, as a Shift drag inside the box does", () => {
        const moved = (id: number, by: XY) => ({
            id,
            x: m(id).x + by.x,
            y: m(id).y + by.y,
        });
        // Inside the box Shift adds, and $mod is no press choice: constrain from the start
        useBoxSelectionStore.setState({ inside: 7 });
        const inside = app({ selected: [1] });
        drag(inside.editor, m(2), BY, { shift: true, ctrl: true });
        expect(inside.state.selected).toEqual([1, 2]);
        expect(inside.state.drops[0]).toEqual([
            moved(1, { x: BY.x, y: 0 }),
            moved(2, { x: BY.x, y: 0 }),
        ]);
        running?.pointerCancel();
        useBoxSelectionStore.setState({ inside: 7 });
        const shift = app({ selected: [1] });
        drag(shift.editor, m(2), BY, { shift: true });
        expect(shift.state.selected).toEqual([1, 2]);
        expect(shift.state.drops[0]).toEqual([moved(1, BY), moved(2, BY)]);
        running?.pointerCancel();
        // From outside it reaches inside first: both keys are the press's, and the drag is free
        useBoxSelectionStore.setState({ inside: null });
        const outside = app({ selected: [9] });
        drag(outside.editor, m(2), BY, { shift: true, ctrl: true });
        expect(outside.state.selected).toEqual([9, 2]);
        expect(useBoxSelectionStore.getState().inside).toBe(7);
        expect(outside.state.drops[0]).toEqual([
            moved(2, BY),
            { id: 9, x: LOOSE.x + BY.x, y: LOOSE.y + BY.y },
        ]);
    });

    it("takes a selected member out with a Shift+$mod drag, and the press ends there", () => {
        // Members a marquee picked, from outside the box
        const picked = app({ selected: [1, 4] });
        drag(picked.editor, m(4), BY, { shift: true, ctrl: true });
        expect(picked.state.selected).toEqual([1]);
        expect(useBoxSelectionStore.getState().inside).toBe(7);
        expect(picked.state.drops).toEqual([]);
        expect(picked.editor.activeGesture()).toBeNull();
        // Inside the box, with or without $mod
        for (const keys of [{ shift: true, ctrl: true }, { shift: true }]) {
            useBoxSelectionStore.setState({ inside: 7 });
            const { editor, state } = app({ selected: [1, 4] });
            drag(editor, m(4), BY, keys);
            expect(state.selected).toEqual([1]);
            expect(state.drops).toEqual([]);
        }
    });

    it("resizes a selected box with equal spacings on a $mod drag from a corner handle, and picks no marcher", () => {
        const { editor, state } = app({ selected: [1, 2, 3, 4] });
        // The back-left corner, out by 2 steps across and 1 deep
        drag(editor, m(1), { x: -2 * STEP, y: -STEP }, { ctrl: true });
        expect(state.selected).toEqual([1, 2, 3, 4]);
        expect(useBoxSelectionStore.getState().inside).toBeNull();
        expect(state.drops).toEqual([]);
        expect(commitBox).toHaveBeenCalledTimes(1);
        const params = vi.mocked(commitBox).mock.calls[0][1] as BoxParams;
        expect(params.across).toBeCloseTo(params.deep);
        expect(params.across).not.toBeCloseTo(box.params.across);
    });
});
