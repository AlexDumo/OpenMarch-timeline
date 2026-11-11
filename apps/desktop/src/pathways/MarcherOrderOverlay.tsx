/**
 * The order line on the field (pathways step 4g, DL-30, DL-31): through a line's marchers in order,
 * thick at the leader and thin at the tail, sky blue to deep red blended in OKLab, over a thin dark
 * halo; a ring round the leader and an arrow just past the tail. A guessed order is drawn dashed
 * and faded. Position numbers show while Alt is held, and always while Set order is on (touch has
 * no Alt). Set order draws the line it has picked so far, growing behind the pointer, with the bar
 * that says how to go on and keeps or cancels it.
 *
 * The forms are read once per edit (`followOrderForms`); what's drawn follows the marchers drawn
 * (`FieldMarchers`) and the camera, so it's worked out again only when either changes.
 */
import {
    useEffect,
    useId,
    useMemo,
    useState,
    useSyncExternalStore,
} from "react";
import { CheckIcon, XIcon } from "@phosphor-icons/react";
import { T } from "@tolgee/react";
import tolgee from "@/global/singletons/Tolgee";
import Shortcut from "@/components/ui/Shortcut";
import { performersOnly } from "@/global/classes/Marcher";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useIsPlaying } from "@/context/IsPlayingContext";
import {
    fieldBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { runAction } from "@/shortcuts/registry";
import type { FieldMarchers } from "@/field/three/fieldMarchers";
import { fieldToElement, useFieldViewStore } from "@/field/three/fieldView";
import { DOT_RADIUS } from "@/field/editor/hitTest";
import {
    Divider,
    EDITOR_BAR,
    EditorButton,
    IconButton,
} from "@/shapes/editor/EditorBarParts";
import {
    followOrderForms,
    shownOrders,
    useMarcherOrderStore,
    type ShownOrder,
} from "./marcherOrderStore";
import {
    ORDER_HALO_COLOR,
    orderColorAt,
    orderFraction,
    orderWidthAt,
    type XY,
} from "./orderSweep";

/** How much wider than the line its halo is, each side, in screen pixels */
const HALO = 1.5;
/** A guessed order: dashed and faded (DL-31) */
const GUESS_DASH = "6 5";
const GUESS_OPACITY = 0.55;
/** The leader's ring: this far outside the dot, this thick */
const RING_GAP = 4;
const RING_WIDTH = 2.5;
/** The tail's arrow: its length and half its width, and its gap from the dot */
const ARROW_LENGTH = 9;
const ARROW_HALF = 5;
const ARROW_GAP = 3;
/** Position numbers' size and offset from the dot, in screen pixels */
const NUMBER_PX = 11;
const NUMBER_OFFSET = 9;

/** Whether Alt (Option) is held, for the position numbers; let go when the window loses focus */
function useAltHeld(enabled: boolean): boolean {
    const [held, setHeld] = useState(false);
    useEffect(() => {
        if (!enabled) {
            setHeld(false);
            return;
        }
        const keys = (event: KeyboardEvent) => setHeld(event.altKey);
        const blur = () => setHeld(false);
        window.addEventListener("keydown", keys, true);
        window.addEventListener("keyup", keys, true);
        window.addEventListener("blur", blur);
        return () => {
            window.removeEventListener("keydown", keys, true);
            window.removeEventListener("keyup", keys, true);
            window.removeEventListener("blur", blur);
        };
    }, [enabled]);
    return held;
}

/** A line as drawn: its points on screen, leader first, and how it looks */
interface DrawnLine {
    readonly points: readonly XY[];
    readonly guessed: boolean;
    /** Where along the colors each point is, 0 at the leader and 1 at the tail */
    readonly fractions: readonly number[];
    /** The leader's ring and the tail's arrow (not while Set order grows it) */
    readonly ends: boolean;
}

export default function MarcherOrderOverlay({
    marchers,
}: {
    marchers: FieldMarchers;
}) {
    const setting = useUiSettingsStore(
        (s) => s.uiSettings.marcherOrder ?? "selected",
    );
    const isPlaying = useIsPlaying()?.isPlaying ?? false;
    const sweep = useMarcherOrderStore((s) => s.sweep);
    const forms = useMarcherOrderStore((s) => s.forms);
    const selected = useSelectedMarchers()?.selectedMarchers;
    const ids = useMemo(
        () =>
            performersOnly(selected ?? [])
                .map((m) => m.id)
                .sort((a, b) => a - b),
        [selected],
    );
    const beat = useTimelineSelectionStore(fieldBeat);
    const showing =
        !isPlaying &&
        (sweep !== null ||
            (setting !== "off" && (setting === "always" || ids.length >= 2)));

    // The forms, read while anything shows the order
    useEffect(() => (showing ? followOrderForms() : undefined), [showing]);

    // Redrawn when what the field draws changes (a fill, a drag) and when the camera moves
    const version = useSyncExternalStore(
        marchers.subscribe,
        () => marchers.version,
    );
    const view = useFieldViewStore();
    const alt = useAltHeld(showing);

    const lines = useMemo((): ShownOrder[] => {
        void version;
        if (!showing || sweep) return [];
        const always = setting === "always";
        const at = marchers.drawn(always ? marchers.ids : ids);
        return shownOrders({ forms, selected: ids, beat, at, always });
    }, [showing, sweep, setting, marchers, ids, beat, forms, version]);

    const drawn = useMemo((): DrawnLine[] => {
        void version;
        const onScreen = (p: XY) => fieldToElement(view, p.x, p.y);
        if (sweep) {
            const points = sweep.picked.flatMap((id) => {
                const p = sweep.at.get(id);
                return p ? [onScreen(p)] : [];
            });
            const fractions = points.map((_, i) =>
                orderFraction(i, sweep.ids.length),
            );
            if (sweep.pointer && points.length > 0) {
                points.push(onScreen(sweep.pointer));
                fractions.push(fractions.at(-1)!);
            }
            return [{ points, guessed: false, fractions, ends: false }];
        }
        const ats = marchers.drawn(lines.flatMap((l) => l.order));
        return lines.map((line) => {
            const points = line.order.flatMap((id) => {
                const p = ats.get(id);
                return p ? [onScreen(p)] : [];
            });
            return {
                points,
                guessed: line.guessed,
                fractions: points.map((_, i) =>
                    orderFraction(i, points.length),
                ),
                ends: true,
            };
        });
    }, [sweep, lines, marchers, view, version]);

    // Position numbers: while Alt is held, or always while Set order is on (touch has no Alt)
    const numbers = useMemo((): {
        at: XY;
        text: string;
        fraction: number;
    }[] => {
        if (sweep)
            return sweep.picked.flatMap((id, i) => {
                const p = sweep.at.get(id);
                return p
                    ? [
                          {
                              at: fieldToElement(view, p.x, p.y),
                              text: `${i + 1}`,
                              fraction: orderFraction(i, sweep.ids.length),
                          },
                      ]
                    : [];
            });
        if (!alt) return [];
        return drawn.flatMap((line) =>
            line.points.map((at, i) => ({
                at,
                text: `${i + 1}`,
                fraction: line.fractions[i]!,
            })),
        );
    }, [sweep, alt, drawn, view]);

    const dot = Math.max(DOT_RADIUS * view.zoom, 4);
    const prefix = useId().replace(/:/g, "");
    if (!showing) return null;
    return (
        <>
            <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                data-testid="marcherOrderOverlay"
                data-lines={drawn.length}
                data-guessed={drawn.some((l) => l.guessed) || undefined}
            >
                {drawn.map((line, i) => (
                    <OrderLine
                        key={i}
                        id={`${prefix}-${i}`}
                        line={line}
                        dot={dot}
                    />
                ))}
                {numbers.map((n, i) => (
                    <text
                        key={i}
                        x={n.at.x + NUMBER_OFFSET}
                        y={n.at.y - NUMBER_OFFSET}
                        fontSize={NUMBER_PX}
                        fontWeight={700}
                        fill={orderColorAt(n.fraction)}
                        stroke={ORDER_HALO_COLOR}
                        strokeWidth={3}
                        paintOrder="stroke"
                        data-testid="marcherOrderNumber"
                    >
                        {n.text}
                    </text>
                ))}
            </svg>
            {sweep && (
                <OrderSweepBar
                    picked={sweep.picked.length}
                    of={sweep.ids.length}
                />
            )}
        </>
    );
}

/** One line: halo under it, the tapered gradient body, the leader's ring and the tail's arrow */
function OrderLine({
    id,
    line,
    dot,
}: {
    id: string;
    line: DrawnLine;
    dot: number;
}) {
    const { points, fractions, guessed } = line;
    if (points.length === 0) return null;
    const widths = fractions.map(orderWidthAt);
    const colors = fractions.map(orderColorAt);
    const segments = points.slice(1).map((to, i) => ({
        from: points[i]!,
        to,
        i,
    }));
    const head = points[0]!;
    const tail = points.at(-1)!;
    const before = points.length >= 2 ? points.at(-2)! : null;
    const arrow = line.ends && before ? arrowPast(before, tail, dot) : null;
    return (
        <g
            opacity={guessed ? GUESS_OPACITY : 1}
            data-testid={guessed ? "marcherOrderGuess" : "marcherOrderLine"}
        >
            <defs>
                {segments.map(({ from, to, i }) => (
                    <linearGradient
                        key={i}
                        id={`${id}-${i}`}
                        gradientUnits="userSpaceOnUse"
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                    >
                        <stop offset="0" stopColor={colors[i]} />
                        <stop offset="1" stopColor={colors[i + 1]} />
                    </linearGradient>
                ))}
            </defs>
            {guessed ? (
                <>
                    {segments.map(({ from, to, i }) => (
                        <line
                            key={`h${i}`}
                            x1={from.x}
                            y1={from.y}
                            x2={to.x}
                            y2={to.y}
                            stroke={ORDER_HALO_COLOR}
                            strokeWidth={
                                (widths[i]! + widths[i + 1]!) / 2 + 2 * HALO
                            }
                            strokeDasharray={GUESS_DASH}
                        />
                    ))}
                    {segments.map(({ from, to, i }) => (
                        <line
                            key={i}
                            x1={from.x}
                            y1={from.y}
                            x2={to.x}
                            y2={to.y}
                            stroke={`url(#${id}-${i})`}
                            strokeWidth={(widths[i]! + widths[i + 1]!) / 2}
                            strokeDasharray={GUESS_DASH}
                        />
                    ))}
                </>
            ) : (
                <>
                    {segments.map(({ from, to, i }) => (
                        <polygon
                            key={`h${i}`}
                            points={taper(
                                from,
                                to,
                                widths[i]! / 2 + HALO,
                                widths[i + 1]! / 2 + HALO,
                            )}
                            fill={ORDER_HALO_COLOR}
                        />
                    ))}
                    {points.map((p, i) => (
                        <circle
                            key={`hj${i}`}
                            cx={p.x}
                            cy={p.y}
                            r={widths[i]! / 2 + HALO}
                            fill={ORDER_HALO_COLOR}
                        />
                    ))}
                    {segments.map(({ from, to, i }) => (
                        <polygon
                            key={i}
                            points={taper(
                                from,
                                to,
                                widths[i]! / 2,
                                widths[i + 1]! / 2,
                            )}
                            fill={`url(#${id}-${i})`}
                        />
                    ))}
                    {points.map((p, i) => (
                        <circle
                            key={`j${i}`}
                            cx={p.x}
                            cy={p.y}
                            r={widths[i]! / 2}
                            fill={colors[i]}
                        />
                    ))}
                </>
            )}
            {/* The leader's ring */}
            <circle
                cx={head.x}
                cy={head.y}
                r={dot + RING_GAP}
                fill="none"
                stroke={ORDER_HALO_COLOR}
                strokeWidth={RING_WIDTH + 2 * HALO}
            />
            <circle
                cx={head.x}
                cy={head.y}
                r={dot + RING_GAP}
                fill="none"
                stroke={colors[0]}
                strokeWidth={RING_WIDTH}
                data-testid="marcherOrderLeader"
            />
            {/* The arrow just past the tail */}
            {arrow && (
                <polygon
                    points={arrow}
                    fill={colors.at(-1)}
                    stroke={ORDER_HALO_COLOR}
                    strokeWidth={HALO}
                    strokeLinejoin="round"
                    data-testid="marcherOrderTail"
                />
            )}
        </g>
    );
}

/** A segment as a band `a` wide at `from` and `b` wide at `to` (half widths), for SVG `points` */
function taper(from: XY, to: XY, a: number, b: number): string {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    return [
        [from.x + nx * a, from.y + ny * a],
        [to.x + nx * b, to.y + ny * b],
        [to.x - nx * b, to.y - ny * b],
        [from.x - nx * a, from.y - ny * a],
    ]
        .map(([x, y]) => `${x},${y}`)
        .join(" ");
}

/** The tail's arrow, just past the tail's dot, pointing on along the line's last leg */
function arrowPast(before: XY, tail: XY, dot: number): string | null {
    const dx = tail.x - before.x;
    const dy = tail.y - before.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return null;
    const ux = dx / length;
    const uy = dy / length;
    const base = {
        x: tail.x + ux * (dot + ARROW_GAP),
        y: tail.y + uy * (dot + ARROW_GAP),
    };
    const tip = {
        x: base.x + ux * ARROW_LENGTH,
        y: base.y + uy * ARROW_LENGTH,
    };
    return [
        [tip.x, tip.y],
        [base.x - uy * ARROW_HALF, base.y + ux * ARROW_HALF],
        [base.x + uy * ARROW_HALF, base.y - ux * ARROW_HALF],
    ]
        .map(([x, y]) => `${x},${y}`)
        .join(" ");
}

/**
 * Set order's bar, over the field's top: how to go on, how many are picked, and Cancel and Done,
 * which touch reaches without Escape or Enter
 */
function OrderSweepBar({ picked, of }: { picked: number; of: number }) {
    return (
        <div
            className={`${EDITOR_BAR} text-body text-text pointer-events-auto absolute top-12 left-1/2 z-10 -translate-x-1/2 gap-6 whitespace-nowrap`}
            data-testid="order-sweep-bar"
        >
            <span className="px-4">
                <T
                    keyName="pathways.order.banner"
                    defaultValue="Set order: drag through the marchers from the leader, or click them one by one · {picked} of {count}"
                    params={{ picked, count: of }}
                />
            </span>
            <Divider />
            <IconButton
                label={tolgee.t("pathways.order.cancel", "Cancel Set order")}
                action="cancelAlignmentUpdates"
                onClick={() => runAction("cancelAlignmentUpdates")}
                testId="order-sweep-cancel"
            >
                <XIcon size={14} />
            </IconButton>
            <EditorButton
                onClick={() => runAction("applyShape")}
                testId="order-sweep-done"
            >
                <CheckIcon size={14} />
                {tolgee.t("pathways.order.doneButton", "Done")}
                <Shortcut action="applyShape" />
            </EditorButton>
        </div>
    );
}
