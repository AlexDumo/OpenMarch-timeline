import { describe, expect, it } from "vitest";
import type { UseQueryResult } from "@tanstack/react-query";
import type Marcher from "@/global/classes/Marcher";
import type { CollisionData } from "@/global/classes/CollisionDetection";
import { _combineCollisions } from "../useCollisionDetection";

const result = <T>(data: T) =>
    ({ data, isLoading: false, isError: false }) as UseQueryResult<T>;

const marcher = (id: number, drill_number: string, type: "marcher" | "item") =>
    ({ id, drill_number, type }) as unknown as Marcher;

const collision = (marcher1Id: number, marcher2Id: number) =>
    ({
        marcher1Id,
        marcher2Id,
        x: 0,
        y: 0,
        distance: 0,
    }) as unknown as CollisionData;

describe("_combineCollisions", () => {
    it("leaves out a collision with an item: a performer on a platform isn't colliding", () => {
        const { collisions } = _combineCollisions([
            result([
                marcher(1, "T1", "marcher"),
                marcher(2, "T2", "marcher"),
                marcher(3, "PROP1", "item"),
            ]),
            result([collision(1, 2), collision(1, 3)]),
        ]);
        expect(collisions?.map((c) => c.label)).toEqual(["T1, T2"]);
    });
});
