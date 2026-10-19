import { describe, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { describeDbTests, type DbConnection } from "@/test/base";
import { createItems } from "@/db-functions/items";
import {
    getMarcherRowsIncludingItems,
    getMarchers,
} from "@/db-functions/marcher";

vi.mock("@/App", () => ({ queryClient: undefined }));

const { allMarchersQueryOptions, allMarcherRowsQueryOptions, marcherKeys } =
    await import("../useMarchers");

/*
 * Items (props and equipment) are marchers rows of type `item` (props-spec section 4). The
 * marchers query and `getMarchers` give performers by default, so every "all marchers" loop
 * leaves items out unless it asks for the rows by name (C2.2 review).
 */

const addProp = async (db: DbConnection) => {
    const [item] = await createItems({
        db,
        newItems: [
            {
                kind: "prop",
                name: "Riser",
                surfaceType: "platform",
                home: [120, 80],
                beatId: 0,
                geometry: { outlineType: "rectangle", width: 2.4, depth: 1.2 },
            },
        ],
    });
    return item!.marcher_id;
};

describeDbTests("the marchers query", (it) => {
    describe("getMarchers", () => {
        it("gives the performers, and getMarcherRowsIncludingItems the items too", async ({
            db,
            marchers,
        }) => {
            const prop = await addProp(db);
            const performers = (await getMarchers({ db })).map((m) => m.id);
            expect(performers).toHaveLength(marchers.expectedMarchers.length);
            expect(performers).not.toContain(prop);
            expect(
                (await getMarcherRowsIncludingItems({ db })).map((m) => m.id),
            ).toEqual(expect.arrayContaining([...performers, prop]));
        });
    });

    describe("query options", () => {
        it("allMarchersQueryOptions leaves items out; allMarcherRowsQueryOptions keeps them", async ({
            db,
            marchers,
        }) => {
            const prop = await addProp(db);
            const qc = new QueryClient();
            const performers = await qc.fetchQuery(allMarchersQueryOptions());
            const rows = await qc.fetchQuery(allMarcherRowsQueryOptions());
            expect(performers).toHaveLength(marchers.expectedMarchers.length);
            expect(performers.map((m) => m.id)).not.toContain(prop);
            expect(rows.find((m) => m.id === prop)?.drill_number).toBe("PROP1");
        });

        it("invalidating the marchers invalidates the rows too", async ({
            db,
            marchers,
        }) => {
            // The queries read the fixture's database, which opens with `db`
            expect(db && marchers).toBeDefined();
            const qc = new QueryClient();
            await qc.fetchQuery(allMarchersQueryOptions());
            await qc.fetchQuery(allMarcherRowsQueryOptions());
            await qc.invalidateQueries({
                queryKey: marcherKeys.all(),
                refetchType: "none",
            });
            for (const { queryKey } of [
                allMarchersQueryOptions(),
                allMarcherRowsQueryOptions(),
            ])
                expect(qc.getQueryState(queryKey)?.isInvalidated).toBe(true);
        });
    });
});
