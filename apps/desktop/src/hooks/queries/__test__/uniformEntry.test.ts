/**
 * The window finds the band's uniform by its asset id, so a version an item edit's save just
 * replaced still names it, and its views keep the last pack while the band moves to the next
 * version, never across uniforms (fork #1258).
 */
import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { UniformPackJobError } from "@/view3d/uniformPack/protocol";
import {
    keepSameUniform,
    noteUniformPackDamaged,
    uniformPackQueryOptions,
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

describe("a uniform's art that didn't compose", () => {
    const value = v(A, 4);
    const key = uniformPackQueryOptions(value).queryKey;
    const read = { value } as StoredUniformPack;

    it("marks the pack unreadable when the worker refused its image", () => {
        const qc = new QueryClient();
        qc.setQueryData(key, read);
        expect(
            noteUniformPackDamaged(
                qc,
                value,
                new UniformPackJobError("unreadable", "won't decode"),
            ),
        ).toBe(true);
        expect(qc.getQueryData(key)).toBeNull();
    });

    it("marks nothing when the worker ran out of time or died", () => {
        const qc = new QueryClient();
        qc.setQueryData(key, read);
        for (const error of [
            new UniformPackJobError("timedOut", "no answer"),
            new UniformPackJobError("failed", "the worker failed"),
            new Error("out of memory"),
        ])
            expect(noteUniformPackDamaged(qc, value, error)).toBe(false);
        expect(qc.getQueryData(key)).toBe(read);
    });

    it("retries a read only when the failure says nothing about the file", () => {
        const retry = uniformPackQueryOptions(value).retry as (
            failures: number,
            error: Error,
        ) => boolean;
        expect(retry(0, new UniformPackJobError("failed", "died"))).toBe(true);
        expect(retry(0, new UniformPackJobError("timedOut", "slow"))).toBe(
            true,
        );
        expect(retry(3, new UniformPackJobError("failed", "died"))).toBe(false);
        expect(retry(0, new UniformPackJobError("damaged", "bad zip"))).toBe(
            false,
        );
    });
});
