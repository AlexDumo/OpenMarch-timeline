/**
 * A wear whose atlases are already composed reaches the marchers in the same render as its
 * palette (fork #1257 step 5, found with the GPU recording: the new mode's colors showed on the
 * old mode's art for 3–11 frames while the atlases resolved a second time).
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const composed = new Set<string>();
vi.mock("../flatsAtlas", () => ({
    acquireFlats: () => new Promise(() => {}),
    releaseFlats: () => undefined,
    loadFlatsLut: () => new Promise(() => {}),
    loadFlatsGeometry: () => new Promise(() => {}),
    peekFlatsResources: (id: string, body: string) =>
        composed.has(`${id}|${body}`)
            ? { atlas: { id }, lut: {}, layout: {} }
            : null,
}));

const { useMarcherFlats } = await import("../useMarcherFlats");

const look = (artwork: string) =>
    ({
        uniform: { options: { artwork } },
        body: { bodyType: "average", heightClass: 0 },
    }) as never;

describe("useMarcherFlats with composed atlases", () => {
    it("uses atlases already composed in the render that asks for them", () => {
        const plain = "library:a@1#plain";
        const sash = "library:a@1#sash";
        const { result, rerender } = renderHook(
            ({ art }) => useMarcherFlats([look(art)], "high"),
            { initialProps: { art: plain } },
        );
        // nothing composed: nothing on the marchers yet
        expect(result.current.size).toBe(0);
        composed.add(`${sash}|average`);
        rerender({ art: sash });
        const entry = [...result.current.entries()][0];
        expect(entry[0]).toBe(`${sash}|average`);
        expect(
            (entry[1] as unknown as { atlas: { id: string } }).atlas.id,
        ).toBe(sash);
    });
});
