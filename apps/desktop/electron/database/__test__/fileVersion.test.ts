// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
    applyFileVersionDecision,
    decideFileVersion,
    isSupportedUserVersion,
    markOrderModelIfOrdered,
    MAX_SUPPORTED_USER_VERSION,
    MIN_SUPPORTED_USER_VERSION,
    NEW_FILE_USER_VERSION,
    readUserVersion,
} from "../fileVersion";

describe("file-format version", () => {
    it("supports the page model (7), the timeline model (8), the step-15 route model (10), the lane model (11), Adjust (12), trails (13), arc legs (14), outlines (17) and order marks (18)", () => {
        expect(MIN_SUPPORTED_USER_VERSION).toBe(7);
        expect(MAX_SUPPORTED_USER_VERSION).toBe(18);
        expect(NEW_FILE_USER_VERSION).toBe(8);
    });

    describe("decideFileVersion", () => {
        it("initializes a new, empty file to the new-file version", () => {
            expect(decideFileVersion(0, true)).toEqual({
                action: "initialize",
                version: NEW_FILE_USER_VERSION,
            });
        });

        it.each([7, 8, 10, 11, 12, 13, 14, 17, 18])(
            "accepts an existing file at %i",
            (version) => {
                expect(decideFileVersion(version, false)).toEqual({
                    action: "accept",
                    version,
                });
            },
        );

        it.each([7, 8, 10, 11, 12, 13, 14, 17, 18])(
            "accepts a 'new' file already at %i without rewriting it",
            (version) => {
                expect(decideFileVersion(version, true)).toEqual({
                    action: "accept",
                    version,
                });
            },
        );

        it.each([false, true])(
            "opens a parked floor-model file (9) as a timeline file, written as 8 (new: %s)",
            (isNewFile) => {
                expect(decideFileVersion(9, isNewFile)).toEqual({
                    action: "downgrade",
                    version: 8,
                });
            },
        );

        it.each([15, 16, 19, 42, 2 ** 31 - 1])(
            "refuses a file at %i as too new, new or not",
            (version) => {
                for (const isNewFile of [false, true]) {
                    expect(decideFileVersion(version, isNewFile)).toEqual({
                        action: "refuse-too-new",
                        version,
                    });
                }
            },
        );

        it.each([0, 1, 5, 6, -1, -(2 ** 31)])(
            "leaves an existing legacy file at %i unchanged (too old)",
            (version) => {
                expect(decideFileVersion(version, false)).toEqual({
                    action: "refuse-too-old",
                    version,
                });
            },
        );

        it("rejects a non-integer version", () => {
            expect(() => decideFileVersion(7.5, false)).toThrow();
            expect(() => decideFileVersion(Number.NaN, false)).toThrow();
        });
    });

    it("isSupportedUserVersion covers 7, 8, 10 to 14, 17 and 18, not 9, 15, 16 (steps not merged here) or past 18", () => {
        expect(
            [0, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(
                isSupportedUserVersion,
            ),
        ).toEqual([
            false,
            false,
            true,
            true,
            false,
            true,
            true,
            true,
            true,
            true,
            false,
            false,
            true,
            true,
            false,
        ]);
    });

    describe("markOrderModelIfOrdered (#1099)", () => {
        const fileWith = (version: number, kinds: readonly string[]) => {
            const db = new DatabaseSync(":memory:");
            db.exec(
                "CREATE TABLE timeline_shape_recipes (id INTEGER PRIMARY KEY, kind TEXT NOT NULL)",
            );
            for (const kind of kinds)
                db.prepare(
                    "INSERT INTO timeline_shape_recipes (kind) VALUES (?)",
                ).run(kind);
            db.prepare(`PRAGMA user_version = ${version}`).run();
            return db;
        };

        it.each(["order", "orderClear"])(
            "writes a file holding an %s mark as 18",
            (kind) => {
                for (const version of [8, 13, 17]) {
                    const db = fileWith(version, ["line", kind]);
                    markOrderModelIfOrdered(db);
                    expect(readUserVersion(db)).toBe(18);
                    db.close();
                }
            },
        );

        it("leaves a file with only shapes, or no recipe table, at its version", () => {
            const shapes = fileWith(13, ["line", "ungrouped"]);
            markOrderModelIfOrdered(shapes);
            expect(readUserVersion(shapes)).toBe(13);
            shapes.close();
            const bare = new DatabaseSync(":memory:");
            bare.prepare("PRAGMA user_version = 8").run();
            markOrderModelIfOrdered(bare);
            expect(readUserVersion(bare)).toBe(8);
            bare.close();
        });
    });

    describe("applyFileVersionDecision", () => {
        const withDb = (
            userVersion: number,
            fn: (db: DatabaseSync) => void,
        ) => {
            const db = new DatabaseSync(":memory:");
            try {
                db.prepare(`PRAGMA user_version = ${userVersion}`).run();
                fn(db);
            } finally {
                db.close();
            }
        };

        it("writes the version of a new file", () => {
            withDb(0, (db) => {
                applyFileVersionDecision(db, true);
                expect(readUserVersion(db)).toBe(NEW_FILE_USER_VERSION);
            });
        });

        it.each([
            [0, false],
            [6, false],
            [7, false],
            [8, false],
            [8, true],
            [1000, false],
        ])("never writes the version of a file at %i (new: %s)", (v, isNew) => {
            withDb(v, (db) => {
                applyFileVersionDecision(db, isNew);
                expect(readUserVersion(db)).toBe(v);
            });
        });

        it("writes a parked floor-model file (9) as 8", () => {
            withDb(9, (db) => {
                applyFileVersionDecision(db, false);
                expect(readUserVersion(db)).toBe(8);
            });
        });
    });
});
