import { useEffect, useMemo, useState } from "react";
import type { FieldProperties } from "@openmarch/core";
import type Marcher from "@/global/classes/Marcher";
import type Page from "@/global/classes/Page";
import type { SectionAppearance } from "@/db-functions";
import { db } from "@/global/database/db";
import tolgee from "@/global/singletons/Tolgee";
import type { FieldViewFrom } from "@/field/fieldViewFrom";
import individualDemoSVG from "@/assets/drill_chart_export_individual_demo.svg";
import overviewDemoSVG from "@/assets/drill_chart_export_overview_demo.svg";
import {
    readExportPositions,
    type ExportPositions,
} from "./utils/exportPagePositions";
import type { MarcherAppearancesByPageId } from "./utils/exportAppearances";
import {
    generateDrillChartExportSVGs,
    getFieldImageForExport,
} from "./utils/svg-generator";
import type { DrillChartFieldImage } from "./utils/drillChartSvg";

/**
 * The drill chart tab's preview: one chart of this show as the export will draw it, in the
 * chosen view. An individual chart shows the first marcher on the second page (so both of its
 * paths show); the overview shows the first page. The demo picture shows until the show's
 * positions are read, or if they can't be.
 */
export default function DrillChartPreview({
    fieldProperties,
    pages,
    marchers,
    sectionAppearances,
    marcherAppearancesByPageId,
    gridLines,
    halfLines,
    individualCharts,
    viewFrom,
}: {
    fieldProperties: FieldProperties;
    pages: Page[];
    marchers: Marcher[];
    sectionAppearances?: SectionAppearance[];
    marcherAppearancesByPageId?: MarcherAppearancesByPageId;
    gridLines: boolean;
    halfLines: boolean;
    individualCharts: boolean;
    viewFrom: FieldViewFrom;
}) {
    const [source, setSource] = useState<{
        positions: ExportPositions;
        image: DrillChartFieldImage | undefined;
    } | null>(null);

    // The show's positions, read once per show change; switching options only redraws
    useEffect(() => {
        let cancelled = false;
        setSource(null);
        (async () => {
            const positions = await readExportPositions({
                db,
                rendered: { pages, marchers },
            });
            const image = await getFieldImageForExport();
            if (!cancelled) setSource({ positions, image });
        })().catch((error) => {
            // The demo picture stays; the export itself reports what's wrong
            console.warn("Couldn't draw the drill chart preview", error);
        });
        return () => {
            cancelled = true;
        };
    }, [pages, marchers]);

    const [svg, setSvg] = useState<string | null>(null);
    useEffect(() => {
        if (!source || !marchers.length || !pages.length) {
            setSvg(null);
            return;
        }
        let cancelled = false;
        const pageIndex = individualCharts ? Math.min(1, pages.length - 1) : 0;
        const first = marchers[0]!;
        void generateDrillChartExportSVGs({
            fieldProperties,
            marchers,
            // The page shown and those beside it, for an individual chart's paths
            sortedPages: pages.slice(Math.max(0, pageIndex - 1), pageIndex + 2),
            marcherPagesMap: source.positions,
            walkedPaths: source.positions.walkedPaths,
            sectionAppearances,
            marcherAppearancesByPageId,
            backgroundImage: source.image,
            useImagePlaceholder: false,
            gridLines,
            halfLines,
            individualCharts,
            viewFrom,
            onlyMarcherIds: new Set([first.id]),
        }).then(
            ({ SVGs }) => {
                if (cancelled) return;
                // The first marcher's charts, or the overview's
                setSvg(SVGs[0]?.[pageIndex === 0 ? 0 : 1] ?? null);
            },
            (error) => {
                if (!cancelled) setSvg(null);
                console.warn("Couldn't draw the drill chart preview", error);
            },
        );
        return () => {
            cancelled = true;
        };
    }, [
        source,
        fieldProperties,
        pages,
        marchers,
        sectionAppearances,
        marcherAppearancesByPageId,
        gridLines,
        halfLines,
        individualCharts,
        viewFrom,
    ]);

    const url = useMemo(
        () =>
            svg
                ? URL.createObjectURL(
                      new Blob([svg], { type: "image/svg+xml" }),
                  )
                : null,
        [svg],
    );
    useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

    return (
        <img
            src={
                url ?? (individualCharts ? individualDemoSVG : overviewDemoSVG)
            }
            alt={tolgee.t("exportCoordinates.drillChartPreviewAlt")}
            data-testid="drill-chart-preview"
            data-view-from={url ? viewFrom : undefined}
            className="block w-full"
            style={{ maxHeight: "20rem", objectFit: "contain" }}
        />
    );
}
