// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
    applyFileVersionDecision,
    decideFileVersion,
    isSupportedUserVersion,
    markShapeAtCountModel,
    MAX_SUPPORTED_USER_VERSION,
    MIN_SUPPORTED_USER_VERSION,
    NEW_FILE_USER_VERSION,
    readUserVersion,
    SHAPE_AT_COUNT_USER_VERSION,
    UNKNOWN_USER_VERSIONS,
} from "../fileVersion";

describe("file-format version", () => {
    it("supports the page model (7), the timeline model (8), the step-15 route model (10), the lane model (11), Adjust (12), trails (13), arc legs (14) and shapes at a count (20)", () => {
        expect(MIN_SUPPORTED_USER_VERSION).toBe(7);
        expect(MAX_SUPPORTED_USER_VERSION).toBe(20);
        expect(SHAPE_AT_COUNT_USER_VERSION).toBe(20);
        // 15 to 19 are taken by pull requests not merged here (19: #1322's exact paths)
        expect(UNKNOWN_USER_VERSIONS).toEqual([15, 16, 17, 18, 19]);
        expect(NEW_FILE_USER_VERSION).toBe(8);
    });

    describe("decideFileVersion", () => {
        it("initializes a new, empty file to the new-file version", () => {
            expect(decideFileVersion(0, true)).toEqual({
                action: "initialize",
                version: NEW_FILE_USER_VERSION,
            });
        });

        it.each([7, 8, 10, 11, 12, 13, 14, 20])(
            "accepts an existing file at %i",
            (version) => {
                expect(decideFileVersion(version, false)).toEqual({
                    action: "accept",
                    version,
                });
            },
        );

        it.each([7, 8, 10, 11, 12, 13, 14, 20])(
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

        it.each([15, 16, 17, 18, 19, 21, 42, 2 ** 31 - 1])(
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

    it("isSupportedUserVersion covers exactly 7, 8, 10, 11, 12, 13, 14 and 20", () => {
        expect(
            [0, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map(
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
            false,
            false,
            false,
            true,
            false,
        ]);
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

describe("markShapeAtCountModel", () => {
    const fileWith = (
        userVersion: number,
        recipes: "beat" | "timeline_id" | null,
    ) => {
        const db = new DatabaseSync(":memory:");
        db.prepare(`PRAGMA user_version = ${userVersion}`).run();
        if (recipes === "beat")
            db.exec(
                "CREATE TABLE timeline_shape_recipes (id integer PRIMARY KEY, beat real NOT NULL)",
            );
        if (recipes === "timeline_id")
            db.exec(
                "CREATE TABLE timeline_shape_recipes (id integer PRIMARY KEY, timeline_id integer)",
            );
        return db;
    };

    it.each([8, 11, 14])(
        "writes a timeline file at %i that took 0030 as 20",
        (v) => {
            const db = fileWith(v, "beat");
            markShapeAtCountModel(db);
            expect(readUserVersion(db)).toBe(SHAPE_AT_COUNT_USER_VERSION);
            db.close();
        },
    );

    it.each([
        ["a page-model file waiting to convert", 7, "beat"],
        ["a file before 0030", 8, "timeline_id"],
        ["a file without recipes", 8, null],
        ["a file already at 20", 20, "beat"],
    ] as const)("leaves %s alone", (_, v, recipes) => {
        const db = fileWith(v, recipes);
        markShapeAtCountModel(db);
        expect(readUserVersion(db)).toBe(v);
        db.close();
    });
});
