/**
 * The window finds the band's uniform by its asset id, so a version an item edit's save just
 * replaced still names it, and its views keep the last pack while the band moves to the next
 * version, never across uniforms (fork #1258).
 */
import { describe, expect, it } from "vitest";
import {
    keepSameUniform,
    uniformEntryOf,
    type StoredUniformPack,
    type UniformPackEntry,
} from "../useUniformPack";

const A = "0f0e0d0c-0b0a-4908-8706-050403020100";
const B = "1f0e0d0c-0b0a-4908-8706-050403020100";
const v = (id: string, n: number) => `library:${id}@${String(n).repeat(64)}`;

describe("the band's uniform by id", () => {
    it("finds a uniform from any version, even one no longer listed", () => {
        const packs: UniformPackEntry[] = [
            {
                id: A,
                value: v(A, 3),
                name: "Home",
                versions: [v(A, 1), v(A, 3)],
            },
        ];
        expect(uniformEntryOf(packs, v(A, 2))?.id).toBe(A);
        expect(uniformEntryOf(packs, v(B, 1))).toBeUndefined();
        expect(uniformEntryOf(packs, "sample")).toBeUndefined();
    });

    it("keeps the last pack for another version of the same uniform only", () => {
        const last = { value: v(A, 1) } as StoredUniformPack;
        expect(keepSameUniform(v(A, 2))(last)).toBe(last);
        expect(keepSameUniform(v(B, 2))(last)).toBeUndefined();
        expect(keepSameUniform(v(A, 2))(null)).toBeFalsy();
    });
});
