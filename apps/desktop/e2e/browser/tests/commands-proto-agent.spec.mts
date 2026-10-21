// PROTOTYPE (fork #357 spike): throwaway, do not build on this.
//
// A scripted "agent" session against window.openmarchCommands. It asserts almost nothing: it
// writes every call and its JSON result to a transcript, which FINDINGS.md reads.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test } from "../fixtures.mjs";
import { dragMarcher, waitForIdle } from "../app.mjs";

const OUT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../src/commands-proto/run",
);

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function transcript(mode: string) {
    const dir = path.join(OUT, mode);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "transcript.md");
    fs.writeFileSync(
        file,
        `<!-- cspell:disable -->\n\n# Agent transcript (${mode})\n\nWritten by e2e/browser/tests/commands-proto-agent.spec.mts. Each step: the call, then its JSON result.\n\n`,
    );
    let step = 0;
    return {
        dir,
        note(text: string) {
            fs.appendFileSync(file, `\n> ${text}\n`);
        },
        async call(page: Page, label: string, fn: string): Promise<Json> {
            step++;
            const t0 = Date.now();
            let result: Json;
            try {
                result = await page.evaluate(fn);
            } catch (e) {
                result = { THREW: String(e) };
            }
            const ms = Date.now() - t0;
            fs.appendFileSync(
                file,
                `\n## ${step}. ${label}\n\n\`${fn}\` (${ms} ms)\n\n\`\`\`json\n${JSON.stringify(result, null, 1)}\n\`\`\`\n`,
            );
            return result;
        },
        async shot(page: Page, name: string) {
            await page.screenshot({ path: path.join(dir, `${name}.png`) });
            fs.appendFileSync(file, `\n![${name}](${name}.png)\n`);
        },
    };
}

const C = "window.openmarchCommands";
/** Read the field immediately (same task as the call that resolved). */
const FIELD = `(() => { const f = window.fieldTest; return f ? { marchers: f.marchers().length, selection: f.selection().length, page: f.pageId(), view: f.viewport() } : null })()`;

async function session(page: Page, mode: string) {
    const tr = transcript(mode);
    const call = (label: string, fn: string) => tr.call(page, label, fn);

    await call("list commands", `${C}.list()`);
    await call(
        "legacy actions with a handler / enabled now",
        `${C}._actions().then(a => ({ total: a.length, withHandler: a.filter(x => x.handler).length, enabled: a.filter(x => x.enabled).length, noHandler: a.filter(x => !x.handler).map(x => x.id) }))`,
    );
    const show0 = await call("show", `${C}.show()`);

    // run + immediate reads in ONE evaluate, so nothing else can run between them
    await call(
        "create 12 trumpets, then show() and fieldTest in the same task",
        `(async () => { const r = await ${C}.runSentence("create 12 trumpets"); const s = await ${C}.show(); const f = ${FIELD}; return { run: r, showRightAfter: s.freshness, fieldRightAfter: f }; })()`,
    );
    await waitForIdle(page);
    await call("field after idle", FIELD);
    await call("create 4 snares", `${C}.runSentence("create 4 snares")`);
    await call(
        "trumpets (bare who = select), then fieldTest selection same task",
        `(async () => { const r = await ${C}.runSentence("trumpets"); return { run: r, field: ${FIELD} }; })()`,
    );
    await waitForIdle(page);
    await tr.shot(page, "01-trumpets-selected");
    await call(
        "brass - T4",
        `(async () => { const r = await ${C}.runSentence("brass - T4"); return { run: r, field: ${FIELD} }; })()`,
    );
    await call("T1-6, S2 & brass", `${C}.runSentence("T1-6, S2 & brass")`);
    await call(
        "parse: T1-T6 vs T1 - T6",
        `Promise.all([${C}.parse("T1-T6"), ${C}.parse("T1 - T6"), ${C}.parse("trumpets-T4")])`,
    );
    await call("focus T3", `${C}.runSentence("focus T3")`);
    await waitForIdle(page);
    await tr.shot(page, "02-focus-T3");
    await call("T3 focus (who-first)", `${C}.runSentence("snares focus")`);

    // A page: append past the last flag
    const pages = show0.pages as {
        id: number;
        name: string;
        beats: [number, number];
    }[];
    const last = pages[pages.length - 1]!;
    const appendAt = last.beats[1] + 8;
    await call(
        `add page at beat ${appendAt}, then show() same task`,
        `(async () => { const r = await ${C}.runSentence("add page at ${appendAt}"); const s = await ${C}.show(); return { run: r, show: s }; })()`,
    );
    await waitForIdle(page);
    await tr.shot(page, "03-page-added");
    await call(
        "add page on an existing flag (refusal)",
        `${C}.run("page.addAt", { beat: ${appendAt} })`,
    );
    await call("page 12 (ambiguous sentence)", `${C}.parse("page 12")`);

    // Batch: 3 commands, one undo step?
    const splitAt = Math.floor((last.beats[1] + appendAt) / 2);
    const batch = await call(
        "batch of 3 (create 2 tubas, select tubas, split page), then show() same task",
        `(async () => { const b = await ${C}.runBatch([{ id: "marchers.create", args: { count: 2, section: "Tuba" } }, { id: "select", args: { who: "tubas" } }, { id: "page.addAt", args: { beat: ${splitAt} } }], "Agent: tubas and a page"); const s = await ${C}.show(); return { batch: b, showRightAfter: s }; })()`,
    );
    void batch;
    await waitForIdle(page);
    await call("show after idle", `${C}.show()`);
    await call(
        "undo once (did the whole batch go?), then show() same task",
        `(async () => { const u = await ${C}.run("edit.undo"); const s = await ${C}.show(); return { undo: u, showRightAfter: s }; })()`,
    );
    await waitForIdle(page);
    await call("show after idle", `${C}.show()`);
    await call("redo", `${C}.run("edit.redo")`);
    await waitForIdle(page);
    await call("show after redo", `${C}.show()`);
    await call("undo again (leave batch undone)", `${C}.run("edit.undo")`);
    await waitForIdle(page);

    // Bad args
    await call(
        "bad args: count 'twelve'",
        `${C}.run("marchers.create", { count: "twelve", section: "Trumpet" })`,
    );
    await call(
        "bad args: count 0",
        `${C}.run("marchers.create", { count: 0, section: "Trumpet" })`,
    );
    await call(
        "bad args: unknown key",
        `${C}.run("marchers.create", { count: 2, section: "Trumpet", where: "home" })`,
    );
    await call(
        "bad args: missing section",
        `${C}.run("marchers.create", { count: 2 })`,
    );
    await call(
        "unknown command",
        `${C}.run("marcher.create", { count: 2, section: "Trumpet" })`,
    );
    await call("unknown query: trumpts", `${C}.runSentence("trumpts")`);
    await call("ambiguous query: bass", `${C}.runSentence("bass")`);
    await call("ambiguous query: tenor", `${C}.parse("tenor")`);
    await call("query matching nothing: flutes", `${C}.runSentence("flutes")`);
    await call("unknown tag", `${C}.runSentence("#rifels")`);
    await call(
        "sentence typo: crete 4 snares",
        `${C}.runSentence("crete 4 snares")`,
    );

    // Freshness without the command's own invalidation
    await call(
        "raw createMarchers with no invalidation: what is stale, for how long?",
        `${C}._probeRawCreate()`,
    );
    await waitForIdle(page);
    await call("undo the probe", `${C}.run("edit.undo")`);
    await waitForIdle(page);

    // Export
    await call("export pdf", `${C}.runSentence("export pdf")`);
    await call(
        "export drill-charts",
        `${C}.run("export.open", { tab: "drill-charts" })`,
    );
    await page.waitForTimeout(500);
    await tr.shot(page, "04-export-open");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Refused state: Preview
    await call(
        "legacy adapter: togglePreview",
        `${C}.run("action", { action: "togglePreview" })`,
    );
    await page.waitForTimeout(300);
    await call(
        "create 2 tubas in Preview (refused?)",
        `${C}.runSentence("create 2 tubas")`,
    );
    await call("select in Preview (refused?)", `${C}.runSentence("trumpets")`);
    await call(
        "list() availability in Preview",
        `${C}.list().then(l => l.map(c => ({ id: c.id, available: c.available })))`,
    );
    await call(
        "legacy adapter: togglePreview back",
        `${C}.run("action", { action: "togglePreview" })`,
    );
    await page.waitForTimeout(300);
    await call(
        "legacy adapter: toggleWorkspace (Visuals)",
        `${C}.run("action", { action: "toggleWorkspace" })`,
    );
    await page.waitForTimeout(300);
    await call(
        "create 2 tubas in Visuals (refused?)",
        `${C}.runSentence("create 2 tubas")`,
    );
    await call(
        "add page in Visuals (refused?)",
        `${C}.run("page.addAt", { beat: 3 })`,
    );
    await call(
        "show in Visuals",
        `${C}.show().then(s => ({ mode: s.mode, workspace: s.workspace }))`,
    );
    await call(
        "legacy adapter: toggleWorkspace back",
        `${C}.run("action", { action: "toggleWorkspace" })`,
    );
    await page.waitForTimeout(300);
    await call(
        "legacy adapter: unknown action",
        `${C}.run("action", { action: "alignHorizontaly" })`,
    );
    await call(
        "legacy adapter: alignHorizontally (selection: trumpets?)",
        `${C}.run("action", { action: "alignHorizontally" })`,
    );

    // Concurrency: two creates at once in one section
    await call(
        "two creates at once (same section)",
        `Promise.all([${C}.run("marchers.create", { count: 2, section: "Flute" }), ${C}.run("marchers.create", { count: 2, section: "Flute" })])`,
    );
    await waitForIdle(page);
    // A batch with a direct run interleaved: does the flatten swallow the other run?
    await call(
        "batch (2 clarinet creates) with a mellophone create started in between",
        `(async () => { const b = ${C}.runBatch([{ id: "marchers.create", args: { count: 1, section: "Clarinet" } }, { id: "marchers.create", args: { count: 1, section: "Clarinet" } }], "Agent: clarinets"); await new Promise(r => setTimeout(r, 0)); const other = ${C}.run("marchers.create", { count: 1, section: "Mellophone" }); return { batch: await b, other: await other }; })()`,
    );
    await waitForIdle(page);
    await call("show", `${C}.show()`);
    await call("undo once", `${C}.run("edit.undo")`);
    await waitForIdle(page);
    await call("show after undo (are mellophones gone too?)", `${C}.show()`);

    // A batch while the person drags a marcher
    const T1 = `(() => { const m = window.fieldTest.marchers().find(m => m.label === "T1"); return m && { x: m.x, y: m.y } })()`;
    await call(
        "focus T1-4 (so T1 is on screen)",
        `${C}.run("view.focus", { who: "T1-4" })`,
    );
    await waitForIdle(page);
    await call("T1 before", T1);
    await page.evaluate(
        `window.__batch = ${C}.runBatch([{ id: "marchers.create", args: { count: 1, section: "Piccolo" } }, { id: "select", args: { who: "piccolos" } }, { id: "marchers.create", args: { count: 1, section: "Piccolo" } }], "Agent: piccolos")`,
    );
    await dragMarcher(page, "T1", { x: 60, y: 0 }, { steps: 3 });
    await call("batch result (person dragged T1 meanwhile)", `window.__batch`);
    await waitForIdle(page);
    await call("T1 after drag", T1);
    await call("undo once", `${C}.run("edit.undo")`);
    await waitForIdle(page);
    await call(
        "T1 after undo (did the agent's undo take the person's drag?)",
        T1,
    );
    await call(
        "show after undo",
        `${C}.show().then(s => ({ sections: s.sections }))`,
    );

    // The palette row
    await page.keyboard.press("Control+k");
    await page.keyboard.type("create 2 tubas");
    await page.waitForTimeout(300);
    await tr.shot(page, "05-palette-sentence");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    await tr.shot(page, "06-palette-result-toast");
    await waitForIdle(page);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("crete 4 snares");
    await page.waitForTimeout(300);
    await tr.shot(page, "07-palette-parse-error");
    await page.keyboard.press("Escape");
    await call("final show", `${C}.show()`);
}

// The UNIQUE failure is the concurrency probe's expected result (two creates at once)
test.use({
    // One regex: a two-element array reads as Playwright's [value, options] fixture tuple
    allowedPageErrors: [
        /Audio worklet error|UNIQUE constraint failed: marchers.drill_prefix, marchers.drill_order/,
    ],
});

test("agent session, Expert", async ({ show }) => {
    test.setTimeout(240_000);
    await session(show.page, "expert");
});

test.describe("Basic", () => {
    test.use({
        appSettings: { optOutAnalytics: true, editorMode: "basic" },
    });
    test("agent session, Basic", async ({ show }) => {
        test.setTimeout(240_000);
        await session(show.page, "basic");
    });
});
