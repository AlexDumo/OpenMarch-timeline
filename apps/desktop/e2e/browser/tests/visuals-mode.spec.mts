// cspell:words choreo
import { test, expect } from "../fixtures.mjs";
import type { Page } from "@playwright/test";
import { clickMarcher, drawnMarchers } from "../app.mjs";
import { seedShowSql } from "../seed.mjs";

/**
 * Visuals mode (performer-behavior.md section 7.1): the workspace switch
 * swaps the toolbar and the inspector, and focusing a who in the Who list
 * dims everyone else on the field. Dimmed marchers stay selectable, since
 * the selection is a who too.
 */

test.use({
    seedSql: [
        ...seedShowSql({
            beats: 16,
            measureStarts: [1, 5, 9, 13],
            pageStarts: [1, 9],
            marchers: [
                { id: 1, section: "Trumpet", prefix: "T", order: 1 },
                { id: 2, section: "Trumpet", prefix: "T", order: 2 },
                { id: 3, section: "Flute", prefix: "F", order: 1 },
                { id: 4, section: "Flute", prefix: "F", order: 2 },
                { id: 5, section: "Color Guard", prefix: "G", order: 1 },
            ],
            positions: [0, 1, 2].map((page) =>
                [1, 2, 3, 4, 5].map(
                    (id) => [id, 300 + id * 60, 300 + page * 40] as const,
                ),
            ),
        }),
        `INSERT INTO tags (id, name) VALUES (1, 'Soloists')`,
        `INSERT INTO marcher_tags (marcher_id, tag_id) VALUES (1, 1), (5, 1)`,
    ],
});

const lit = async (page: Parameters<typeof drawnMarchers>[0]) =>
    (await drawnMarchers(page))
        .filter((m) => !m.dimmed)
        .map((m) => m.drillNumber)
        .sort();

test("focusing a who dims everyone else, and the Editor brings them back", async ({
    show,
}) => {
    const { page } = show;
    await expect(page.getByRole("heading", { name: "Page 0" })).toBeVisible();

    await page.getByTestId("workspace-view-visuals").click();
    await expect(page.getByTestId("visuals-tabs")).toBeVisible();
    await expect(page.getByTestId("visuals-inspector")).toBeVisible();

    await page.getByTestId("visuals-who-section-Trumpet").click();
    await expect.poll(() => lit(page)).toEqual(["T1", "T2"]);
    // winds only: the Horn/Equipment tab says Horn
    await expect(page.getByTestId("visuals-tab-horn_equipment")).toHaveText(
        /^Horn\d/,
    );

    await page.getByTestId("visuals-who-tag-1").click();
    await expect.poll(() => lit(page)).toEqual(["G1", "T1"]);
    await expect(page.getByTestId("visuals-tab-horn_equipment")).toHaveText(
        /^Horn \/ Equipment\d/,
    );

    // the selection follows clicks on the field, dimmed marchers included
    await page.getByTestId("visuals-who-selection").click();
    await clickMarcher(page, "F2");
    await expect.poll(() => lit(page)).toEqual(["F2"]);

    await page.getByTestId("visuals-clear-focus").click();
    await expect.poll(() => lit(page)).toHaveLength(5);

    await page.getByTestId("visuals-who-section-Flute").click();
    await expect.poll(() => lit(page)).toEqual(["F1", "F2"]);
    await page.getByTestId("workspace-view-editor").click();
    await expect(page.getByTestId("visuals-inspector")).toBeHidden();
    await expect.poll(() => lit(page)).toHaveLength(5);
});

interface StoredCue {
    id: number;
    channel: string;
    kind: string;
    target_kind: string;
    target_section: string | null;
    beat_id: number;
    value: string;
    length: number | null;
}

// Beats 1 to 16 are counts 0 to 15 (beat 0 is the show's zero-length start)
const COUNTS = 16;

/** Where count `count`'s click is on the lane, a little inside its count. */
async function laneX(page: Page, count: number) {
    const box = (await page.getByTestId("visuals-lane").boundingBox())!;
    const perCount = box.width / COUNTS;
    return {
        x: box.x + count * perCount + perCount * 0.2,
        y: box.y + box.height / 2,
        perCount,
    };
}

test("a click on the lane adds a state, and it moves and deletes", async ({
    show,
}) => {
    const { page } = show;
    const cues = () =>
        show.query<StoredCue>(
            "SELECT id, channel, kind, target_kind, target_section, beat_id, value, length FROM cues ORDER BY id",
        );
    await expect(page.getByRole("heading", { name: "Page 0" })).toBeVisible();
    await page.getByTestId("workspace-view-visuals").click();
    await expect(page.getByTestId("visuals-band-title")).toHaveText(
        /focus a who/,
    );

    await page.getByTestId("visuals-tab-facing").click();
    await page.getByTestId("visuals-who-section-Trumpet").click();
    await expect(page.getByTestId("visuals-band-title")).toHaveText(
        "Editing: Facing for Trumpet",
    );

    // a click adds a state on that count
    const at4 = await laneX(page, 4);
    await page.mouse.click(at4.x, at4.y);
    await expect.poll(cues).toEqual([
        expect.objectContaining({
            channel: "facing",
            kind: "state",
            target_kind: "section",
            target_section: "Trumpet",
            beat_id: 5,
            value: "builtin:facing.back",
        }),
    ]);
    const [state] = await cues();
    await expect(page.getByTestId(`visuals-cue-${state!.id}`)).toHaveAttribute(
        "data-count",
        "4",
    );
    // the result row shows the trumpets' own cue from count 4
    await expect(
        page.locator('[data-testid="visuals-result-span"][data-source="own"]'),
    ).toHaveCount(1);

    // a state holds until the next cue, but a click there still adds one
    const at12 = await laneX(page, 12);
    await page.mouse.click(at12.x, at12.y);
    await expect.poll(async () => (await cues()).length).toBe(2);

    // dragging a cue moves it, count by count
    const cue = page.getByTestId(`visuals-cue-${state!.id}`);
    const cueBox = (await cue.boundingBox())!;
    const startX = cueBox.x + cueBox.width - 3;
    await page.mouse.move(startX, at4.y);
    await page.mouse.down();
    await page.mouse.move(startX + at4.perCount * 3, at4.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await cues())[0]!.beat_id).toBe(8);

    // Delete removes the picked cue
    await page.keyboard.press("Delete");
    await expect
        .poll(async () => (await cues()).map((c) => c.beat_id))
        .toEqual([13]);
});

test("a drag on the lane adds a phrase, and dragging its end stretches it", async ({
    show,
}) => {
    const { page } = show;
    const cues = () =>
        show.query<StoredCue>(
            "SELECT id, channel, kind, target_kind, target_section, beat_id, value, length FROM cues ORDER BY id",
        );
    await expect(page.getByRole("heading", { name: "Page 0" })).toBeVisible();
    await page.getByTestId("workspace-view-visuals").click();
    await page.getByTestId("visuals-who-section-Trumpet").click();

    // on Body, a drag adds a phrase as long as the drag
    await page.getByTestId("visuals-tab-body").click();
    const from = await laneX(page, 2);
    const to = await laneX(page, 9);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    const bodyCues = async () =>
        (await cues()).filter((c) => c.channel === "body");
    await expect.poll(bodyCues).toEqual([
        expect.objectContaining({
            channel: "body",
            kind: "phrase",
            beat_id: 3,
            value: "builtin:body.choreo",
            length: 8,
        }),
    ]);

    // dragging its end sets its length
    const [phrase] = await bodyCues();
    const end = (await page
        .getByTestId(`visuals-cue-${phrase!.id}-end`)
        .boundingBox())!;
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
    await page.mouse.down();
    await page.mouse.move(
        end.x + end.width / 2 + from.perCount * 2,
        end.y + end.height / 2,
        {
            steps: 4,
        },
    );
    await page.mouse.up();
    await expect.poll(async () => (await bodyCues())[0]!.length).toBe(10);
});

test("the inspector edits the picked cue and says why the who does what it does", async ({
    show,
}) => {
    const { page } = show;
    const stored = async () =>
        (
            await show.query<{
                value: string;
                transition_length: number | null;
                ripple_json: string | null;
                notes: string | null;
            }>(
                "SELECT value, transition_length, ripple_json, notes FROM cues ORDER BY id",
            )
        )[0];
    await expect(page.getByRole("heading", { name: "Page 0" })).toBeVisible();
    await page.getByTestId("workspace-view-visuals").click();
    await page.getByTestId("visuals-tab-facing").click();
    await page.getByTestId("visuals-who-section-Trumpet").click();

    // the default, before any cue
    await expect(page.getByTestId("visuals-why")).toContainText(
        "Why, at count 1",
    );
    await expect(page.getByTestId("visuals-why-group")).toContainText(
        "The default",
    );

    const at1 = await laneX(page, 0);
    await page.mouse.click(at1.x, at1.y);
    await expect.poll(stored).toMatchObject({ value: "builtin:facing.back" });
    await expect(page.getByTestId("visuals-cue-panel")).toBeHidden();

    // pick it, and the panel shows it
    const [{ id }] = await show.query<{ id: number }>("SELECT id FROM cues");
    await page.getByTestId(`visuals-cue-${id}`).click();
    await expect(page.getByTestId("visuals-cue-panel")).toContainText(
        "Trumpet, count 1",
    );
    await expect(page.getByTestId("visuals-why-group")).toContainText("Set by");

    await page.getByTestId("visuals-cue-value").click();
    await page.getByRole("option", { name: "Side 1" }).click();
    await expect.poll(stored).toMatchObject({ value: "builtin:facing.side1" });

    await page.getByTestId("visuals-cue-transition").fill("3");
    await page.getByTestId("visuals-cue-transition").press("Enter");
    await expect.poll(stored).toMatchObject({ transition_length: 3 });

    await page.getByTestId("visuals-cue-ripple").click();
    await expect
        .poll(async () => JSON.parse((await stored())!.ripple_json ?? "null"))
        .toMatchObject({ span: 4, order: "drill" });

    await page.getByTestId("visuals-cue-notes").fill("Snap to the side");
    await page.getByTestId("visuals-cue-transition").click();
    await expect.poll(stored).toMatchObject({ notes: "Snap to the side" });

    await page.getByTestId("visuals-cue-delete").click();
    await expect.poll(stored).toBeUndefined();
    await expect(page.getByTestId("visuals-cue-panel")).toBeHidden();
});
