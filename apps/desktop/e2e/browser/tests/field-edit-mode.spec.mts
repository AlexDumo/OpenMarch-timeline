import type { Page } from "@playwright/test";
import type { FieldTestFieldEdit } from "../../../src/field/fieldTestApi";
import { test, expect } from "../fixtures.mjs";
import {
    createMarchers,
    dragFrom,
    drawnMarchers,
    waitForField,
    waitForIdle,
    waitForSettledField,
} from "../app.mjs";

// The Edit field mode (#824): the canvas edits the field's lines. Rulers to drag lines out of
// (with Mirror sides on, the twin comes too), lines to pick, box-select and delete, an exact
// position typed in a line's popover, every edit one undo step, and Done or Escape to leave.
// The blank show's field is the high school football field (no end zones): X lines every 8 steps
// from -80 to 80, so S1 45 is -8 and S2 40 is 16.

// Each scenario is a long session of drags, undo steps and saves: three times the usual time
test.slow();

type Line = FieldTestFieldEdit["lines"][number];

const fieldEdit = (page: Page) =>
    page.evaluate(() => window.fieldTest?.fieldEdit?.() ?? null);

async function editState(page: Page): Promise<FieldTestFieldEdit> {
    await expect.poll(() => fieldEdit(page)).not.toBeNull();
    return (await fieldEdit(page))!;
}

const xSteps = async (page: Page) =>
    (await editState(page)).lines
        .filter((l) => l.axis === "x")
        .map((l) => l.steps);

const line = async (page: Page, axis: "x" | "y", steps: number) => {
    const found = (await editState(page)).lines.find(
        (l) => l.axis === axis && l.steps === steps,
    );
    expect(found, `${axis} line at ${steps}`).toBeDefined();
    return found as Line;
};

/** The X checkpoints' steps as saved */
async function savedXSteps(show: {
    query: <T>(sql: string) => Promise<T[]>;
}): Promise<number[]> {
    const [row] = await show.query<{ json_data: string }>(
        "SELECT json_data FROM field_properties",
    );
    return (
        JSON.parse(row!.json_data) as {
            xCheckpoints: { stepsFromCenterFront: number }[];
        }
    ).xCheckpoints
        .map((c) => c.stepsFromCenterFront)
        .sort((a, b) => a - b);
}

async function enterFromSidebar(page: Page) {
    await waitForField(page);
    await waitForSettledField(page);
    await page.locator("#sidebar-launcher-field").click();
    await expect(page.getByTestId("field-edit-panel")).toBeVisible();
    await editState(page);
}

test("enter the mode, drag a mirrored line out of the ruler, undo, and leave with Escape", async ({
    show,
}) => {
    const { page } = show;
    await waitForField(page);
    await createMarchers(page, { quantity: 4, section: "Baritone" });
    await enterFromSidebar(page);

    // Marchers step back and can't be picked
    await expect
        .poll(async () => (await drawnMarchers(page)).every((m) => m.dimmed))
        .toBe(true);
    const before = await xSteps(page);
    expect(before).toHaveLength(21);
    expect((await editState(page)).mirror).toBe(true);

    // Out of the top ruler, halfway between S2 45 (8) and S2 40 (16): a line at 12, and its twin
    const a = await line(page, "x", 8);
    const b = await line(page, "x", 16);
    const startX = (a.tab.x + b.tab.x) / 2;
    const ruler = (await editState(page)).rulers.x;
    await dragFrom(
        page,
        { x: startX, y: ruler.from.y },
        { x: 0, y: a.screen.y - ruler.from.y },
        {
            steps: 12,
            beforeRelease: async () => {
                const drag = (await editState(page)).drag;
                expect(drag).toMatchObject({
                    kind: "add",
                    axis: "x",
                    steps: 12,
                    overRuler: false,
                });
                await expect(
                    page.getByTestId("field-edit-readout"),
                ).toContainText("12 steps");
            },
        },
    );
    await waitForIdle(page);
    await expect.poll(() => xSteps(page)).toHaveLength(23);
    expect(await savedXSteps(show)).toContain(12);
    expect(await savedXSteps(show)).toContain(-12);
    // The new line is picked, its twin lit with it
    const added = await line(page, "x", 12);
    expect(added.selected).toBe(true);
    expect((await line(page, "x", -12)).highlighted).toBe(true);
    await expect(page.getByTestId("field-edit-changes")).toContainText(
        "2 changes",
    );

    // One undo step takes both away
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => xSteps(page)).toEqual(before);
    expect(await savedXSteps(show)).not.toContain(12);

    // Escape drops the pick first, then leaves
    await line(page, "x", 8).then((l) =>
        page.mouse.click(l.screen.x, l.screen.y),
    );
    await expect
        .poll(async () => (await line(page, "x", 8)).selected)
        .toBe(true);
    await page.keyboard.press("Escape");
    await expect
        .poll(async () => (await editState(page)).lines.some((l) => l.selected))
        .toBe(false);
    await page.keyboard.press("Escape");
    await expect.poll(() => fieldEdit(page)).toBeNull();
    await expect(page.getByTestId("field-edit-panel")).toBeHidden();
    await expect
        .poll(async () => (await drawnMarchers(page)).some((m) => m.dimmed))
        .toBe(false);
});

test("box-select, keep every other and delete the ten 5-yard lines, as one undo step", async ({
    show,
}) => {
    const { page } = show;
    await waitForField(page);
    await waitForSettledField(page);
    // The mode's own key
    await page.keyboard.press("ControlOrMeta+Shift+e");
    await expect(page.getByTestId("field-edit-panel")).toBeVisible();
    const before = await savedXSteps(show);

    // A thin box across the field, between the front sideline and the front hash, from just
    // inside the S1 goal line to just inside the S2 goal line
    const state = await editState(page);
    const front = state.lines.find((l) => l.axis === "y" && l.steps === 0)!;
    const hash = state.lines
        .filter((l) => l.axis === "y" && l.steps < 0)
        .sort((p, q) => q.steps - p.steps)[0]!;
    const y = (front.screen.y + hash.screen.y) / 2;
    const s1Goal = await line(page, "x", -80);
    const s1Five = await line(page, "x", -72);
    const s2Five = await line(page, "x", 72);
    const s2Goal = await line(page, "x", 80);
    const left = (s1Goal.screen.x + s1Five.screen.x) / 2;
    const right = (s2Five.screen.x + s2Goal.screen.x) / 2;
    await dragFrom(page, { x: left, y: y - 4 }, { x: right - left, y: 8 });
    await expect
        .poll(
            async () =>
                (await editState(page)).lines.filter((l) => l.selected).length,
        )
        .toBe(19);

    await page
        .getByTestId("field-edit-panel")
        .getByRole("button", { name: /Every other/ })
        .click();
    await expect
        .poll(async () =>
            (await editState(page)).lines
                .filter((l) => l.selected)
                .map((l) => l.steps),
        )
        .toEqual([-72, -56, -40, -24, -8, 8, 24, 40, 56, 72]);

    await page.keyboard.press("Delete");
    await waitForIdle(page);
    await expect
        .poll(() => savedXSteps(show))
        .toEqual([-80, -64, -48, -32, -16, 0, 16, 32, 48, 64, 80]);

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => savedXSteps(show)).toEqual(before);
});

test("drag a line, type its exact position, and drag it back into the ruler to delete it", async ({
    show,
}) => {
    const { page } = show;
    await enterFromSidebar(page);

    // Drag S2 40 (16) a step toward the 50: its twin S1 40 follows
    const forty = await line(page, "x", 16);
    const thirtyFive = await line(page, "x", 24);
    const stepPx = (thirtyFive.screen.x - forty.screen.x) / 8;
    await dragFrom(page, forty.screen, { x: -2 * stepPx, y: 0 }, { steps: 8 });
    await waitForIdle(page);
    await expect.poll(() => savedXSteps(show)).toContain(14);
    expect(await savedXSteps(show)).toContain(-14);

    // Double-click it and type the 47.5 yard line: 4 steps from the 50, still on side 2
    const moved = await line(page, "x", 14);
    await page.mouse.dblclick(moved.screen.x, moved.screen.y);
    const popover = page.getByTestId("field-line-popover");
    await expect(popover).toBeVisible();
    await page.getByTestId("field-line-position").fill("47.5yd");
    await expect(popover).toContainText("47.5 yard line");
    await page.getByTestId("field-line-short-name").fill("47.5");
    await page.keyboard.press("Enter");
    await expect(popover).toBeHidden();
    await waitForIdle(page);
    await expect.poll(() => savedXSteps(show)).toContain(4);
    expect(await savedXSteps(show)).toContain(-4);
    expect((await line(page, "x", 4)).shortName).toBe("47.5");

    // Position and name were one step: one undo puts the line back at 14
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => savedXSteps(show)).toContain(14);
    await expect.poll(() => xSteps(page)).toContain(14);

    // Back into its ruler: deleted, with its twin
    const back = await line(page, "x", 14);
    const ruler = (await editState(page)).rulers.x;
    await dragFrom(
        page,
        back.screen,
        { x: 0, y: ruler.from.y - back.screen.y },
        {
            steps: 12,
            beforeRelease: async () =>
                expect(page.getByTestId("field-edit-readout")).toContainText(
                    "delete",
                ),
        },
    );
    await waitForIdle(page);
    await expect.poll(() => savedXSteps(show)).not.toContain(14);
    expect(await savedXSteps(show)).not.toContain(-14);

    // Done leaves
    await page.getByTestId("field-edit-done").click();
    await expect.poll(() => fieldEdit(page)).toBeNull();
});

test("the panel's X puts the field back as it was when it opened, and undo brings the changes back", async ({
    show,
}) => {
    const { page } = show;
    await enterFromSidebar(page);
    const before = await savedXSteps(show);
    await line(page, "x", 16).then((l) =>
        page.mouse.click(l.screen.x, l.screen.y),
    );
    await page.keyboard.press("Delete");
    await expect.poll(() => savedXSteps(show)).not.toContain(16);

    await page.getByTestId("field-edit-discard").click();
    await expect.poll(() => fieldEdit(page)).toBeNull();
    await expect(page.getByTestId("field-edit-panel")).toBeHidden();
    await expect.poll(() => savedXSteps(show)).toEqual(before);

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => savedXSteps(show)).not.toContain(16);
});

test("the Field panel holds the field's settings: a new width moves the outer lines, one undo step", async ({
    show,
}) => {
    const { page } = show;
    await enterFromSidebar(page);
    const panel = page.getByTestId("field-edit-panel");
    for (const [section, inside] of [
        ["Size and steps", "Step size"],
        ["Template and files", "Field Template"],
        ["Name and sides", "Side Descriptions"],
        ["Markings and labels", "Yard numbers"],
        ["Background image", "Show Background Image"],
        ["Colors", "Marchers and paths"],
    ] as const) {
        await panel.getByRole("button", { name: section }).click();
        await expect(panel.getByText(inside).first()).toBeVisible();
    }

    // Width: the goal lines move out to ±88, the lines inside stay (owner, #824)
    const before = await savedXSteps(show);
    await page.getByTestId("field-width").fill("176");
    await page.getByTestId("field-width").press("Enter");
    await expect
        .poll(() => savedXSteps(show))
        .toEqual([-88, ...before.slice(1, -1), 88]);
    await expect(page.getByTestId("field-size")).toContainText("176 ×");

    // The yard numbers' placement can be typed (B9)
    const yard = page.getByTestId("field-yard-homeStepsFromFrontToOutside");
    await yard.fill("12");
    await yard.press("Enter");
    await expect
        .poll(async () => {
            const [row] = await show.query<{ json_data: string }>(
                "SELECT json_data FROM field_properties",
            );
            return JSON.parse(row!.json_data).yardNumberCoordinates
                .homeStepsFromFrontToOutside;
        })
        .toBe(12);

    // Each is its own undo step, and the inputs follow the undo (B1)
    await page.keyboard.press("ControlOrMeta+z");
    await expect(yard).not.toHaveValue("12");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => savedXSteps(show)).toEqual(before);
    await expect(page.getByTestId("field-width")).toHaveValue("160");
});

/** The saved X checkpoints, with what H and R change */
async function savedXLines(show: {
    query: <T>(sql: string) => Promise<T[]>;
}): Promise<
    { steps: number; visible: boolean; reference: boolean; name: string }[]
> {
    const [row] = await show.query<{ json_data: string }>(
        "SELECT json_data FROM field_properties",
    );
    return (
        JSON.parse(row!.json_data) as {
            xCheckpoints: {
                stepsFromCenterFront: number;
                visible: boolean;
                useAsReference: boolean;
                name: string;
            }[];
        }
    ).xCheckpoints
        .map((c) => ({
            steps: c.stepsFromCenterFront,
            visible: c.visible,
            reference: c.useAsReference,
            name: c.name,
        }))
        .sort((a, b) => a.steps - b.steps);
}

const savedX = async (show: Parameters<typeof savedXLines>[0], steps: number) =>
    (await savedXLines(show)).find((l) => l.steps === steps);

test("slide a line's ruler tab along its ruler: the line moves, and Escape lets go of a drag", async ({
    show,
}) => {
    const { page } = show;
    await enterFromSidebar(page);
    const before = await savedXSteps(show);

    // S2 40's tab, two steps toward S2 35 along the top ruler: a move, never a delete
    const forty = await line(page, "x", 16);
    const thirtyFive = await line(page, "x", 24);
    const stepPx = (thirtyFive.tab.x - forty.tab.x) / 8;
    await dragFrom(
        page,
        forty.tab,
        { x: 2 * stepPx, y: 0 },
        {
            steps: 8,
            beforeRelease: async () => {
                expect((await editState(page)).drag).toMatchObject({
                    kind: "move",
                    steps: 18,
                    overRuler: false,
                });
                await expect(
                    page.getByTestId("field-edit-readout"),
                ).not.toContainText("delete");
            },
        },
    );
    await waitForIdle(page);
    await expect.poll(() => savedXSteps(show)).toContain(18);
    expect(await savedXSteps(show)).toContain(-18);
    expect(await savedXSteps(show)).toHaveLength(before.length);

    // Escape in the middle of a drag: nothing changes, the mode stays on
    const moved = await line(page, "x", 18);
    await page.mouse.move(moved.screen.x, moved.screen.y);
    await page.mouse.down();
    await page.mouse.move(moved.screen.x + 3 * stepPx, moved.screen.y, {
        steps: 6,
    });
    await expect.poll(async () => (await editState(page)).drag).not.toBeNull();
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await editState(page)).drag).toBeNull();
    await page.mouse.up();
    await waitForIdle(page);
    expect(await savedXSteps(show)).toContain(18);
    expect(await fieldEdit(page)).not.toBeNull();

    // Escape while the button is down but before the drag starts: let go of the press, still
    // in the mode, and the line stays picked
    await page.mouse.move(moved.screen.x, moved.screen.y);
    await page.mouse.down();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await fieldEdit(page)).not.toBeNull();
    expect((await line(page, "x", 18)).selected).toBe(true);
});

test("H, R and the arrows act on the picked line and its twin, each one undo step", async ({
    show,
}) => {
    const { page } = show;
    await enterFromSidebar(page);
    const forty = await line(page, "x", 16);
    await page.mouse.click(forty.screen.x, forty.screen.y);
    await expect
        .poll(async () => (await line(page, "x", 16)).selected)
        .toBe(true);

    await page.keyboard.press("h");
    await expect
        .poll(async () => (await savedX(show, 16))?.visible)
        .toBe(false);
    expect((await savedX(show, -16))?.visible).toBe(false);

    const reference = (await savedX(show, 16))!.reference;
    await page.keyboard.press("r");
    await expect
        .poll(async () => (await savedX(show, 16))?.reference)
        .toBe(!reference);
    expect((await savedX(show, -16))?.reference).toBe(!reference);

    // Right: a step out from the 50 on side 2, and the twin a step out on side 1; Shift: half
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => savedXSteps(show)).toContain(17);
    expect(await savedXSteps(show)).toContain(-17);
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(() => savedXSteps(show)).toContain(17.5);
    expect(await savedXSteps(show)).toContain(-17.5);

    // Each key was its own undo step
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => savedXSteps(show)).toContain(17);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => savedXSteps(show)).toContain(16);
    await page.keyboard.press("ControlOrMeta+z");
    await expect
        .poll(async () => (await savedX(show, 16))?.reference)
        .toBe(reference);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await savedX(show, 16))?.visible).toBe(true);
});

test("Tab walks the lines from the field, and F6 takes the keyboard to the Field panel and back", async ({
    show,
}) => {
    const { page } = show;
    await enterFromSidebar(page);
    // Entering from the sidebar's button gives the field the keyboard
    await expect(page.getByTestId("field-edit-overlay")).toBeFocused();
    const first = (await editState(page)).lines[0]!;
    await page.keyboard.press("Tab");
    await expect
        .poll(async () =>
            (await editState(page)).lines
                .filter((l) => l.selected)
                .map((l) => l.id),
        )
        .toEqual([first.id]);

    await page.keyboard.press("F6");
    await expect(
        page.getByTestId("field-edit-panel").locator(":focus"),
    ).toHaveCount(1);
    // Tab in the panel is the panel's: the pick stays
    await page.keyboard.press("Tab");
    await expect(
        page.getByTestId("field-edit-panel").locator(":focus"),
    ).toHaveCount(1);
    expect(
        (await editState(page)).lines
            .filter((l) => l.selected)
            .map((l) => l.id),
    ).toEqual([first.id]);

    await page.keyboard.press("F6");
    await expect(page.getByTestId("field-edit-overlay")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect
        .poll(
            async () =>
                (await editState(page)).lines.filter((l) => l.selected).length,
        )
        .toBe(1);
    expect((await editState(page)).lines.find((l) => l.selected)!.id).not.toBe(
        first.id,
    );

    // The panel's help says how
    await page.getByTestId("field-edit-keys").click();
    await expect(page.getByTestId("field-edit-keys-help")).toContainText("F6");
});

test("the list's + adds a mirrored line halfway, and the template sheet keeps the look or resets", async ({
    show,
}) => {
    const { page } = show;
    await enterFromSidebar(page);
    const before = await savedXSteps(show);

    // Mirror on: the first gap is between the 50 and the 45s, so the new pair is at ±4
    const list = page.getByTestId("field-lines-x");
    await list.getByTestId("field-lines-insert").first().hover();
    await list.getByTestId("field-lines-insert").first().click();
    await expect.poll(() => savedXSteps(show)).toContain(4);
    expect(await savedXSteps(show)).toContain(-4);
    expect(await savedXSteps(show)).toHaveLength(before.length + 2);

    // Hide the top labels (part of the look), then switch templates keeping the look
    const panel = page.getByTestId("field-edit-panel");
    await panel.getByRole("button", { name: "Markings and labels" }).click();
    await page.getByTestId("field-labels-top").click();
    await panel.getByRole("button", { name: "Template and files" }).click();
    await page.getByTestId("field-template-select").click();
    await page
        .getByRole("option", { name: "College football field (no end zones)" })
        .click();
    const sheet = page.getByRole("alertdialog");
    await expect(sheet).toContainText("Switch to College football");
    await expect(page.getByTestId("field-template-diff")).toBeVisible();
    await expect(page.getByTestId("field-template-keep-look")).toBeChecked();
    await page.getByTestId("field-template-apply").click();
    await expect(page.getByTestId("field-edit-based-on")).toContainText(
        "College football field (no end zones)",
    );
    const saved = async () => {
        const [row] = await show.query<{ json_data: string }>(
            "SELECT json_data FROM field_properties",
        );
        return JSON.parse(row!.json_data) as {
            name: string;
            topLabelsVisible: boolean;
        };
    };
    expect((await saved()).topLabelsVisible).toBe(false);
    // The template's own lines: the pair at ±4 is gone
    expect(await savedXSteps(show)).not.toContain(4);

    // Add a line, then reset to the template: back to its lines
    await list.getByTestId("field-lines-insert").first().click();
    await expect.poll(() => savedXSteps(show)).toContain(4);
    await expect(page.getByTestId("field-template-reset")).toContainText(
        "Reset to College football field (no end zones)",
    );
    await page.getByTestId("field-template-reset").click();
    await expect(sheet).toContainText("Reset to College football");
    await page.getByTestId("field-template-apply").click();
    await expect.poll(() => savedXSteps(show)).not.toContain(4);
    // The kept look (the top labels hidden) is the one change left
    await expect(page.getByTestId("field-edit-changes")).toContainText(
        "1 change",
    );
    expect((await saved()).topLabelsVisible).toBe(false);
});

test("reopening the show leaves the mode", async ({ show }) => {
    const { page } = show;
    await enterFromSidebar(page);
    await line(page, "x", 16).then((l) =>
        page.mouse.click(l.screen.x, l.screen.y),
    );
    // A reload is how the app opens a show again; the mode is the open show's, never kept
    await page.reload();
    await waitForField(page);
    await expect(page.getByTestId("field-edit-panel")).toBeHidden();
    expect(await fieldEdit(page)).toBeNull();
});

test.describe("touch", () => {
    test.use({
        // The touch layout, pinned, as Settings › Touch & Input does
        initScript: "localStorage.setItem('openmarch:inputMode', 'touch');",
    });

    /** Touches one point for `holdMs`, as a finger */
    async function touch(page: Page, at: { x: number; y: number }, holdMs = 0) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: at.x, y: at.y, id: 0 }],
        });
        if (holdMs > 0) await page.waitForTimeout(holdMs);
        await cdp.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
        });
        await cdp.detach();
    }

    test("a finger gets 44 px rulers, a long press opens the line's menu, and a tap on a picked line its values", async ({
        show,
    }) => {
        const { page } = show;
        await enterFromSidebar(page);
        const state = await editState(page);
        // The rulers are 44 px thick: their middle is 22 px in
        const box = (await page
            .getByTestId("field-edit-overlay")
            .boundingBox())!;
        expect(state.rulers.x.from.y - box.y).toBeCloseTo(22, 0);
        expect(state.rulers.y.from.x - box.x).toBeCloseTo(22, 0);

        const forty = await line(page, "x", 16);
        await touch(page, forty.screen, 700);
        const menu = page.getByTestId("field-line-menu");
        await expect(menu).toBeVisible();
        await expect
            .poll(async () => (await editState(page)).menu)
            .toEqual({
                axis: "x",
                id: forty.id,
            });
        // Hide from the menu: the line and its twin
        await menu.getByRole("menuitem", { name: /Hide/ }).click();
        await expect
            .poll(async () => (await savedX(show, 16))?.visible)
            .toBe(false);
        expect((await savedX(show, -16))?.visible).toBe(false);

        // The line is picked: a tap opens its exact values, with the number pad
        await touch(page, forty.screen);
        await expect(page.getByTestId("field-line-popover")).toBeVisible();
        await expect(
            page.getByRole("group", { name: "Number pad" }),
        ).toBeVisible();
    });
});
