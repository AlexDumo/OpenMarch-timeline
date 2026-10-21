import { expect } from "vitest";
import { describeDbTests, schema } from "@/test/base";
import {
    deleteShowSavedShape,
    getShowSavedShapes,
    putShowSavedShape,
} from "../savedShapes";

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
        expect(await getShowSavedShapes({ db })).toEqual([]);
        await putShowSavedShape({ db, shape: wide });
        expect(await getShowSavedShapes({ db })).toEqual([wide]);
        const renamed = { ...wide, name: "Wider", intervals: { across: 4 } };
        await putShowSavedShape({ db, shape: renamed });
        expect(await getShowSavedShapes({ db })).toEqual([renamed]);
    });

    it("deletes a copy by id", async ({ db }) => {
        await putShowSavedShape({ db, shape: wide });
        await putShowSavedShape({ db, shape: { ...wide, id: "b" } });
        await deleteShowSavedShape({ db, id: "a" });
        await deleteShowSavedShape({ db, id: "missing" });
        expect((await getShowSavedShapes({ db })).map((s) => s.id)).toEqual([
            "b",
        ]);
    });

    it("skips a row whose intervals don't read", async ({ db }) => {
        await putShowSavedShape({ db, shape: wide });
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
        expect((await getShowSavedShapes({ db })).map((s) => s.id)).toEqual([
            "a",
        ]);
    });
});
