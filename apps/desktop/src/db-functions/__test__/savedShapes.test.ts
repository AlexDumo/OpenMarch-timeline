import { expect } from "vitest";
import { describeDbTests, schema, type DbConnection } from "@/test/base";
import {
    createSavedShapeInTransaction,
    deleteSavedShapeInTransaction,
    getSavedShapes,
    type SavedShape,
} from "../savedShapes";

const create = (db: DbConnection, shape: SavedShape) =>
    db.transaction((tx) => createSavedShapeInTransaction({ tx, shape }));
const remove = (db: DbConnection, id: string) =>
    db.transaction((tx) => deleteSavedShapeInTransaction({ tx, id }));

const wide = {
    id: "a",
    name: "Wide box",
    kind: "block",
    kindVersion: 1,
    intervals: { across: 3, deep: 1.5 },
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
};

const staggered: SavedShape = {
    ...wide,
    id: "s",
    name: "Staggered block",
    description: "Opener, front of the 30",
    distribution: {
        mode: "files",
        layout: { family: "shortBack", byFile: false },
        stagger: [1, 3],
    },
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-02T15:30:00.000Z",
};

describeDbTests("savedShapes", (it) => {
    it("keeps a copy of a saved shape, and brings it up to date", async ({
        db,
    }) => {
        expect(await getSavedShapes({ db })).toEqual([]);
        await create(db, wide);
        expect(await getSavedShapes({ db })).toEqual([wide]);
        const renamed = { ...wide, name: "Wider", intervals: { across: 4 } };
        await create(db, renamed);
        expect(await getSavedShapes({ db })).toEqual([renamed]);
    });

    it("deletes a copy by id", async ({ db }) => {
        await create(db, wide);
        await create(db, { ...wide, id: "b" });
        await remove(db, "a");
        await remove(db, "missing");
        expect((await getSavedShapes({ db })).map((s) => s.id)).toEqual(["b"]);
    });

    it("skips a row whose intervals don't read", async ({ db }) => {
        await create(db, wide);
        await db
            .insert(schema.saved_shapes)
            .values({
                id: "bad",
                name: "Bad",
                kind: "block",
                kind_version: 1,
                intervals: '{"across":"wide"}',
            })
            .run();
        expect((await getSavedShapes({ db })).map((s) => s.id)).toEqual(["a"]);
    });

    it("keeps the description, distribution and dates as the library has them", async ({
        db,
    }) => {
        await create(db, staggered);
        expect(await getSavedShapes({ db })).toEqual([staggered]);
    });

    it("updating a copy takes its new updated date and keeps the created one", async ({
        db,
    }) => {
        await create(db, staggered);
        const changed: SavedShape = {
            ...staggered,
            name: "Block ⅓",
            description: undefined,
            distribution: { mode: "spread", generator: 1 },
            createdAt: "2026-10-05T00:00:00.000Z",
            updatedAt: "2026-10-06T00:00:00.000Z",
        };
        await create(db, changed);
        const [copy] = await getSavedShapes({ db });
        expect(copy).toEqual({
            ...staggered,
            name: "Block ⅓",
            description: undefined,
            distribution: { mode: "spread", generator: 1 },
            updatedAt: "2026-10-06T00:00:00.000Z",
        });
        expect(copy).not.toHaveProperty("description");
    });

    it("dates the copy of an old library entry that has no dates", async ({
        db,
    }) => {
        const { createdAt: _c, updatedAt: _u, ...old } = wide;
        await create(db, { ...old, id: "old" });
        const [copy] = await getSavedShapes({ db });
        expect(copy!.createdAt).toEqual(expect.any(String));
        expect(copy!.updatedAt).toBe(copy!.createdAt);
    });

    it("leaves out a distribution that doesn't read, keeping the shape", async ({
        db,
    }) => {
        await db
            .insert(schema.saved_shapes)
            .values({
                id: "odd",
                name: "Odd",
                kind: "block",
                kind_version: 1,
                intervals: "{}",
                distribution: '{"layout":"no mode"}',
            })
            .run();
        const [copy] = await getSavedShapes({ db });
        expect(copy!.id).toBe("odd");
        expect(copy).not.toHaveProperty("distribution");
    });
});
