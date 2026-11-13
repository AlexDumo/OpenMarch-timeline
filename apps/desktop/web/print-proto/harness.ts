/**
 * Test page for the print-dialog PDF prototype: exposes the web build's
 * print module (../renderer/printSheets.ts) to Playwright (./run.mts).
 */
import {
    preparePrint,
    supportsNativeMarginBoxes,
    type PreparedPrint,
    type PrintSheetsRequest,
} from "../renderer/printSheets";

let last: PreparedPrint | null = null;

/** The laid-out print document, without scripts, to load elsewhere. */
function serialize(p: PreparedPrint): string {
    const clone = p.iframe.contentDocument!.documentElement.cloneNode(
        true,
    ) as HTMLElement;
    clone.querySelectorAll("script").forEach((s) => s.remove());
    return "<!doctype html>\n" + clone.outerHTML;
}

const harness = {
    supportsNativeMarginBoxes: () => supportsNativeMarginBoxes(),
    async prepare(request: PrintSheetsRequest & { timeoutMs?: number }) {
        const t0 = performance.now();
        last = await preparePrint(request, { timeoutMs: request.timeoutMs });
        const ms = performance.now() - t0;
        return {
            ms,
            engine: last.engine,
            pages: last.pages ?? null,
            quarterFit: last.quarterFit ?? null,
            title: last.iframe.contentDocument!.title,
        };
    },
    serialize: () => serialize(last!),
    /** Calls print() with the dialog stubbed out; reports what happened. */
    printStubbed() {
        const p = last!;
        let called = 0;
        let titleDuringPrint = "";
        p.window.print = () => {
            called++;
            titleDuringPrint = document.title;
        };
        p.print();
        return { called, titleDuringPrint };
    },
    remove() {
        last?.remove();
        last = null;
        return document.querySelectorAll("iframe").length;
    },
};
(window as unknown as { harness: typeof harness }).harness = harness;

document.getElementById("print")!.addEventListener("click", async () => {
    const res = await fetch("./sheets-full.json");
    const sheets = (await res.json()) as { renderedPage: string }[];
    const p = await preparePrint({
        sheets: sheets.map((s) => s.renderedPage),
        quarterPages: false,
        showName: "Fixture Show 2026",
    });
    p.print();
});
