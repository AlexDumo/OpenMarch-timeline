// @vitest-environment node
/**
 * 0024 adds a prop's lift and tilts to its Outline changes (fork #1087): a file from before it
 * keeps every change, on the ground and level, and ends with a new file's schema.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    createNewTimelineShow,
    withDb,
} from "../../__test__/convertOnOpenFixtures";
import { rollBackMigrationsFrom } from "../../__test__/migrationRollback";
import {
    migrateFile,
    normalizedSchema,
} from "../../legacyFork/__test__/forkFileFixtures";

describe("0024_item_pose", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-0024-"));
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    const columns = (file: string) =>
        withDb(file, (db) =>
            (
                db
                    .prepare(
                        "SELECT name FROM pragma_table_info('item_geometry')",
                    )
                    .all() as { name: string }[]
            ).map((c) => c.name),
        );

    it("adds the columns in place: every Outline change stays, on the ground and level", async () => {
        const file = path.join(dir, "show.dots");
        await createNewTimelineShow(file);
        const fresh = withDb(file, normalizedSchema);
        rollBackMigrationsFrom(file, 24);
        expect(columns(file)).not.toContain("elevation");
        withDb(file, (db) =>
            db.exec(`
                INSERT INTO marchers (id, section, drill_prefix, drill_order) VALUES (1, 'Prop', 'PROP', 1);
                INSERT INTO items (id, marcher_id, kind, surface_type) VALUES (3, 1, 'prop', 'platform');
                INSERT INTO item_geometry (id, item_id, beat_id, outline_type, width, depth, height, rotation)
                    VALUES (5, 3, (SELECT MIN(id) FROM beats), 'rectangle', 2, 1, 0.5, 30);
            `),
        );

        await migrateFile(file);

        expect(withDb(file, normalizedSchema)).toEqual(fresh);
        expect(
            withDb(file, (db) =>
                db
                    .prepare(
                        "SELECT id, rotation, elevation, pitch, roll FROM item_geometry",
                    )
                    .all(),
            ),
        ).toEqual([{ id: 5, rotation: 30, elevation: 0, pitch: 0, roll: 0 }]);
    });
});
