import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SHAPE_TOOLS } from "../../tool/shapeTools";
import type { ToolChoicePicture, ToolEnv } from "../../tool/toolKind";
import { lineTool } from "../../line/lineTool";
import type { LineParams, LinePoint } from "../../line/lineGeometry";
import { CHOICE_PICTURE, fitChoicePicture } from "../../preview/choicePicture";
import { ChoiceMenus } from "../ChoiceMenu";
import { ChoicePicture } from "../ChoicePicture";
import {
    ORDER_PICTURE_SIZE,
    ORDER_PICTURES,
    ORDER_SAMPLE,
} from "../orderPictures";
import { OrderMenu } from "../OrderMenu";

/**
 * Pictures in the shape menus (#559): every answer of every kind's menus is sketched beside its
 * name, and the menu's button shows the answer the shape has
 */

afterEach(cleanup);

const env: ToolEnv = {
    stepPx: 10,
    snap: true,
    constrain: false,
    gridSnap: (p) => p,
    hitRadius: 3,
};
const N = 6;
const at = (x: number, y: number, tension = 0): LinePoint => ({
    x,
    y,
    tension,
});

/** Lines that between them show every answer a Line's menus can offer */
const LINES: readonly LineParams[] = [
    { points: [at(0, 0), at(100, 0)], spacing: { mode: "fit" } },
    // An L going right then down: ↕ is offered, ↔ greyed out on its square part
    {
        points: [at(0, 0), at(60, 0), at(60, 40)],
        spacing: { mode: "keep", groups: [{ interval: 20 }] },
    },
    // Corners and smooth points
    {
        points: [at(0, 0), at(40, 40, 1), at(80, 0), at(120, 40)],
        spacing: { mode: "path", groups: [{ interval: 10 }], anchor: "end" },
    },
    {
        points: [at(0, 0), at(60, 0), at(60, 60), at(0, 60)],
        closed: true,
        spacing: { mode: "fit" },
    },
];

/** What a sketch draws: something, at least */
const draws = (picture: ToolChoicePicture | undefined) =>
    picture !== undefined &&
    (picture.dots.length > 0 ||
        picture.lines.some((line) => line.points.length > 1));

describe("every answer has a picture", () => {
    it("in every kind's own menus, whatever the shape offers", () => {
        let answers = 0;
        for (const { kind } of SHAPE_TOOLS) {
            const shapes: unknown[] = [
                kind.fromFrame(
                    {
                        center: { x: 0, y: 0 },
                        halfWidth: 40,
                        halfDepth: 40,
                        rotation: 0,
                        flipX: false,
                        flipY: false,
                    },
                    N,
                    env,
                ),
                ...(kind.shape.id === "line" ? LINES : []),
            ];
            for (const params of shapes)
                for (const choice of kind.choices ?? [])
                    for (const option of choice.options(params, N)) {
                        answers++;
                        expect(
                            draws(option.picture),
                            `${kind.preset ?? kind.shape.id} ${choice.key} ${option.value}`,
                        ).toBe(true);
                    }
        }
        expect(answers).toBeGreaterThan(0);
    });

    it("tells the Line's answers apart: no two answers of a menu share a picture", () => {
        for (const choice of lineTool.choices ?? []) {
            const pictures = new Map<string, string>();
            for (const params of LINES)
                for (const option of choice.options(params, N))
                    pictures.set(option.value, JSON.stringify(option.picture));
            expect(new Set(pictures.values()).size, choice.key).toBe(
                pictures.size,
            );
        }
    });
});

describe("a kind's menu", () => {
    const shown = (params: LineParams) =>
        render(
            <ChoiceMenus
                target={{ kind: lineTool, params, spots: N, apply: vi.fn() }}
                envFor={() => env}
            />,
        );

    it("shows the current answer's picture on its button", () => {
        shown(LINES[0]!);
        expect(
            screen.getByTestId("shape-choice-spacing-picture"),
        ).toBeInTheDocument();
        // The same sketch as the answer's own row
        fireEvent.click(screen.getByTestId("shape-choice-spacing"));
        expect(
            screen.getByTestId("shape-choice-spacing-fit-picture").innerHTML,
        ).toBe(screen.getByTestId("shape-choice-spacing-picture").innerHTML);
    });

    it("pictures every row beside its name", () => {
        shown(LINES[0]!);
        fireEvent.click(screen.getByTestId("shape-choice-spacing"));
        for (const value of [
            "fit",
            "keep",
            "path-start",
            "path-center",
            "path-end",
        ])
            expect(
                screen
                    .getByTestId(`shape-choice-spacing-${value}`)
                    .querySelector("svg"),
            ).not.toBeNull();
    });

    it("keeps a greyed-out answer's picture, and its reason", () => {
        shown(LINES[1]!);
        fireEvent.click(screen.getByTestId("shape-choice-measured"));
        const row = screen.getByTestId("shape-choice-measured-x");
        expect(row).toHaveAttribute("aria-disabled", "true");
        // Drawn in the row's color, so greyed with it
        expect(row.className).toContain("text-text/40");
        expect(
            screen.getByTestId("shape-choice-measured-x-picture"),
        ).toBeInTheDocument();
        expect(row).toHaveTextContent("runs straight front to back");
    });
});

describe("who goes where", () => {
    it("pictures every answer, and the current one on its button", () => {
        render(
            <OrderMenu
                target={{
                    order: {
                        current: "reverse",
                        keepOffered: true,
                        pick: vi.fn(),
                    },
                }}
            />,
        );
        const button = screen.getByTestId("shape-order-picture");
        fireEvent.click(screen.getByTestId("shape-order"));
        for (const value of ["nearest", "keep", "reverse"])
            expect(
                screen.getByTestId(`shape-order-${value}-picture`),
            ).toBeInTheDocument();
        expect(button.innerHTML).toBe(
            screen.getByTestId("shape-order-reverse-picture").innerHTML,
        );
    });
});

describe("a picture that picks a marcher out", () => {
    const drawn = (picture: ToolChoicePicture) =>
        render(
            <ChoicePicture
                picture={picture}
                size={ORDER_PICTURE_SIZE}
                testId="picture"
            />,
        ).getByTestId("picture");

    it("draws it solid where it starts and where it lands, and the others as rings", () => {
        const svg = drawn(ORDER_PICTURES.reverse);
        const fitted = fitChoicePicture(
            ORDER_PICTURES.reverse,
            ORDER_PICTURE_SIZE,
        );
        const marked = [...svg.querySelectorAll("circle[data-marked]")];
        expect(marked).toHaveLength(2);
        const at = (el: Element) => ({
            x: Number(el.getAttribute("cx")),
            y: Number(el.getAttribute("cy")),
        });
        // From the old line's first marcher to the new line's last spot
        expect(at(marked[0]!)).toEqual(fitted.faintDots![0]);
        expect(at(marked[1]!)).toEqual(fitted.dots[ORDER_SAMPLE.to.length - 1]);
        // Solid in the text's color, so a greyed-out row (text-text/40) keeps it
        for (const dot of marked) {
            expect(dot.getAttribute("fill")).toBe("currentColor");
            expect(dot.getAttribute("fill-opacity")).toBeNull();
        }
        const rings = [...svg.querySelectorAll("circle:not([data-marked])")];
        expect(rings).toHaveLength(
            ORDER_SAMPLE.from.length + ORDER_SAMPLE.to.length - 2,
        );
        for (const ring of rings) {
            expect(ring.getAttribute("fill")).toBe("none");
            expect(ring.getAttribute("stroke")).toBe("currentColor");
        }
    });

    it("is drawn at the size it's given", () => {
        const svg = drawn(ORDER_PICTURES.keep);
        expect(svg).toHaveAttribute("width", String(ORDER_PICTURE_SIZE.width));
        expect(svg).toHaveAttribute(
            "height",
            String(ORDER_PICTURE_SIZE.height),
        );
    });

    it("leaves a picture without marks drawn exactly as before", () => {
        const plain: ToolChoicePicture = {
            lines: [
                {
                    points: [
                        { x: 0, y: 0 },
                        { x: 40, y: 10 },
                    ],
                },
                {
                    points: [
                        { x: 0, y: 10 },
                        { x: 40, y: 0 },
                    ],
                    faint: true,
                    dashed: true,
                },
                {
                    points: [
                        { x: 0, y: 0 },
                        { x: 40, y: 0 },
                        { x: 20, y: 10 },
                    ],
                    closed: true,
                },
            ],
            dots: [
                { x: 0, y: 0 },
                { x: 20, y: 5 },
            ],
            faintDots: [{ x: 40, y: 10 }],
        };
        const { container } = render(
            <ChoicePicture picture={plain} testId="t" />,
        );
        // The markup from before pictures could mark a marcher
        expect(container.innerHTML).toBe(
            '<svg width="24" height="16" viewBox="0 0 24 16" aria-hidden="true" focusable="false" class="shrink-0" data-testid="t" data-spots="2">' +
                '<polyline points="2,5.5 22,10.5" fill="none" stroke="currentColor" stroke-opacity="0.9" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round"></polyline>' +
                '<polyline points="2,10.5 22,5.5" fill="none" stroke="currentColor" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="1.5 1.5" stroke-linejoin="round" stroke-linecap="round"></polyline>' +
                '<polygon points="2,5.5 22,5.5 12,10.5" fill="none" stroke="currentColor" stroke-opacity="0.9" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round"></polygon>' +
                '<circle cx="22" cy="10.5" r="1" fill="currentColor" fill-opacity="0.4"></circle>' +
                '<circle cx="2" cy="5.5" r="1.1" fill="currentColor"></circle>' +
                '<circle cx="12" cy="8" r="1.1" fill="currentColor"></circle>' +
                "</svg>",
        );
    });
});

describe("fitting a sketch", () => {
    it("fills the picture inside its edges, keeping its proportions", () => {
        const fitted = fitChoicePicture({
            lines: [
                {
                    points: [
                        { x: 100, y: 100 },
                        { x: 300, y: 150 },
                    ],
                },
            ],
            dots: [{ x: 200, y: 125 }],
        });
        const [a, b] = fitted.lines[0]!.points;
        expect(a!.x).toBeGreaterThan(0);
        expect(b!.x).toBeLessThan(CHOICE_PICTURE.width);
        expect((b!.x - a!.x) / (b!.y - a!.y)).toBeCloseTo(4);
        // Centered
        expect(fitted.dots[0]!.x).toBeCloseTo(CHOICE_PICTURE.width / 2);
        expect(fitted.dots[0]!.y).toBeCloseTo(CHOICE_PICTURE.height / 2);
    });
});
