// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import sharp from "sharp";
import FieldPropertiesTemplates from "../../../../src/global/classes/FieldProperties.templates";
import { floorSizeForImage } from "../../../../src/view3d/core/field/floorSize";
import {
    hashParts,
    versionHashOf,
} from "../../../../src/view3d/library/showHash";
import { decodeArtworkSidecar } from "../../artwork-import/sidecar";
import { floorFromFieldImage, FLOOR_TEMP_PREFIX } from "../fieldImageFloor";

const gym = FieldPropertiesTemplates.INDOOR_50x80_8to5;

const solid = (width: number, height: number) =>
    sharp({
        create: {
            width,
            height,
            channels: 3,
            background: { r: 30, g: 60, b: 120 },
        },
    });

const leftovers = () =>
    fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(FLOOR_TEMP_PREFIX));

describe("floorFromFieldImage (D-23 convert on open)", () => {
    it("imports a PNG as a Base floor sized like its placement on the field", async () => {
        const before = leftovers();
        const png = new Uint8Array(await solid(400, 200).png().toBuffer());

        const version = await floorFromFieldImage(png, gym);

        expect(version.kind).toBe("artwork");
        expect(version.name).toBe("Field image");
        expect(version.builtIn).toBe(false);
        expect(Object.keys(version.parts).sort()).toEqual(
            expect.arrayContaining(["display", "original"]),
        );
        expect(Array.from(version.parts.original!)).toEqual(Array.from(png));
        expect(version.versionHash).toBe(
            await versionHashOf(await hashParts(version.parts)),
        );
        const display = await sharp(version.parts.display!).metadata();
        expect(display.width! / display.height!).toBeCloseTo(2, 2);
        expect(leftovers()).toEqual(before);
    });

    it("records the Base floor surface and the field-placement size", async () => {
        const png = new Uint8Array(await solid(400, 200).png().toBuffer());
        const version = await floorFromFieldImage(png, gym);
        const size = floorSizeForImage(gym, { width: 400, height: 200 });
        const sidecar = decodeArtworkSidecar(version.parts.sidecar!);
        expect(sidecar.surface).toBe("baseFloor");
        expect(sidecar.size.source).toBe("slot");
        expect(sidecar.size.width.m).toBeCloseTo(size.widthM, 4);
        expect(sidecar.size.height.m).toBeCloseTo(size.heightM, 4);
    });

    it("converts an image the Artwork pipeline doesn't read, such as WebP", async () => {
        const webp = new Uint8Array(await solid(300, 300).webp().toBuffer());
        const version = await floorFromFieldImage(webp, gym);
        expect(version.parts.display).toBeDefined();
    });

    it("throws for bytes that aren't an image, and leaves no temp folder", async () => {
        const before = leftovers();
        await expect(
            floorFromFieldImage(new TextEncoder().encode("not an image"), gym),
        ).rejects.toThrow();
        expect(leftovers()).toEqual(before);
    });
});
