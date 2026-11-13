/**
 * Turns the coordinate-sheet model (the same cells the HTML sheets show) into
 * the JSON the Typst template reads from `/data.json`. All text stays data:
 * the template never evaluates it, so names like `Gus <Tag> & Co` or
 * `#set page(...)` print exactly as typed.
 */

export type SheetRow = {
    set: string;
    counts: number;
    measures: string;
    sideToSide: string;
    frontToBack: string;
    sideToSideTerse: string;
    frontToBackTerse: string;
};

export type SheetMarcher = {
    name: string;
    displayName: string;
    drillNumber: string;
    section: string;
    rows: SheetRow[];
};

export type SheetModel = {
    showName: string;
    options: {
        terse: boolean;
        includeMeasures: boolean;
        useXY: boolean;
    };
    quarterRowsPerSheet: number;
    marchers: SheetMarcher[];
};

export type Layout = "full" | "quarter";

export type TemplateData = {
    showName: string;
    exportedOn: string;
    layout: Layout;
    columns: { label: string; width: number; align: "center" | "left" }[];
    quarterMaxRows: number;
    marchers: {
        drillNumber: string;
        name: string;
        section: string;
        rows: string[][];
    }[];
};

export function toTemplateData(
    model: SheetModel,
    layout: Layout,
    marchers: SheetMarcher[] = model.marchers,
    exportedOn: string = new Date().toLocaleDateString(),
): TemplateData {
    const { terse, includeMeasures, useXY } = model.options;
    const quarter = layout === "quarter";
    const x = useXY ? "X" : "Side to Side";
    const y = useXY ? "Y" : "Front to Back";
    const columns: TemplateData["columns"] = [
        {
            label: quarter ? "Pg." : "Pg",
            width: quarter ? 15 : 10,
            align: "center",
        },
        { label: "Ct", width: quarter ? 10 : 12, align: "center" },
        ...(includeMeasures
            ? [
                  {
                      label: "Measure",
                      width: quarter ? 20 : 15,
                      align: "center" as const,
                  },
              ]
            : []),
        { label: x, width: quarter ? 27.5 : 31.5, align: "left" },
        { label: y, width: quarter ? 27.5 : 31.5, align: "left" },
    ];
    return {
        showName: model.showName,
        exportedOn,
        layout,
        columns,
        quarterMaxRows: model.quarterRowsPerSheet,
        marchers: marchers.map((m) => ({
            drillNumber: m.drillNumber,
            name: m.displayName || m.name,
            section: m.section,
            rows: m.rows.map((r) => [
                r.set,
                String(r.counts),
                ...(includeMeasures ? [r.measures] : []),
                terse ? r.sideToSideTerse : r.sideToSide,
                terse ? r.frontToBackTerse : r.frontToBack,
            ]),
        })),
    };
}
