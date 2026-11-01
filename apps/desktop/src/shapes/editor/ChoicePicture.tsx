import { useMemo } from "react";
import type { ToolChoicePicture } from "../tool/toolKind";
import { CHOICE_PICTURE, fitChoicePicture } from "../preview/choicePicture";

/**
 * An answer's sketch (#559), beside its name in a shape menu and on the menu's button. Drawn in
 * the text's color, so it follows the theme, the picked answer's accent and a greyed-out answer.
 * It's decoration: the name beside it says what it is.
 */
export function ChoicePicture({
    picture,
    testId,
    size = CHOICE_PICTURE,
}: {
    picture: ToolChoicePicture;
    testId?: string;
    /** In CSS px; the menus' usual size unless a menu needs more room */
    size?: { readonly width: number; readonly height: number };
}) {
    const fitted = useMemo(
        () => fitChoicePicture(picture, size),
        [picture, size],
    );
    const { width, height } = size;
    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden
            focusable={false}
            className="shrink-0"
            data-testid={testId}
            data-spots={fitted.dots.length}
        >
            {fitted.lines.map((line, i) => {
                const props = {
                    points: line.points
                        .map(({ x, y }) => `${x},${y}`)
                        .join(" "),
                    fill: "none",
                    stroke: "currentColor",
                    strokeOpacity: line.faint ? 0.5 : 0.9,
                    strokeWidth: line.faint ? 1 : 1.25,
                    strokeDasharray: line.dashed ? "1.5 1.5" : undefined,
                    strokeLinejoin: "round" as const,
                    strokeLinecap: "round" as const,
                };
                return line.closed ? (
                    <polygon key={i} {...props} />
                ) : (
                    <polyline key={i} {...props} />
                );
            })}
            {fitted.faintDots?.map(({ x, y }, i) =>
                fitted.marked === undefined ? (
                    <circle
                        key={`from-${i}`}
                        cx={x}
                        cy={y}
                        r={1}
                        fill="currentColor"
                        fillOpacity={0.4}
                    />
                ) : (
                    <MarkedDot
                        key={`from-${i}`}
                        x={x}
                        y={y}
                        marked={i === fitted.marked.faintDot}
                        faint
                    />
                ),
            )}
            {fitted.dots.map(({ x, y }, i) =>
                fitted.marked === undefined ? (
                    <circle key={i} cx={x} cy={y} r={1.1} fill="currentColor" />
                ) : (
                    <MarkedDot
                        key={i}
                        x={x}
                        y={y}
                        marked={i === fitted.marked.dot}
                    />
                ),
            )}
        </svg>
    );
}

/**
 * A marcher in a picture that picks one out: the picked one a solid dot, larger, at both ends of
 * its move; the others rings, those where they come from fainter
 */
function MarkedDot({
    x,
    y,
    marked,
    faint = false,
}: {
    x: number;
    y: number;
    marked: boolean;
    faint?: boolean;
}) {
    return marked ? (
        <circle cx={x} cy={y} r={2.2} fill="currentColor" data-marked="" />
    ) : (
        <circle
            cx={x}
            cy={y}
            r={1.4}
            fill="none"
            stroke="currentColor"
            strokeOpacity={faint ? 0.6 : 0.9}
            strokeWidth={0.8}
        />
    );
}
