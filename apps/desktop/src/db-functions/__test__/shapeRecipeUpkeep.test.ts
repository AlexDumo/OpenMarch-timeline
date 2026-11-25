import { afterEach, expect, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { describeDbTests, schema, type DbConnection } from "@/test/base";
import { transactionWithHistory } from "../history";
import { deleteTimeline } from "../timelineCommands";
import { readAllShapeRecipes } from "../shapeRecipes";

/**
 * The upkeep that stands in for the cascade from moves (`shapeRecipeUpkeep.ts`) runs after every
 * edit, so it must cost nothing on edits that remove no arrival, stay cheap on a big show, and never
 * bind one SQL variable per row (SQLite allows 32,766).
 */

afterEach(() => vi.restoreAllMocks());

/**
 * `marchers` marchers, `pages` back-to-back 8-count moves of all of them, and a shape of everyone at
 * the end of each move: `marchers × pages` arrival rows and as many member rows
 */
async function bigShow(db: DbConnection, marchers: number, pages: number) {
    const statements = [
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${marchers})
         INSERT INTO marchers (id, section, drill_prefix, drill_order) SELECT i, 'Brass', 'B', i FROM n`,
        `WITH RECURSIVE p(t) AS (SELECT 1 UNION ALL SELECT t + 1 FROM p WHERE t < ${pages})
         INSERT INTO timelines (id, start_beat, end_beat) SELECT t, 8 * (t - 1), 8 * t FROM p`,
        `INSERT INTO timeline_transitions (id, timeline_id, path_style, slot_count, start_beat, end_beat)
         SELECT id, id, 'direct', ${marchers}, start_beat, end_beat FROM timelines`,
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${marchers})
         INSERT INTO timeline_slot_destinations (transition_id, slot_index, x, y)
         SELECT t.id, n.i - 1, n.i, t.id FROM timeline_transitions t, n`,
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${marchers})
         INSERT INTO timeline_assignments (marcher_id, transition_id, slot_index, start_beat, end_beat)
         SELECT n.i, t.id, n.i - 1, t.start_beat, t.end_beat FROM timeline_transitions t, n`,
        `INSERT INTO timeline_shape_recipes (id, beat, shape_key, kind, kind_version, params, order_mode)
         SELECT id, end_beat, id, 'line', 1, '{}', 'keep' FROM timelines`,
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${marchers})
         INSERT INTO timeline_shape_recipe_marchers (recipe_id, marcher_id, slot, x, y)
         SELECT r.id, n.i, n.i - 1, n.i, r.id FROM timeline_shape_recipes r, n`,
        // Rows written around the write wrapper: nothing for the first edit to read
        `DELETE FROM timeline_change_log`,
    ];
    for (const statement of statements) await db.run(sql.raw(statement));
}

const timed = async (run: () => Promise<unknown>) => {
    const start = performance.now();
    await run();
    return performance.now() - start;
};

describeDbTests("Shape recipe upkeep on a big show", (it) => {
    it("300 marchers × 110 pages: edits bind no row-per-variable list, and deleting a page's move deletes its shape", async ({
        db,
    }) => {
        await bigShow(db, 300, 110);
        // An edit that removes no arrival
        const rename = await timed(() =>
            transactionWithHistory(db, "rename", (tx) =>
                tx
                    .update(schema.marchers)
                    .set({ name: "Renamed" })
                    .where(eq(schema.marchers.id, 1))
                    .run(),
            ),
        );
        // An edit that removes the arrivals of every member of the last page's shape
        const remove = await timed(() =>
            deleteTimeline({ db, timelineId: 110 }),
        );
        const beats = (await readAllShapeRecipes(db)).map((r) => r.beat);
        expect(beats).toHaveLength(109);
        expect(beats).not.toContain(880);
        expect(beats).toContain(872);
        // Timings for the record (the pull request quotes them), not a pass condition
        process.stdout.write(
            `upkeep on 300 × 110: rename ${rename.toFixed(0)} ms, delete move ${remove.toFixed(0)} ms\n`,
        );
    });
});
