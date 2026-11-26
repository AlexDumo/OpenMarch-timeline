// cspell:words omasset
/**
 * A version 3 pack with modes (fork #1257 step 5): three layers, two items and the three
 * modes of docs/3d/uniform-artwork.md. `fixtures-files/sample-modes-v3.omasset` holds these bytes
 * as this build first wrote them, so a change to how packs are written shows up as a test failure.
 */
import { writeUniformPack } from "../format";
import { fakePng, sampleManifest } from "./fixtures";

export function sampleModesV3(): Uint8Array {
    const base = sampleManifest("Sample modes");
    return writeUniformPack(
        {
            ...base,
            layers: [
                ...base.layers,
                {
                    id: "sash",
                    name: "Sash",
                    file: "layers/sash.png",
                    covers: "page",
                },
                {
                    id: "open-front",
                    name: "Open front",
                    file: "layers/open-front.png",
                    covers: "page",
                },
            ],
            items: [
                {
                    id: "crest",
                    file: "items/crest.png",
                    panel: "front",
                    at: [17, 25.32],
                    width: 6,
                },
                {
                    id: "number",
                    file: "items/number.png",
                    panel: "back",
                    at: [17, 28.47],
                    height: 8,
                },
            ],
            modes: [
                {
                    id: "plain-a1b2",
                    name: "Plain",
                    layers: ["base"],
                    items: ["crest", "number"],
                },
                {
                    id: "sash-out-c3d4",
                    name: "Sash out",
                    layers: ["base", "sash"],
                    items: ["number"],
                },
                {
                    id: "sash-out-unzipped-e5f6",
                    name: "Sash out, unzipped",
                    layers: ["base", "sash", "open-front"],
                    items: ["number"],
                    palette: { primary: "#f2f2ee" },
                    options: { collar: false, hat: false },
                },
            ],
        },
        {
            "layers/base.png": fakePng(3360, 2816, 1),
            "layers/sash.png": fakePng(3360, 2816, 2),
            "layers/open-front.png": fakePng(3360, 2816, 3),
            "items/crest.png": fakePng(512, 512, 4),
            "items/number.png": fakePng(300, 400, 5),
        },
    );
}
