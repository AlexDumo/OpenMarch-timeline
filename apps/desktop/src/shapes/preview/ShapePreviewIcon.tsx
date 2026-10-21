import { useMemo } from "react";
import type { AnyToolKind } from "../tool/toolKind";
import { PREVIEW_VIEW, shapePreview } from "./shapePreview";

/**
 * A shape's picture, drawn from its own spots and outline (#378), in place of an icon. Every
 * place that offers shapes shows this one: the Shapes tab, the ring, the library and the command
 * bar. It's decoration: the button around it carries the shape's name.
 */
export default function ShapePreviewIcon({
    kind,
    size = 22,
    bold = false,
    className,
}: {
    kind: AnyToolKind;
    /** Width and height, in pixels */
    size?: number;
    /** Bigger dots, for the armed or aimed-at shape */
    bold?: boolean;
    className?: string;
}) {
    const { spots, outline } = useMemo(() => shapePreview(kind), [kind]);
    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${PREVIEW_VIEW} ${PREVIEW_VIEW}`}
            aria-hidden
            focusable={false}
            className={className}
            data-testid="shape-preview"
            data-spots={spots.length}
        >
            {outline && (
                <polygon
                    points={outline.map(({ x, y }) => `${x},${y}`).join(" ")}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity={0.45}
                    strokeWidth={bold ? 1.5 : 1}
                    strokeLinejoin="round"
                />
            )}
            {spots.map(({ x, y }, i) => (
                <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={bold ? 2 : 1.6}
                    fill="currentColor"
                />
            ))}
        </svg>
    );
}
