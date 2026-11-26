// @vitest-environment node
// cspell:words omasset Kiritimati Pago
/**
 * A committed version 3 pack file (Sample modes, fork #1257 step 5): this build reads it and still
 * writes the same bytes; step 4's reader, copied verbatim in `step4Format.ts`, refuses it; and
 * the uniform pack worker's `flatten` draws each mode's layers from it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { UniformPackError, flattenPlan, readUniformPack } from "../format";
import * as step4 from "./step4Format";
import { sampleModesV3 } from "./sampleModesV3";
import { fakePng } from "./fixtures";

const file = () =>
    new Uint8Array(
        readFileSync(
            resolve(__dirname, "fixtures-files/sample-modes-v3.omasset"),
        ),
    );

const codeOf = (fn: () => unknown) => {
    try {
        fn();
    } catch (error) {
        if (
            error instanceof UniformPackError ||
            error instanceof step4.UniformPackError
        )
            return error.code;
        return String(error);
    }
    return null;
};

describe("the version 3 pack file", () => {
    it("reads, and is what this build still writes", () => {
        const read = readUniformPack(file());
        expect(read.manifest.formatVersion).toBe(3);
        expect(read.manifest.modes?.map((m) => m.name)).toEqual([
            "Plain",
            "Sash out",
            "Sash out, unzipped",
        ]);
        expect(Array.from(sampleModesV3())).toEqual(Array.from(file()));
    });

    it("is refused as newer by step 4's reader, and its schema refuses the manifest too", () => {
        expect(codeOf(() => step4.readUniformPack(file()))).toBe("newer");
        const manifest = readUniformPack(file()).manifest;
        expect(
            step4.uniformPackManifestSchema.safeParse(manifest).success,
        ).toBe(false);
        // even labelled version 2, step 4 refuses the modes it reserved
        expect(
            step4.uniformPackManifestSchema.safeParse({
                ...manifest,
                formatVersion: 2,
            }).success,
        ).toBe(false);
    });
});

describe("the same pack in any timezone", () => {
    it("writes the same bytes, stamped 1980-01-01 12:00, under every TZ", () => {
        const before = process.env.TZ;
        const out: Record<string, number[]> = {};
        try {
            for (const tz of [
                "UTC",
                "America/New_York",
                "Pacific/Kiritimati",
                "Pacific/Pago_Pago",
            ]) {
                process.env.TZ = tz;
                out[tz] = Array.from(sampleModesV3());
            }
        } finally {
            if (before === undefined) delete process.env.TZ;
            else process.env.TZ = before;
        }
        // the zone really changed for the Date the writer reads
        process.env.TZ = "Pacific/Kiritimati";
        const plus14Hour = new Date(Date.UTC(1980, 0, 1, 12)).getHours();
        if (before === undefined) delete process.env.TZ;
        else process.env.TZ = before;
        expect(plus14Hour).toBe(2);
        for (const bytes of Object.values(out)) expect(bytes).toEqual(out.UTC);
        expect(out.UTC).toEqual(Array.from(file()));
        // the first local header's DOS time and date: 12:00:00 on 1980-01-01
        const view = new DataView(new Uint8Array(out.UTC).buffer);
        expect(view.getUint16(10, true)).toBe(12 << 11);
        expect(view.getUint16(12, true)).toBe((0 << 9) | (1 << 5) | 1);
    });
});

describe("what the worker's flatten draws", () => {
    const pack = () => readUniformPack(file());
    const files = (plan: ReturnType<typeof flattenPlan>) =>
        plan.images.map((p) => p.file);

    it("draws a mode's layers and answers with its items, the default for an unknown mode", () => {
        const sash = flattenPlan(pack(), { mode: "sash-out-c3d4" });
        expect(files(sash)).toEqual(["layers/base.png", "layers/sash.png"]);
        expect(sash.items.map((i) => i.id)).toEqual(["number"]);
        const open = flattenPlan(pack(), { mode: "sash-out-unzipped-e5f6" });
        expect(files(open)).toEqual([
            "layers/base.png",
            "layers/sash.png",
            "layers/open-front.png",
        ]);
        for (const mode of [null, undefined, "removed-0000"])
            expect(files(flattenPlan(pack(), { mode }))).toEqual([
                "layers/base.png",
            ]);
        expect(flattenPlan(pack(), {}).items.map((i) => i.id)).toEqual([
            "crest",
            "number",
        ]);
    });

    it("draws a draft's layers, an unsaved overlay from `extra`, and refuses one it has nowhere", () => {
        const overlay = fakePng(3360, 2816, 9);
        const plan = flattenPlan(pack(), {
            mode: "sash-out-c3d4",
            layers: ["layers/base.png", "layers/cape.png"],
            extra: { "layers/cape.png": overlay },
        });
        expect(files(plan)).toEqual(["layers/base.png", "layers/cape.png"]);
        expect(plan.images[1].png).toBe(overlay);
        // a draft places its own items: the answer holds every item of the pack
        expect(plan.items.map((i) => i.id)).toEqual(["crest", "number"]);
        // the pack's own layer wins over a draft's copy
        const own = flattenPlan(pack(), {
            layers: ["layers/sash.png"],
            extra: { "layers/sash.png": overlay },
        });
        expect(own.images[0].png).not.toBe(overlay);
        expect(
            codeOf(() =>
                flattenPlan(pack(), { layers: ["layers/missing.png"] }),
            ),
        ).toBe("damaged");
    });
});
