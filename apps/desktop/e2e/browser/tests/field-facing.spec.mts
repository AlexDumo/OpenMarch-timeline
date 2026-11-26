import type { Page } from "@playwright/test";
import { test, expect, type Show } from "../fixtures.mjs";
import {
    clickMarcher,
    drawnMarchers,
    goTo,
    waitForField,
    waitForIdle,
    waitForSettledField,
} from "../app.mjs";
import { seedShowSql, type SeedPosition } from "../seed.mjs";

// Show facing on the 2D field (fork #1316): a caret in front of every performer's dot, pointing
// the way they face at the playhead, turning through a facing change's counts as the Facing lane
// and the 3D View do. A label the caret points through moves to the dot's other side.
//
// Measures start every 4 beats, so measure 3 starts on beat 9, measure 2 on beat 5 and measure 1
// on beat 1. T1 and T2 turn to the back on measure 3, over the 8 counts before it: halfway round
// on measure 2. T3 faces the front throughout.
test.use({
    seedSql: seedShowSql({
        beats: 32,
        measureStarts: [1, 5, 9, 13, 17, 21, 25, 29],
        pageStarts: [1, 9, 17],
        marchers: [1, 2, 3].map((id) => ({
            id,
            section: "Trumpet",
            prefix: "T",
            order: id,
        })),
        positions: Array.from({ length: 4 }, (): SeedPosition[] => [
            [1, 400, 300],
            [2, 500, 300],
            [3, 600, 300],
        ]),
    }),
});

/** Each drill number's facing and how far its label moved off its caret, as the field draws them. */
async function facings(page: Page) {
    return Object.fromEntries(
        (await drawnMarchers(page)).map((m) => [
            m.drillNumber,
            { facing: m.facing, labelMoved: m.labelMoved },
        ]),
    );
}

/**
 * The facing cues saved: their angle and their transition, counted inclusively (a turn over 8
 * counts is 9; null: instant).
 */
const savedFacing = async (show: Show) =>
    show.query<{ value: string; transition: number | null }>(
        "SELECT value, transition FROM cues WHERE type = 'facing'",
    );

const STILL = { x: 0, y: 0 };

test("Show facing turns each performer's caret through the turn, and a label the caret points through moves below the dot", async ({
    show,
}) => {
    const { page } = show;
    await waitForField(page);
    await waitForSettledField(page);

    // Off by default: no carets
    expect((await facings(page)).T1).toEqual({
        facing: null,
        labelMoved: STILL,
    });
    await page.getByTestId("field-display-facing").click();
    await expect(page.getByTestId("field-display-facing")).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    // Everyone faces the front until turned; the caret points down, away from the label above
    await expect
        .poll(() => facings(page))
        .toEqual({
            T1: { facing: 0, labelMoved: STILL },
            T2: { facing: 0, labelMoved: STILL },
            T3: { facing: 0, labelMoved: STILL },
        });

    // T1 and T2 to the back on measure 3, from the field's right-click menu
    await goTo(page, "m3");
    await clickMarcher(page, "T1");
    await clickMarcher(page, "T2", { add: true });
    const t1 = (await drawnMarchers(page)).find((m) => m.drillNumber === "T1")!;
    await page.mouse.click(t1.screen.x, t1.screen.y, { button: "right" });
    await page.getByTestId("field-menu-facing").hover();
    await page.getByTestId("field-menu-facingBack").click();
    await waitForIdle(page);
    await expect.poll(() => savedFacing(show)).toHaveLength(1);

    // Over the 8 counts before it, in the turn panel (double-click the change in the Facing lane)
    await page.getByTestId("facing-lane-hold").first().dblclick();
    const counts = page.getByTestId("turn-counts");
    await counts.fill("8");
    await counts.press("Enter");
    await page.keyboard.press("Escape");
    await expect
        .poll(async () => (await savedFacing(show))[0]?.transition)
        .toBe(9);
    await waitForIdle(page);

    // On measure 3 they face the back: the caret points up through the label, which goes below
    // the dot, as far below as it was above
    await expect
        .poll(() => facings(page))
        .toEqual({
            T1: { facing: 180, labelMoved: { x: 0, y: 22 } },
            T2: { facing: 180, labelMoved: { x: 0, y: 22 } },
            T3: { facing: 0, labelMoved: STILL },
        });

    // Before the turn, the front
    await goTo(page, "m1");
    await expect
        .poll(async () => (await facings(page)).T1)
        .toEqual({ facing: 0, labelMoved: STILL });

    // Halfway through the turn they face side 2, turning to their left; the caret points right,
    // clear of the label
    await goTo(page, "m2");
    await expect
        .poll(() => facings(page))
        .toEqual({
            T1: { facing: 90, labelMoved: STILL },
            T2: { facing: 90, labelMoved: STILL },
            T3: { facing: 0, labelMoved: STILL },
        });

    // Show facing off: no carets, and every label back above its dot
    await goTo(page, "m3");
    await page.getByTestId("field-display-facing").click();
    await expect
        .poll(async () => (await facings(page)).T1)
        .toEqual({ facing: null, labelMoved: STILL });
});
