// @vitest-environment node
// cspell:words omasset
/**
 * The builder against the app, in a real browser: the example built by `buildFolder` holds the
 * very bytes the app's own import makes of the same art (its page, through `importUniformFile`;
 * its items, through `importItemFile`).
 *
 * Needs Playwright's Chromium (`pnpm exec playwright install chromium`); where it isn't
 * installed, the test says so and skips, unless `UNIFORM_SMOKE_REQUIRED` is set (CI's
 * desktop-browser-e2e job sets it and runs this file, since the desktop-test shards have no
 * browser).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import regionsJson from "@/view3d/assets/uniform-flats/regions.json";
import { readUniformPack } from "@/view3d/core/uniformPack/format";
import { openToolPage, type ToolPage } from "../browser";
import { buildFolder } from "../build";
import { pageSvgFromPanels, type PanelRects } from "../packSource";

/** Compared by hash: a failing toEqual on two half-megabyte buffers diffs for minutes */
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const example = path.resolve(__dirname, "../../example");
const panels = (regionsJson as unknown as { panels: PanelRects }).panels;

const chromiumInstalled = (() => {
    try {
        const req = createRequire(
            path.resolve(__dirname, "../../../../package.json"),
        );
        const { chromium } = req("playwright") as typeof import("playwright");
        return fs.existsSync(chromium.executablePath());
    } catch {
        return false;
    }
})();

describe.skipIf(!chromiumInstalled)(
    "the builder in a browser (needs Playwright's Chromium)",
    () => {
        let page: ToolPage;
        beforeAll(async () => {
            page = await openToolPage({ gpu: false, handleSignals: false });
        }, 180_000);
        afterAll(async () => page?.close());

        it("stores exactly what the app's import makes of the same art", async () => {
            const built = readUniformPack(
                (await buildFolder(example, page)).bytes,
            );
            const read = (f: string) => fs.readFileSync(path.join(example, f));

            // the page the builder hands the import: the panels where the template has them
            const svg = pageSvgFromPanels(
                {
                    front: { file: "front.svg", bytes: read("front.svg") },
                    back: { file: "back.svg", bytes: read("back.svg") },
                },
                panels,
            );
            const appPack = readUniformPack(
                Buffer.from(
                    await page.appImport(
                        "page",
                        "base.svg",
                        Buffer.from(svg).toString("base64"),
                    ),
                    "base64",
                ),
            );
            expect(sha(built.layers[0].png)).toBe(sha(appPack.layers[0].png));

            for (const [id, file] of [
                ["crest", "crest.svg"],
                ["number", "number.svg"],
            ]) {
                const app = Buffer.from(
                    await page.appImport(
                        "item",
                        file,
                        read(file).toString("base64"),
                    ),
                    "base64",
                );
                const stored = built.itemFiles.find(
                    (f) => f.file === `items/${id}.png`,
                );
                expect(sha(stored!.png)).toBe(sha(app));
            }
        }, 180_000);

        it("refuses the template itself as a layer, by the app's own check", async () => {
            const files = await page.image<Record<string, string>>("template");
            const dir = fs.mkdtempSync(
                path.join(os.tmpdir(), "uniform-smoke-"),
            );
            try {
                fs.writeFileSync(
                    path.join(dir, "uniform-template.svg"),
                    Buffer.from(files["uniform-template.svg"], "base64"),
                );
                const json = JSON.parse(
                    fs.readFileSync(path.join(example, "uniform.json"), "utf8"),
                );
                json.layers = [{ id: "base", page: "uniform-template.svg" }];
                delete json.items;
                fs.writeFileSync(
                    path.join(dir, "uniform.json"),
                    JSON.stringify(json),
                );
                await expect(buildFolder(dir, page)).rejects.toThrow(
                    /layer "base": the template is left visible/,
                );
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }, 180_000);
    },
);

it.runIf(!chromiumInstalled)(
    "skips the browser smoke test: Playwright's Chromium isn't installed",
    () => {
        // CI's desktop-browser-e2e job sets this: there, a missing browser is a failure
        expect(
            process.env.UNIFORM_SMOKE_REQUIRED,
            "UNIFORM_SMOKE_REQUIRED is set, but Playwright's Chromium isn't installed",
        ).toBeFalsy();
    },
);
