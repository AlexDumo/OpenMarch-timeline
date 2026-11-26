import { flagPictureLayout } from "@/showAssets/flagPicture";
import { cutPathData } from "@/view3d/core/sizes/silkCuts";
import { silkShape, type SilkShapeId } from "@/view3d/core/sizes/silkShapes";

/** The drawing's own size, in its units: scaled to the element's size */
const BOX = 128;

/**
 * A silk shape as an outline on its pole (fork #985): the same layout as a flag's picture
 * (`flagPicture.ts`), so the shape a designer picks is the shape the picture shows.
 */
export function SilkShapeOutline({
    shape,
    className,
}: {
    shape: SilkShapeId;
    className?: string;
}) {
    const { pad, pole, scale, silkX, silkY } = flagPictureLayout(shape, BOX);
    return (
        <svg
            viewBox={`0 0 ${BOX} ${BOX}`}
            className={className}
            aria-hidden
            data-shape={shape}
        >
            <rect
                x={pad}
                y={pad}
                width={pole}
                height={BOX - 2 * pad}
                rx={pole / 2}
                className="fill-text-subtitle"
            />
            <path
                d={cutPathData(silkShape(shape).path)}
                transform={`translate(${silkX} ${silkY}) scale(${scale})`}
                fillRule="evenodd"
                className="fill-accent/25 stroke-accent"
                strokeWidth={2 / scale}
                strokeLinejoin="round"
            />
        </svg>
    );
}
