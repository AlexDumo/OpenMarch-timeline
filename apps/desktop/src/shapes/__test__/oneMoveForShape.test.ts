import { describe, expect, it } from "vitest";
import { oneMoveForShape } from "../tool/shapePlacement";

describe("oneMoveForShape: a shape's positions go to one move", () => {
    it("gives each call the members written there, and nothing for a move without them", () => {
        const inThisMove = oneMoveForShape([3, 1, 2]);
        expect(inThisMove([9])).toEqual([]);
        expect(inThisMove([2, 1, 3, 9])).toEqual([3, 1, 2]);
        expect(inThisMove([8])).toEqual([]);
    });

    it("refuses once a second move gets some of them: Held whole or not at all", () => {
        const inThisMove = oneMoveForShape([1, 2, 3]);
        expect(inThisMove([1, 2])).toEqual([1, 2]);
        expect(() => inThisMove([3])).toThrow(
            expect.objectContaining({
                name: "TimelineEditRefusedError",
                refusal: "shapePartlyHeld",
                marcherIds: [1, 2, 3],
            }),
        );
    });
});
