import { expect } from "vitest";
import { createResolver } from "@openmarch/core";
import { DbConnection, describeDbTests, schema } from "@/test/base";
import { readTimelineTables } from "@/timeline/timelineRows";
import { moveMarchersInTarget } from "../timelineMoves";
import { createItems, getItemGeometry, setItemGeometry } from "../items";

/**
 * C2.1's done-when: a prop is moved by the timeline like any marcher, and resized at a count with
 * no move. The show is `marchersAndPages`, converted: page 0 plus pages 1 to 6, 8 counts each.
 */

const beatsInOrder = async (db: DbConnection) =>
    db
        .select({ id: schema.beats.id })
        .from(schema.beats)
        .orderBy(schema.beats.position)
        .all();

const positionAt = async (db: DbConnection, marcherId: number, beat: number) =>
    createResolver((await readTimelineTables(db)).snapshot).positionAt(
        marcherId,
        beat,
    );

describeDbTests("items on the timeline", (it) => {
    it("moves a prop with the timeline and resizes it without moving it", async ({
        db,
        marchersAndPages: _,
    }) => {
        const beats = await beatsInOrder(db);
        const [prop] = await createItems({
            db,
            newItems: [
                {
                    kind: "prop",
                    home: [100, 100],
                    beatId: beats[0]!.id,
                    geometry: { outlineType: "rectangle", width: 2, depth: 1 },
                },
            ],
        });
        const id = prop!.marcher_id;

        // Moved over pages 1 and 2, as a canvas drag with the playhead on beat 17 does
        await moveMarchersInTarget({
            db,
            target: { kind: "range", start: 1, end: 17 },
            moves: [{ marcherId: id, x: 300, y: 200 }],
        });
        expect(await positionAt(db, id, 0)).toEqual([100, 100]);
        expect(await positionAt(db, id, 17)).toEqual([300, 200]);

        // Resized on beat 9, mid-move: the move is untouched
        const before = await positionAt(db, id, 9);
        await setItemGeometry({
            db,
            itemId: prop!.id,
            beatId: beats[9]!.id,
            geometry: { outlineType: "rectangle", width: 4, depth: 1 },
        });
        expect(await positionAt(db, id, 9)).toEqual(before);
        expect(await positionAt(db, id, 17)).toEqual([300, 200]);
        expect((await getItemGeometry({ db })).map((g) => g.width)).toEqual([
            2, 4,
        ]);
    });
});
