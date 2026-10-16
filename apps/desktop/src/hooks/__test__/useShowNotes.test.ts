import { expect } from "vitest";
import { createResolver, type XY } from "@openmarch/core";
import { describeDbTests, schema, type DbConnection } from "@/test/base";
import { readTimelineTables } from "@/timeline/timelineRows";
import {
    createItems,
    getItemPlacements,
    getItems,
    getMarchers,
    setItemPlacement,
    snapItemToHolder,
    type NewItemArgs,
} from "@/db-functions";
import { readPageGrid } from "@/db-functions/timelineRipple";
import {
    getWorkspaceSettingsParsed,
    updateWorkspaceSettingsParsed,
} from "@/db-functions/workspaceSettings";
import { moveMarchersInTarget } from "@/db-functions/timelineMoves";
import { dbMarcherToMarcher } from "@/global/classes/Marcher";
import { notesForItem } from "@/notes/showNotes";
import { showNotesFrom } from "../useShowNotes";

// Performers in the marchersAndPages fixture
const ALICE = 1;
const CREW = 3;

/** What the hook's queries read, read the same way, and positions from a fresh resolver. */
const notesOf = async (db: DbConnection) => {
    const resolver = createResolver((await readTimelineTables(db)).snapshot);
    const ids = new Set(resolver.marcherIds());
    return showNotesFrom(
        {
            items: await getItems({ db }),
            placements: await getItemPlacements({ db }),
            grid: await db.transaction((tx) => readPageGrid(tx)),
            marchers: (await getMarchers({ db })).map(dbMarcherToMarcher),
            settings: await getWorkspaceSettingsParsed({ db }),
            fieldProperties: undefined,
        },
        (marcherId, beat): XY | null =>
            ids.has(marcherId) ? resolver.positionAt(marcherId, beat) : null,
    );
};

const move = (
    db: DbConnection,
    marcherId: number,
    range: { start: number; end: number },
    at: XY,
) =>
    moveMarchersInTarget({
        db,
        target: { kind: "range", ...range },
        moves: [{ marcherId, x: at[0], y: at[1] }],
    });

const item = (
    kind: "prop" | "equipment",
    name: string,
    beatId: number,
): NewItemArgs => ({
    kind,
    name,
    surfaceType: kind === "prop" ? "platform" : undefined,
    home: [0, 0],
    beatId,
    geometry: { outlineType: "rectangle", width: 1, depth: 1 },
});

describeDbTests("useShowNotes", (it) => {
    it("shows the four first producers in the list and on their item, from a real show", async ({
        db,
        marchersAndPages,
    }) => {
        expect(marchersAndPages).toBeDefined();
        const beats = await db
            .select({ id: schema.beats.id })
            .from(schema.beats)
            .orderBy(schema.beats.position, schema.beats.id)
            .all();
        const beat = (n: number) => beats[n]!.id;
        await move(db, ALICE, { start: 0, end: 8 }, [100, 100]);
        await move(db, CREW, { start: 0, end: 8 }, [300, 300]);
        const [flag, rifle, riser, cart] = await createItems({
            db,
            newItems: [
                item("equipment", "Flag", beat(0)),
                item("equipment", "Rifle", beat(0)),
                item("prop", "Riser", beat(0)),
                item("prop", "Cart", beat(0)),
            ],
        });

        // Alice holds the flag from 10 and takes the rifle in her right hand on 11
        await setItemPlacement({
            db,
            itemId: flag!.id,
            beatId: beat(10),
            placement: {
                state: "held",
                holders: [{ marcherId: ALICE, hand: "both" }],
            },
        });
        await setItemPlacement({
            db,
            itemId: rifle!.id,
            beatId: beat(11),
            placement: {
                state: "held",
                holders: [{ marcherId: ALICE, hand: "right" }],
            },
        });
        // She puts the flag down on 12, then her drill changes there
        const putDown = await setItemPlacement({
            db,
            itemId: flag!.id,
            beatId: beat(12),
            placement: { state: "placed" },
        });
        await move(db, ALICE, { start: 8, end: 12 }, [180, 100]);
        // The riser's crew stands across the field
        await setItemPlacement({
            db,
            itemId: riser!.id,
            beatId: beat(4),
            placement: { state: "placed", crew: [CREW] },
        });
        // The cart moves on its own
        await move(db, cart!.marcher_id, { start: 16, end: 20 }, [40, 0]);

        const quiet = await notesOf(db);
        expect(
            quiet.notes.map((n) => [n.kind, quiet.itemName(n.itemId)]),
        ).toEqual([
            ["crew_distance", "Riser"],
            ["hand_conflict", "Flag"],
            ["put_down_drift", "Flag"],
        ]);

        // The show setting turns on the crew-less move note
        const settings = await getWorkspaceSettingsParsed({ db });
        await updateWorkspaceSettingsParsed({
            db,
            settings: { ...settings, warnPropMovesWithoutCrew: true },
        });
        const { notes, itemName, marcherName } = await notesOf(db);
        expect(notes.map((n) => [n.kind, itemName(n.itemId), n.beat])).toEqual([
            ["crew_distance", "Riser", 4],
            ["hand_conflict", "Flag", 11],
            ["put_down_drift", "Flag", 12],
            ["crewless_move", "Cart", 17],
        ]);
        expect(notesForItem(notes, flag!.id).map((n) => n.kind)).toEqual([
            "hand_conflict",
            "put_down_drift",
        ]);
        const drift = notes.find((n) => n.kind === "put_down_drift")!;
        expect(drift.action).toEqual({
            kind: "snap_to_holder",
            placementId: putDown.id,
        });
        expect(drift.marcherIds.map(marcherName)).toEqual(["T1"]);

        // Snap to holder clears the drift note
        await snapItemToHolder({ db, placementId: putDown.id });
        expect(
            (await notesOf(db)).notes.some((n) => n.kind === "put_down_drift"),
        ).toBe(false);
    });
});
