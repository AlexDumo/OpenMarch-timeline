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

// Each scenario is a long session of drags, undos and saves: three times the usual time
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
    await expect(page.getByTestId("field-edit-bar")).toBeVisible();
    await expect(page.getByTestId("field-inspector")).toBeVisible();
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
    await line(page, "x", 8).then((l) => page.mouse.click(l.screen.x, l.screen.y));
    await expect.poll(async () => (await line(page, "x", 8)).selected).toBe(true);
    await page.keyboard.press("Escape");
    await expect
        .poll(async () => (await editState(page)).lines.some((l) => l.selected))
        .toBe(false);
    await page.keyboard.press("Escape");
    await expect.poll(() => fieldEdit(page)).toBeNull();
    await expect(page.getByTestId("field-edit-bar")).toBeHidden();
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
    await expect(page.getByTestId("field-edit-bar")).toBeVisible();
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

    await page.getByTestId("field-edit-bar").getByRole("button", { name: /Every other/ }).click();
    await expect
        .poll(async () =>
            (await editState(page)).lines
                .filter((l) => l.selected)
                .map((l) => l.steps),
        )
        .toEqual([-72, -56, -40, -24, -8, 8, 24, 40, 56, 72]);

    await page.keyboard.press("Delete");
    await waitForIdle(page);
    await expect.poll(() => savedXSteps(show)).toEqual([
        -80, -64, -48, -32, -16, 0, 16, 32, 48, 64, 80,
    ]);

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
                expect(
                    page.getByTestId("field-edit-readout"),
                ).toContainText("delete"),
        },
    );
    await waitForIdle(page);
    await expect.poll(() => savedXSteps(show)).not.toContain(14);
    expect(await savedXSteps(show)).not.toContain(-14);

    // Done leaves
    await page.getByTestId("field-edit-done").click();
    await expect.poll(() => fieldEdit(page)).toBeNull();
});
