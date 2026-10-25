import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { mirrorAcross50 } from "../mirror";

const base = {
    angle: 0,
    groupIds: ["g1"],
    boundElements: null,
    isDeleted: false,
    version: 4,
    versionNonce: 1,
    seed: 1,
    frameId: null,
    index: "a0",
} as const;

describe("mirror across the 50", () => {
    it("flips shapes, lines and bound text to the other side with new ids", () => {
        const rect = {
            ...base,
            id: "r",
            type: "rectangle",
            x: -200,
            y: -100,
            width: 50,
            height: 20,
            boundElements: [{ id: "t", type: "text" }],
        };
        const text = {
            ...base,
            id: "t",
            type: "text",
            x: -190,
            y: -95,
            width: 30,
            height: 10,
            containerId: "r",
        };
        const line = {
            ...base,
            id: "l",
            type: "line",
            x: -100,
            y: -50,
            width: 40,
            height: 10,
            points: [
                [0, 0],
                [40, 10],
            ],
        };
        const out = mirrorAcross50([
            rect,
            text,
            line,
        ] as unknown as ExcalidrawElement[]);
        type Copy = {
            id: string;
            x: number;
            containerId?: string;
            points?: number[][];
            boundElements: unknown;
        };
        const [r, t, l] = out as unknown as Copy[];
        expect(r!.x).toBe(150);
        expect(t!.x).toBe(160);
        expect(l!.x).toBe(100);
        expect(l!.points).toEqual([
            [0, 0],
            [-40, 10],
        ]);
        expect(new Set(out.map((e) => e.id)).size).toBe(3);
        expect(out.map((e) => e.id)).not.toContain("r");
        // Links stay inside the copy
        expect(t!.containerId).toBe(r!.id);
        expect(r!.boundElements).toEqual([{ id: t!.id, type: "text" }]);
        // One new group for the copies, the same for all
        expect(new Set(out.map((e) => e.groupIds[0])).size).toBe(1);
        expect(out[0]!.groupIds[0]).not.toBe("g1");
        expect(out.every((e) => e.version === 1 && !e.isDeleted)).toBe(true);
    });
});
