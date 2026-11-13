import { describe, expect, it, vi } from "vitest";
import {
    createDrillChartExportHandlers,
    type DrillChartExportDeps,
} from "../drillChartExport";

function setup(overrides: Partial<DrillChartExportDeps> = {}) {
    let id = 0;
    const lib = {
        renderDrillChartPdf: vi.fn(async (args: { drillNumber: string }) =>
            new TextEncoder().encode(`%PDF ${args.drillNumber}`),
        ),
        drillChartPdfFileName: vi.fn(
            (show: string, drill: string) => `${show}-${drill}.pdf`,
        ),
        loadFieldImageDataUri: vi.fn(async () => "data:image/png;base64,AA=="),
        zipFiles: vi.fn(
            async (files: File[], name: string) =>
                new File([String(files.length)], name, {
                    type: "application/zip",
                }),
        ),
    };
    const deps: DrillChartExportDeps = {
        load: vi.fn(async () => lib),
        share: vi.fn(async () => "shared" as const),
        download: vi.fn(),
        appleTouch: false,
        newId: () => `e${++id}`,
        ...overrides,
    };
    return { deps, lib, handlers: createDrillChartExportHandlers(deps) };
}

const doc = (exportDir: string, drillNumber: string) => ({
    exportDir,
    svgPages: ["<svg/>"],
    drillNumber,
    marcherCoordinates: [],
    pages: [],
    showName: "Fall Show",
    individualCharts: drillNumber !== "MAIN",
});

describe("drill chart export on the web", () => {
    it("downloads a single chart as a PDF", async () => {
        const { deps, lib, handlers } = setup();
        const { exportName, exportDir } =
            handlers.createExportDirectory("Fall Show");
        expect(exportName).toBe("Fall Show");
        expect(handlers.owns(exportDir)).toBe(true);

        await expect(
            handlers.generateDocForMarcher(doc(exportDir, "MAIN")),
        ).resolves.toEqual({ success: true });
        await expect(handlers.deliver(exportDir)).resolves.toBe("saved");

        const file = vi.mocked(deps.download).mock.calls[0][0];
        expect(file.name).toBe("Fall Show-MAIN.pdf");
        expect(file.type).toBe("application/pdf");
        expect(file.size).toBe("%PDF MAIN".length);
        expect(lib.zipFiles).not.toHaveBeenCalled();
        // Drawn with the show's field image, and without the export id
        expect(lib.renderDrillChartPdf).toHaveBeenCalledWith(
            expect.objectContaining({
                fieldImageDataUri: "data:image/png;base64,AA==",
            }),
        );
        expect(lib.renderDrillChartPdf.mock.calls[0][0]).not.toHaveProperty(
            "exportDir",
        );
    });

    it("zips one PDF per marcher, reading the field image once", async () => {
        const { deps, lib, handlers } = setup();
        const { exportDir } = handlers.createExportDirectory("Fall Show");
        for (const drill of ["T1", "T2", "S1"])
            await handlers.generateDocForMarcher(doc(exportDir, drill));

        await handlers.deliver(exportDir);

        expect(lib.loadFieldImageDataUri).toHaveBeenCalledTimes(1);
        const [files, name] = lib.zipFiles.mock.calls[0];
        expect(files.map((f) => f.name)).toEqual([
            "Fall Show-T1.pdf",
            "Fall Show-T2.pdf",
            "Fall Show-S1.pdf",
        ]);
        expect(name).toBe("Fall Show-drill-charts.zip");
        expect(vi.mocked(deps.download).mock.calls[0][0].name).toBe(
            "Fall Show-drill-charts.zip",
        );
    });

    it("names an untitled show, without characters files can't have", () => {
        const { handlers } = setup();
        expect(handlers.createExportDirectory("").exportName).toBe(
            "OpenMarch show",
        );
        expect(handlers.createExportDirectory("A/B: C?").exportName).toBe(
            "AB C",
        );
    });

    it("offers the share sheet first on iPads", async () => {
        const { deps, handlers } = setup({ appleTouch: true });
        const { exportDir } = handlers.createExportDirectory("Fall Show");
        await handlers.generateDocForMarcher(doc(exportDir, "MAIN"));

        await expect(handlers.deliver(exportDir)).resolves.toBe("saved");
        expect(deps.share).toHaveBeenCalledTimes(1);
        expect(deps.download).not.toHaveBeenCalled();
    });

    it("lets Save be tapped again when the share sheet closes or expires", async () => {
        const share = vi
            .fn<DrillChartExportDeps["share"]>()
            .mockResolvedValueOnce("expired")
            .mockResolvedValueOnce("cancelled")
            .mockResolvedValueOnce("shared");
        const { lib, handlers } = setup({ appleTouch: true, share });
        const { exportDir } = handlers.createExportDirectory("Fall Show");
        await handlers.generateDocForMarcher(doc(exportDir, "T1"));
        await handlers.generateDocForMarcher(doc(exportDir, "T2"));

        await expect(handlers.deliver(exportDir)).resolves.toBe("cancelled");
        await expect(handlers.deliver(exportDir)).resolves.toBe("cancelled");
        await expect(handlers.deliver(exportDir)).resolves.toBe("saved");
        // The zip is made once
        expect(lib.zipFiles).toHaveBeenCalledTimes(1);
        expect(share.mock.calls[0][0]).toBe(share.mock.calls[2][0]);
    });

    it("downloads on iPads where sharing isn't possible", async () => {
        const { deps, handlers } = setup({
            appleTouch: true,
            share: vi.fn(async () => "unavailable" as const),
        });
        const { exportDir } = handlers.createExportDirectory("Fall Show");
        await handlers.generateDocForMarcher(doc(exportDir, "MAIN"));

        await expect(handlers.deliver(exportDir)).resolves.toBe("saved");
        expect(deps.download).toHaveBeenCalledTimes(1);
    });

    it("forgets an export once another starts", async () => {
        const { handlers } = setup();
        const first = handlers.createExportDirectory("Fall Show").exportDir;
        await handlers.generateDocForMarcher(doc(first, "MAIN"));
        handlers.createExportDirectory("Fall Show");

        await expect(handlers.deliver(first)).resolves.toBe("missing");
        await expect(
            handlers.generateDocForMarcher(doc(first, "T1")),
        ).resolves.toEqual({ success: false, error: "This export has ended" });
    });

    it("has nothing to save before a chart is drawn", async () => {
        const { handlers } = setup();
        const { exportDir } = handlers.createExportDirectory("Fall Show");
        await expect(handlers.deliver(exportDir)).resolves.toBe("missing");
        expect(handlers.owns("Fall Show-2026-01-15.mp4")).toBe(false);
    });

    it("reports a chart that fails to draw", async () => {
        const { lib, handlers } = setup();
        lib.renderDrillChartPdf.mockRejectedValueOnce(new Error("bad svg"));
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const { exportDir } = handlers.createExportDirectory("Fall Show");

        await expect(
            handlers.generateDocForMarcher(doc(exportDir, "T1")),
        ).resolves.toEqual({ success: false, error: "bad svg" });
        errors.mockRestore();
    });
});
