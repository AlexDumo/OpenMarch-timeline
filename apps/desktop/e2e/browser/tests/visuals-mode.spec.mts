// cspell:words choreo
import { test, expect } from "../fixtures.mjs";
import type { Page } from "@playwright/test";
import {
    clickMarcher,
    dragFrom,
    dragMarcher,
    drawnMarchers,
    selectedDrillNumbers,
    waitForIdle,
} from "../app.mjs";
import { savedPosition } from "../positions.mjs";
import { seedShowSql } from "../seed.mjs";

/**
 * Visuals mode (performer-behavior.md section 7.1, owner note 2026-10-17):
 * its own workspace, as the Light Designer is. The switch swaps the
 * toolbar, the inspector and the timeline: Visuals' timeline has the cue
 * lanes in place of the drill clips and edits no drill, and the field only
 * selects there. Focusing a who in the Who list dims everyone else on the
 * field; dimmed marchers stay selectable, since the selection is a who too.
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

test("the ramp sets a transition, a copy pastes onto another who, and clashes are flagged", async ({
    show,
}) => {
    const { page } = show;
    const cues = () =>
        show.query<StoredCue & { transition_length: number | null }>(
            "SELECT id, channel, kind, target_kind, target_section, beat_id, value, length, transition_length FROM cues ORDER BY id",
        );
    await expect(page.getByRole("heading", { name: "Page 0" })).toBeVisible();
    await page.getByTestId("workspace-view-visuals").click();
    await page.getByTestId("visuals-tab-facing").click();
    await page.getByTestId("visuals-who-section-Trumpet").click();

    for (const count of [6, 10]) {
        const at = await laneX(page, count);
        await page.mouse.click(at.x, at.y);
    }
    await expect.poll(async () => (await cues()).length).toBe(2);
    const [first, second] = await cues();

    // Facing's ramp is two counts; dragging its start back two more makes four
    const ramp = (await page
        .getByTestId(`visuals-cue-${first!.id}-ramp`)
        .boundingBox())!;
    const { perCount } = await laneX(page, 0);
    await page.mouse.move(ramp.x + 2, ramp.y + ramp.height / 2);
    await page.mouse.down();
    await page.mouse.move(ramp.x + 2 - perCount * 2, ramp.y + ramp.height / 2, {
        steps: 4,
    });
    await page.mouse.up();
    await expect.poll(async () => (await cues())[0]!.transition_length).toBe(4);

    // Shift picks both; copy, focus the flutes, paste at the playhead
    await page.getByTestId(`visuals-cue-${first!.id}`).click();
    await page
        .getByTestId(`visuals-cue-${second!.id}`)
        .click({ modifiers: ["Shift"] });
    await page.keyboard.press("ControlOrMeta+c");
    await page.getByTestId("visuals-who-section-Flute").click();
    await page.getByTestId("visuals-band-paste").click();
    await expect
        .poll(async () =>
            (await cues())
                .filter((c) => c.target_section === "Flute")
                .map((c) => [c.beat_id, c.transition_length]),
        )
        // at the playhead (count 0), four counts apart, the ramp kept
        .toEqual([
            [1, 4],
            [5, null],
        ]);

    // pasting again puts a second flute cue on each count: they clash
    await page.getByTestId("visuals-band-paste").click();
    await expect.poll(async () => (await cues()).length).toBe(6);
    await expect(page.getByTestId("visuals-band-flags")).toHaveText(
        "4 flagged cues",
    );
    // and the result row shows where they set the flutes
    await expect(
        page.locator('[data-testid="visuals-result-span"][data-flagged]'),
    ).not.toHaveCount(0);
});

// The review fix (8b46cd0ef) let Ctrl/Cmd presses through the band to draw the drill
// timeline's range. Visuals has its own read-only timeline now (owner note 2026-10-17), which
// draws no range: the press still isn't a cue, and the drag scrubs instead.
test("Ctrl or Cmd+drag on the band adds no cue and draws no range: it scrubs", async ({
    show,
}) => {
    const { page } = show;
    await expect(page.getByRole("heading", { name: "Page 0" })).toBeVisible();
    await page.getByTestId("workspace-view-visuals").click();
    await page.getByTestId("visuals-tab-facing").click();
    await page.getByTestId("visuals-who-section-Trumpet").click();
    await expect(page.getByTestId("visuals-lane")).toBeVisible();

    const from = await laneX(page, 2);
    const to = await laneX(page, 7);
    await page.keyboard.down("ControlOrMeta");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await expect(page.getByTestId("timeline-range-preview")).toHaveCount(0);
    await page.mouse.up();
    await page.keyboard.up("ControlOrMeta");

    await expect(page.getByTestId("timeline-selection-count")).toHaveCount(0);
    await expect(page.getByTestId("timeline-selection-range")).toHaveCount(0);
    expect(await show.query("SELECT id FROM cues")).toEqual([]);
    // the scrub moved the playhead off home
    await expect(
        page.getByRole("button", { name: /^Playback position: Page 1\b/ }),
    ).toBeVisible();
});
test("a Facing cue's wheel sets its angle and the field gives its point", async ({
    show,
}) => {
    const { page } = show;
    const settings = async () =>
        JSON.parse(
            (
                await show.query<{ settings_json: string }>(
                    "SELECT settings_json FROM cues",
                )
            )[0]?.settings_json ?? "{}",
        );
    await expect(page.getByRole("heading", { name: "Page 0" })).toBeVisible();
    await page.getByTestId("workspace-view-visuals").click();
    await page.getByTestId("visuals-tab-facing").click();
    await page.getByTestId("visuals-who-section-Trumpet").click();
    const at = await laneX(page, 2);
    await page.mouse.click(at.x, at.y);
    const ids = () => show.query<{ id: number }>("SELECT id FROM cues");
    await expect.poll(async () => (await ids()).length).toBe(1);
    const [{ id }] = await ids();
    await page.getByTestId(`visuals-cue-${id}`).click();

    await page.getByTestId("visuals-cue-value").click();
    await page.getByRole("option", { name: "Angle" }).click();
    // a press on the wheel's right edge: side 2
    const wheel = (await page
        .getByTestId("visuals-facing-wheel")
        .boundingBox())!;
    await page.mouse.click(
        wheel.x + wheel.width - 4,
        wheel.y + wheel.height / 2,
    );
    await expect.poll(settings).toMatchObject({ degrees: 90 });

    await page.getByTestId("visuals-cue-value").click();
    await page.getByRole("option", { name: "Toward a point" }).click();
    await page.getByTestId("visuals-pick-point").click();
    const f1 = (await drawnMarchers(page)).find((m) => m.drillNumber === "F1")!;
    await page.mouse.click(f1.screen.x, f1.screen.y);
    await expect.poll(settings).toMatchObject({
        x: expect.closeTo(f1.x, 0),
        y: expect.closeTo(f1.y, 0),
    });
    // the press picked the point and selected no one
    await expect(page.getByTestId("visuals-who-selection")).toContainText(
        "Nothing selected",
    );
});

test("Visuals has its own timeline, and the field only selects there", async ({
    show,
}) => {
    const { page } = show;
    await expect(page.getByRole("heading", { name: "Page 0" })).toBeVisible();
    const t1 = await savedPosition(show, 1);

    await page.getByTestId("workspace-view-visuals").click();
    await expect(page.locator("main")).toHaveAttribute(
        "data-workspace",
        "visuals",
    );
    // the cue lanes are the timeline's lanes: no drill clips, no + and no window
    await expect(page.getByTestId("visuals-band")).toBeVisible();
    await expect(page.getByTestId("timeline-clip")).toHaveCount(0);
    await expect(page.getByTestId("timeline-add-page-flag")).toHaveCount(0);
    await expect(page.getByTestId("timeline-selection-range")).toHaveCount(0);
    // a page box still goes to its page
    const position = (name: string) =>
        page.getByRole("button", {
            name: new RegExp(`^Playback position: ${name}\\b`),
        });
    await page.getByRole("button", { name: "Page 1", exact: true }).click();
    await expect(position("Page 1")).toBeVisible();
    await page.getByTestId("timeline-initial-page").click();
    await expect(position("Home")).toBeVisible();

    // a click and a marquee select; a drag moves no one
    await clickMarcher(page, "T1");
    await expect.poll(() => selectedDrillNumbers(page)).toEqual(["T1"]);
    await dragMarcher(page, "T1", { x: 80, y: 60 });
    await waitForIdle(page);
    expect(await savedPosition(show, 1)).toEqual(t1);
    await expect.poll(() => selectedDrillNumbers(page)).toEqual(["T1"]);
    const marchers = await drawnMarchers(page);
    const at = (drill: string) =>
        marchers.find((m) => m.drillNumber === drill)!.screen;
    const [f1, f2] = [at("F1"), at("F2")];
    await dragFrom(
        page,
        { x: f1.x - 15, y: f1.y - 15 },
        { x: f2.x - f1.x + 30, y: f2.y - f1.y + 30 },
    );
    await expect.poll(() => selectedDrillNumbers(page)).toEqual(["F1", "F2"]);
    // nor do the arrow keys nudge
    const f1Saved = await savedPosition(show, 3);
    await page.keyboard.press("ArrowUp");
    await waitForIdle(page);
    expect(await savedPosition(show, 3)).toEqual(f1Saved);

    // back in the Editor, the drill timeline and dragging are back
    await page.getByTestId("workspace-view-editor").click();
    await expect(page.locator("main")).toHaveAttribute(
        "data-workspace",
        "editor",
    );
    await expect(page.getByTestId("visuals-band")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Page 0" })).toBeVisible();
    await dragMarcher(page, "T1", { x: 80, y: 60 });
    await expect
        .poll(async () => (await savedPosition(show, 1)).x)
        .toBeGreaterThan(t1.x + 10);
});

test.describe("with a move off the page boxes", () => {
    // As move-and-drop's show: page 2 moves only T1 and T2, so the drill
    // timeline draws a clip for a move that isn't a page's
    test.use({
        seedSql: seedShowSql({
            beats: 48,
            pageStarts: [16, 32],
            measureStarts: Array.from({ length: 12 }, (_, i) => 1 + i * 4),
            marchers: [1, 2, 3, 4].map((id) => ({
                id,
                section: "Trumpet",
                prefix: "T",
                order: id,
            })),
            positions: [
                [
                    [1, 500, 300],
                    [2, 600, 350],
                    [3, 700, 280],
                    [4, 800, 400],
                ],
                [
                    [1, 520, 450],
                    [2, 640, 470],
                    [3, 760, 430],
                    [4, 880, 500],
                ],
                [
                    [1, 540, 380],
                    [2, 660, 400],
                ],
            ],
        }),
    });

    test("the drill clips are the Editor's: Visuals' timeline has none", async ({
        show,
    }) => {
        const { page } = show;
        await expect(
            page.getByRole("heading", { name: "Page 0" }),
        ).toBeVisible();
        const clips = page.getByTestId("timeline-clip");
        await expect(clips.first()).toBeVisible();
        const count = await clips.count();

        await page.getByTestId("workspace-view-visuals").click();
        await expect(page.getByTestId("visuals-band")).toBeVisible();
        await expect(clips).toHaveCount(0);

        await page.getByTestId("workspace-view-editor").click();
        await expect(clips).toHaveCount(count);
        await expect(page.getByTestId("visuals-band")).toHaveCount(0);
    });
});
