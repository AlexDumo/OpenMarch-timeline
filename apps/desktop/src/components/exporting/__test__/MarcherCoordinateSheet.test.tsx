import { cleanup, render, screen } from "@testing-library/react";
import {
    StaticMarcherCoordinateSheet,
    StaticQuarterMarcherSheet,
} from "../MarcherCoordinateSheet";
import type Page from "@/global/classes/Page";
import * as globalMocks from "@/__mocks__/globalMocks";
import { FieldProperties } from "@openmarch/core";
import Marcher from "@/global/classes/Marcher";
import { describe, expect, it, afterEach, beforeAll } from "vitest";
import { TolgeeProvider } from "@tolgee/react";
import tolgee from "@/global/singletons/Tolgee";
import type { PagePosition } from "../utils/exportPagePositions";

const Providers = ({ children }: { children: React.ReactNode }) => (
    <TolgeeProvider
        tolgee={tolgee}
        fallback="Loading..." // loading fallback
    >
        {children}
    </TolgeeProvider>
);

describe("StaticMarcherCoordinateSheet", () => {
    beforeAll(async () => {
        await tolgee.run();
    });
    const mockMarcher = globalMocks.mockMarchers[0];

    const mockFieldProperties = globalMocks.mockNCAAFieldProperties;

    const mockPages = globalMocks.mockPages;

    // Three marchers on three pages
    const xy: [number, number][] = [
        [50, 50],
        [0, 0],
        [-200, -500],
        [0, 0],
        [284, 963.1],
        [-200, 105.015],
        [50, 50],
        [0, 0],
        [-200, -500],
    ];
    const mockMarcherPages: PagePosition[] = xy.map(([x, y], i) => ({
        marcher_id: (i % 3) + 1,
        page_id: Math.floor(i / 3) + 1,
        x,
        y,
    }));

    afterEach(() => {
        cleanup();
    });

    it("renders without error", () => {
        render(
            <Providers>
                <StaticMarcherCoordinateSheet
                    marcher={mockMarcher}
                    fieldProperties={mockFieldProperties}
                    marcherPages={mockMarcherPages}
                    pages={mockPages}
                />
            </Providers>,
        );
    });

    describe("error messages", () => {
        it("displays error message when field properties are not provided", () => {
            render(
                <Providers>
                    <StaticMarcherCoordinateSheet
                        marcher={mockMarcher}
                        marcherPages={mockMarcherPages}
                        fieldProperties={
                            undefined as unknown as FieldProperties
                        }
                        pages={mockPages}
                    />
                </Providers>,
            );

            expect(
                screen.findByText("Error exporting coordinate sheet"),
            ).toBeTruthy();
            expect(
                screen.findByText("No field properties provided"),
            ).toBeTruthy();
        });

        it("displays error message when marcher is not provided", () => {
            render(
                <Providers>
                    <StaticMarcherCoordinateSheet
                        marcher={undefined as unknown as Marcher}
                        fieldProperties={mockFieldProperties}
                        marcherPages={mockMarcherPages}
                        pages={mockPages}
                    />
                </Providers>,
            );

            expect(
                screen.findByText("Error exporting coordinate sheet"),
            ).toBeTruthy();
            expect(screen.findByText("No marcher provided")).toBeTruthy();
        });

        it("displays error message when no pages are provided", () => {
            render(
                <Providers>
                    <StaticMarcherCoordinateSheet
                        marcher={mockMarcher}
                        pages={[]}
                        fieldProperties={mockFieldProperties}
                        marcherPages={mockMarcherPages}
                    />
                </Providers>,
            );

            expect(
                screen.findByText("Error exporting coordinate sheet"),
            ).toBeTruthy();
            expect(screen.findByText("No pages provided")).toBeTruthy();
        });

        it("displays error message when no marcher pages are provided", () => {
            render(
                <Providers>
                    <StaticMarcherCoordinateSheet
                        marcher={mockMarcher}
                        fieldProperties={mockFieldProperties}
                        pages={mockPages}
                        marcherPages={[]}
                    />
                </Providers>,
            );

            expect(
                screen.findByText("Error exporting coordinate sheet"),
            ).toBeTruthy();
            expect(screen.findByText("No marcher pages provided")).toBeTruthy();
        });

        it("displays all error messages", () => {
            render(
                <Providers>
                    <StaticMarcherCoordinateSheet
                        marcher={undefined as unknown as Marcher}
                        fieldProperties={
                            undefined as unknown as FieldProperties
                        }
                        pages={[]}
                        marcherPages={[]}
                    />
                </Providers>,
            );

            expect(
                screen.findByText("Error exporting coordinate sheet"),
            ).toBeTruthy();
            expect(
                screen.findByText("No field properties provided"),
            ).toBeTruthy();
            expect(screen.findByText("No marcher provided")).toBeTruthy();
            expect(screen.findByText("No pages provided")).toBeTruthy();
            expect(screen.findByText("No marcher pages provided")).toBeTruthy();
        });
    });

    describe("header", () => {
        it("displays the correct header (mockMarcher[0])", async () => {
            const mockMarcher = globalMocks.mockMarchers[0];
            render(
                <Providers>
                    <StaticMarcherCoordinateSheet
                        marcher={mockMarcher}
                        fieldProperties={mockFieldProperties}
                        marcherPages={mockMarcherPages}
                        pages={mockPages}
                    />
                </Providers>,
            );

            expect(await screen.findByLabelText("marcher header")).toBeTruthy();
            expect(
                (await screen.findByLabelText("marcher drill number"))
                    .textContent,
            ).toEqual(mockMarcher.drill_number);
            expect(
                (await screen.findByLabelText("marcher name")).textContent,
            ).toEqual(mockMarcher.name);
            expect(
                (await screen.findByLabelText("marcher section")).textContent,
            ).toEqual(mockMarcher.section);
        });

        it("displays the correct header (mockMarcher[0])", async () => {
            const mockMarcher = globalMocks.mockMarchers[1];
            render(
                <Providers>
                    <StaticMarcherCoordinateSheet
                        marcher={mockMarcher}
                        fieldProperties={mockFieldProperties}
                        marcherPages={mockMarcherPages}
                        pages={mockPages}
                    />
                </Providers>,
            );

            expect(await screen.findByLabelText("marcher header")).toBeTruthy();
            expect(
                (await screen.findByLabelText("marcher drill number"))
                    .textContent,
            ).toEqual(mockMarcher.drill_number);
            expect(
                (await screen.findByLabelText("marcher name")).textContent,
            ).toEqual(mockMarcher.name);
            expect(
                (await screen.findByLabelText("marcher section")).textContent,
            ).toEqual(mockMarcher.section);
        });
    });

    /**
     * Tempo decision DN-1: both coordinate sheets print the drill-sheet range ("5–8", leaving out
     * a final measure whose downbeat is the set) and, with no free legend area, the range only.
     */
    describe("measures (DN-1)", () => {
        const withMeasures = (
            page: Page,
            numbers: number[],
            startOn: number,
            endOn: number,
        ): Page =>
            ({
                ...page,
                measures: numbers.map((number) => ({ number, counts: 4 })),
                measureBeatToStartOn: startOn,
                measureBeatToEndOn: endOn,
            }) as unknown as Page;
        // m5's downbeat to m9's, then a page inside m9
        const pages = [
            withMeasures(mockPages[0], [5, 6, 7, 8, 9], 2, 1),
            withMeasures(mockPages[1], [9], 2, 4),
            mockPages[2],
        ];
        const ownPages = mockMarcherPages.filter(
            (marcherPage) => marcherPage.marcher_id === mockMarcher.id,
        );

        it("the full sheet prints the drill-sheet range", async () => {
            render(
                <Providers>
                    <StaticMarcherCoordinateSheet
                        marcher={mockMarcher}
                        fieldProperties={mockFieldProperties}
                        marcherPages={ownPages}
                        pages={pages}
                        includeMeasures
                    />
                </Providers>,
            );

            const cells = await screen.findAllByLabelText("page measures");
            expect(cells.map((cell) => cell.textContent)).toEqual([
                "5–8",
                "9",
                "-",
            ]);
            expect(screen.queryByText(/^Measures:/)).toBeNull();
        });

        it("the compact sheet prints the same range in its Ms column", () => {
            render(
                <Providers>
                    <StaticQuarterMarcherSheet
                        marcher={mockMarcher}
                        fieldProperties={mockFieldProperties}
                        marcherPages={ownPages}
                        pages={pages}
                        quarterPageNumber={1}
                        useXY={false}
                        includeMeasures
                    />
                </Providers>,
            );

            expect(screen.getByText("5–8")).toBeTruthy();
            expect(screen.getByText("9")).toBeTruthy();
            expect(screen.queryByText(/^Measures:/)).toBeNull();
        });
    });
});
