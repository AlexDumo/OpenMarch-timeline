import { useContext, useMemo, type CSSProperties } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import {
    DEFAULT_FIELD_THEME,
    rgbaToString,
    type FieldProperties,
    type FieldTheme,
} from "@openmarch/core";
import { fieldPropertiesKeys } from "@/hooks/queries/useFieldProperties";
import type { OrderChoice } from "../assign";
import {
    animationSequence,
    ORDER_ANIMATION_SIZE,
    ORDER_ANIMATION_STEP,
    orderAnimation,
} from "./orderAnimations";
import "./OrderAnimation.css";

/** A marcher's dot, in CSS px: the field's dot at the picture's scale */
const R = 3.5;
/** A spot on the new line, drawn as the open shape draws its spots */
const SPOT_R = 2.6;
/** The ring around a leader: no drill numbers, so the eye follows this one */
const LEAD_R = R + 2;
/** A start ghost's and a walk's strength, as on the field (FieldOverlay) */
const GHOST_OPACITY = 0.35;
const WALK_ALPHA = 0.4;
/** The second group's dots (Zipper's second line, Within sections' second section) */
const SECOND_FILL = "rgb(37, 99, 235)";

/**
 * The show's field theme, so the picture matches the field, or the default one with no show
 * loaded. Read once as the tip opens, not watched: a tip is only open for a moment.
 */
function useFieldTheme(): FieldTheme {
    const client = useContext(QueryClientContext);
    return (
        client?.getQueryData<FieldProperties>(fieldPropertiesKeys.detail())
            ?.theme ?? DEFAULT_FIELD_THEME
    );
}

/**
 * Who goes where's walking picture in an option's tip (09-who-goes-where.md): a piece of field,
 * drawn the way the field draws an open shape. Seven marchers walk from where they stand to the
 * spots the option gives them on a new form, worked out by the real assignment
 * (`orderAnimations.ts`). They carry no drill numbers, so they can't pass for the show's own
 * marchers; a ringed leader shows the order. Faint ghosts mark where they started and faint lines their walks, so the
 * picture also reads as a still, which is what people asking for reduced motion get. It's
 * decoration: the tip's words say what the option does.
 */
export function OrderAnimation({
    choice,
    testId,
}: {
    choice: OrderChoice;
    testId?: string;
}) {
    const picture = useMemo(() => orderAnimation(choice), [choice]);
    const theme = useFieldTheme();
    const { width, height } = ORDER_ANIMATION_SIZE;
    const step = ORDER_ANIMATION_STEP;
    const shape = rgbaToString(theme.shape);
    const walk = rgbaToString({ ...theme.shape, a: WALK_ALPHA });
    const fill = (group: 0 | 1) =>
        group ? SECOND_FILL : rgbaToString(theme.defaultMarcher.fill);
    // Grid lines through the first spot: every step faint, every fourth darker
    const origin = picture.spots[0]!;
    const x0 = origin.x % step;
    const y0 = origin.y % step;
    const grid = (count: number, offset: number) =>
        Array.from({ length: count }, (_, i) => offset + i * step);
    const xs = grid(Math.ceil(width / step), x0);
    const ys = grid(Math.ceil(height / step), y0);
    const strong = (v: number, origin: number) =>
        Math.round((v - origin) / step) % 4 === 0;
    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden
            focusable={false}
            className="rounded-4 shrink-0"
            data-testid={testId}
            data-sequence={animationSequence(picture)}
        >
            <rect
                width={width}
                height={height}
                fill={rgbaToString(theme.background)}
            />
            {xs.map((x) => (
                <line
                    key={`gx${x}`}
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={height}
                    stroke={rgbaToString(
                        strong(x, origin.x)
                            ? theme.secondaryStroke
                            : theme.tertiaryStroke,
                    )}
                    strokeWidth={0.5}
                />
            ))}
            {ys.map((y) => (
                <line
                    key={`gy${y}`}
                    x1={0}
                    y1={y}
                    x2={width}
                    y2={y}
                    stroke={rgbaToString(
                        strong(y, origin.y)
                            ? theme.secondaryStroke
                            : theme.tertiaryStroke,
                    )}
                    strokeWidth={0.5}
                />
            ))}
            {picture.marchers.map(({ from, group }, i) => (
                <circle
                    key={`ghost-${i}`}
                    cx={from.x}
                    cy={from.y}
                    r={R}
                    fill={fill(group)}
                    opacity={GHOST_OPACITY}
                />
            ))}
            {picture.marchers.map(({ from, to }, i) => (
                <line
                    key={`walk-${i}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={walk}
                    strokeWidth={1}
                />
            ))}
            {picture.outline.map((points, i) => (
                <polyline
                    key={`outline-${i}`}
                    points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke={shape}
                    strokeWidth={1}
                />
            ))}
            {picture.spots.map((p, i) => (
                <circle
                    key={`spot-${i}`}
                    cx={p.x}
                    cy={p.y}
                    r={SPOT_R}
                    fill={shape}
                    stroke="white"
                    strokeWidth={1}
                />
            ))}
            {picture.marchers.map(({ from, to, group, lead }, i) => (
                <g
                    key={`walker-${i}`}
                    className="order-walk"
                    data-testid={testId ? `${testId}-marcher` : undefined}
                    data-lead={lead || undefined}
                    style={
                        {
                            "--dx": `${to.x - from.x}px`,
                            "--dy": `${to.y - from.y}px`,
                        } as CSSProperties
                    }
                >
                    <circle
                        cx={from.x}
                        cy={from.y}
                        r={R}
                        fill={fill(group)}
                        stroke={rgbaToString(theme.defaultMarcher.outline)}
                        strokeWidth={0.5}
                    />
                    {lead && (
                        <circle
                            cx={from.x}
                            cy={from.y}
                            r={LEAD_R}
                            fill="none"
                            stroke={rgbaToString(theme.defaultMarcher.label)}
                            strokeWidth={1}
                        />
                    )}
                </g>
            ))}
        </svg>
    );
}
