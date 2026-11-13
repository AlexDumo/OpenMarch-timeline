// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import {
    createTypstCompiler,
    loadFonts,
    type TypstCompiler,
} from "@myriaddreamin/typst.ts";
import { toTemplateData, type SheetModel } from "../sheetData";

const dir = path.join(__dirname, "..");
const require = createRequire(__filename);

const row = (set: string) => ({
    set,
    counts: 8,
    measures: "-",
    sideToSide: "S1: 2 inside 40 yard line",
    frontToBack: "4 behind front hash",
    sideToSideTerse: "S1: 2 IN 40",
    frontToBackTerse: "4 BE FH",
});
const marcher = (name: string, rows = 45) => ({
    name,
    displayName: name,
    drillNumber: "B1",
    section: "Baritone",
    rows: Array.from({ length: rows }, (_, i) => row(String(i + 1))),
});
const model = (names: string[], rows?: number): SheetModel => ({
    showName: "Test #show *x*",
    options: { terse: false, includeMeasures: true, useXY: false },
    quarterRowsPerSheet: 18,
    marchers: names.map((n) => marcher(n, rows)),
});

const pageCount = (pdf: Uint8Array) =>
    (
        Buffer.from(pdf)
            .toString("latin1")
            .match(/\/Type\s*\/Page[^s]/g) ?? []
    ).length;

let compiler: TypstCompiler;
beforeAll(async () => {
    compiler = createTypstCompiler();
    await compiler.init({
        getModule: () =>
            fs.readFileSync(
                require.resolve("@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm"),
            ),
        beforeBuild: [
            loadFonts(
                ["Regular", "Bold"].map(
                    (w) =>
                        new Uint8Array(
                            fs.readFileSync(
                                path.join(
                                    dir,
                                    `fonts/LiberationSans-${w}.subset.ttf`,
                                ),
                            ),
                        ),
                ),
                { assets: false },
            ),
        ],
    });
    compiler.addSource(
        "/main.typ",
        fs.readFileSync(path.join(dir, "coordinate-sheets.typ"), "utf8"),
    );
    compiler.mapShadow(
        "/logo.svg",
        new TextEncoder().encode(
            '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
        ),
    );
}, 60_000);

async function compile(m: SheetModel, layout: "full" | "quarter") {
    compiler.mapShadow(
        "/data.json",
        new TextEncoder().encode(
            JSON.stringify(toTemplateData(m, layout, undefined, "1/1/2026")),
        ),
    );
    const r = await compiler.compile({
        mainFilePath: "/main.typ",
        format: 1,
        diagnostics: "full",
    });
    return {
        pdf: r.result as Uint8Array | undefined,
        diagnostics: r.diagnostics ?? [],
    };
}

describe("coordinate-sheets.typ", () => {
    it("keeps names as data", () => {
        const data = toTemplateData(model(["Gus <Tag> & Co"]), "full");
        expect(data.marchers[0].name).toBe("Gus <Tag> & Co");
        expect(data.columns.map((c) => c.label)).toEqual([
            "Pg",
            "Ct",
            "Measure",
            "Side to Side",
            "Front to Back",
        ]);
    });

    it("compiles names full of Typst markup without running it", async () => {
        const names = [
            "Gus <Tag> & Co",
            "#set page(fill: red) *b* $x$ _i_ @r <l> \\",
            '#panic("no") ]) #{ 1 } // x',
            "#pagebreak() #pagebreak()",
        ];
        const { pdf, diagnostics } = await compile(model(names), "full");
        expect(diagnostics).toEqual([]);
        // 45 rows take two pages per marcher; injected page breaks would add more
        expect(pageCount(pdf!)).toBe(names.length * 2);
    });

    it("packs quarter sheets so they fit, four to a page", async () => {
        const { pdf, diagnostics } = await compile(
            model(["A", "B"], 45),
            "quarter",
        );
        expect(diagnostics).toEqual([]);
        // 45 verbose rows fit 17 per quarter: 3 sheets each, 6 sheets on 2 pages
        expect(pageCount(pdf!)).toBe(2);
    });
});
