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
});
