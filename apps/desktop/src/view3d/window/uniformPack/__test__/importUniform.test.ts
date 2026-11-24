// cspell:words omasset
import { describe, expect, it, vi } from "vitest";
import { SAMPLE_FLATS } from "@/view3d/core/marchers/uniformArtwork";
import {
    lookOfManifest,
    readUniformPack,
    writeUniformPack,
} from "@/view3d/core/uniformPack/format";
import type { PageRegions } from "@/view3d/core/uniformPack/pageChecks";
import {
    fakePng,
    sampleManifest,
} from "@/view3d/core/uniformPack/__test__/fixtures";
import type {
    UniformPackRequest,
    UniformPackResponse,
} from "@/view3d/uniformPack/protocol";

// the worker itself needs a browser; these tests stand in for it
vi.mock("@/view3d/uniformPack/runUniformPackJob", () => ({
    runUniformPackJob: vi.fn(),
    UniformPackJobError: class extends Error {},
}));

const {
    UniformImportError,
    importUniformFile,
    isPageViewBox,
    sizedSvg,
    svgViewBox,
    uniformFileKind,
} = await import("../importUniform");

const regions: PageRegions = { panels: {}, regions: [] };
const look = SAMPLE_FLATS.look;

const fileOf = (name: string, bytes: Uint8Array | string) => {
    const data =
        typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
    return {
        name,
        size: data.byteLength,
        arrayBuffer: async () => data.slice().buffer,
    };
};

/** A worker that answers every page job with `png` and `notes` */
const worker = (
    png: Uint8Array,
    notes: ("empty" | "opaque" | "template")[] = [],
    scaledFrom: { width: number; height: number } | null = null,
) => {
    const requests: UniformPackRequest[] = [];
    const runJob = vi.fn(async (request: UniformPackRequest) => {
        requests.push(request);
        return {
            type: "page",
            png,
            notes,
            scaledFrom,
        } as Exclude<UniformPackResponse, { type: "refused" }>;
    });
    return { runJob, requests };
};

describe("importing a uniform", () => {
    it("turns a PNG into a one-layer pack named after the file, decoded in the worker", async () => {
        const stored = fakePng(3360, 2816, 3);
        const { runJob, requests } = worker(stored, ["template"], {
            width: 1680,
            height: 1408,
        });
        const result = await importUniformFile(
            fileOf("Home Uniform.png", fakePng(1680, 1408)),
            look,
            regions,
            { runJob },
        );
        expect(requests.map((r) => r.type)).toEqual(["png"]);
        expect(result.name).toBe("Home Uniform");
        expect(result.notes).toEqual(["scaled", "template", "palette"]);
        expect(result.scaledFrom).toEqual({ width: 1680, height: 1408 });
        const pack = readUniformPack(result.pack);
        expect(pack.manifest.name).toBe("Home Uniform");
        expect(lookOfManifest(pack.manifest)).toEqual(look);
        expect(Array.from(pack.layers[0].png)).toEqual(Array.from(stored));
    });

    it("draws an SVG at the template's size and checks the pixels in the worker", async () => {
        const stored = fakePng(3360, 2816, 4);
        const { runJob, requests } = worker(stored);
        const drawSvg = vi.fn(
            async () => new Uint8ClampedArray(3360 * 2816 * 4),
        );
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 105 88"><rect width="10" height="10"/></svg>`;
        const result = await importUniformFile(
            fileOf("away.svg", svg),
            look,
            regions,
            { runJob, drawSvg },
        );
        expect(drawSvg).toHaveBeenCalledWith(svg);
        expect(requests[0]).toMatchObject({
            type: "pixels",
            width: 3360,
            height: 2816,
        });
        // the parts the art leaves clear take the preset's colors, and it says so
        expect(result.notes).toEqual(["palette"]);
        expect(readUniformPack(result.pack).manifest.name).toBe("away");
    });

    it("notes an SVG whose viewBox isn't the page in inches", async () => {
        const { runJob } = worker(fakePng());
        const drawSvg = async () => new Uint8ClampedArray(3360 * 2816 * 4);
        const result = await importUniformFile(
            fileOf("px.svg", `<svg viewBox="0 0 3360 2816"></svg>`),
            look,
            regions,
            { runJob, drawSvg },
        );
        expect(result.notes).toEqual(["svgViewBox", "palette"]);
    });

    it("reads a saved uniform file in the worker and keeps it exactly as it is", async () => {
        const bytes = writeUniformPack(sampleManifest("Saved"), {
            "layers/base.png": fakePng(),
        });
        const requests: UniformPackRequest[] = [];
        const runJob = vi.fn(async (request: UniformPackRequest) => {
            requests.push(request);
            // the worker reads the pack it's given
            const read = readUniformPack(
                (request as { bytes: Uint8Array }).bytes,
            );
            return {
                type: "pack",
                manifest: read.manifest,
                notes: ["opaque"],
            } as Exclude<UniformPackResponse, { type: "refused" }>;
        });
        const result = await importUniformFile(
            fileOf("Saved.omasset", bytes),
            look,
            regions,
            { runJob },
        );
        expect(requests.map((r) => r.type)).toEqual(["pack"]);
        expect(Array.from(result.pack)).toEqual(Array.from(bytes));
        expect(result.name).toBe("Saved");
        // a saved file carries its own palette: no palette note
        expect(result.notes).toEqual(["opaque"]);
    });

    it("refuses a PDF and files it doesn't know, saying which", async () => {
        const { runJob } = worker(fakePng());
        await expect(
            importUniformFile(fileOf("flats.pdf", "%PDF-1.7"), look, regions, {
                runJob,
            }),
        ).rejects.toMatchObject({ code: "pdf" });
        await expect(
            importUniformFile(fileOf("notes.txt", "hello"), look, regions, {
                runJob,
            }),
        ).rejects.toBeInstanceOf(UniformImportError);
        expect(runJob).not.toHaveBeenCalled();
    });
});

describe("reading SVG text", () => {
    it("finds the root's viewBox and tells the page from other boxes", () => {
        expect(
            svgViewBox(`<?xml version="1.0"?><svg viewBox="0 0 105 88">`),
        ).toEqual([0, 0, 105, 88]);
        expect(isPageViewBox(svgViewBox(`<svg viewBox='0,0,105,88'>`))).toBe(
            true,
        );
        expect(isPageViewBox(svgViewBox(`<svg viewBox="0 0 3360 2816">`))).toBe(
            false,
        );
        expect(svgViewBox(`<svg width="10">`)).toBeNull();
    });

    it("sizes the root to the template in place of its own size", () => {
        expect(
            sizedSvg(
                `<svg width="105in" height='88in' viewBox="0 0 105 88"><g/></svg>`,
                3360,
                2816,
            ),
        ).toBe(
            `<svg width="3360" height="2816" viewBox="0 0 105 88"><g/></svg>`,
        );
    });

    it("tells file kinds by name, then by their first bytes", () => {
        expect(uniformFileKind("a.PNG", new Uint8Array())).toBe("png");
        expect(uniformFileKind("a.omasset", new Uint8Array())).toBe("pack");
        expect(uniformFileKind("a", new Uint8Array([0x50, 0x4b]))).toBe("pack");
        expect(uniformFileKind("a", new Uint8Array([0x25, 0x50]))).toBe("pdf");
        expect(uniformFileKind("a", new Uint8Array([0x89, 0x50]))).toBe("png");
    });
});
