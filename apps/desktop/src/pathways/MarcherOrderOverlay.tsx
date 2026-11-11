/**
 * The order line on the field (pathways step 4g, DL-30, DL-31): through a line's marchers in order,
 * thick at the leader and thin at the tail, sky blue to deep red blended in OKLab, over a thin dark
 * halo; a ring round the leader and an arrow just past the tail. A guessed order is drawn dashed
 * and faded. Position numbers show while Alt is held, and always while Set order is on (touch has
 * no Alt). Set order draws the line it has picked so far, growing behind the pointer, with the bar
 * that says how to go on and keeps or cancels it.
 *
 * The forms are read once per edit (`followOrderForms`), the selection's only unless Always shows
 * every line; what's drawn follows the camera and where the lines' marchers are drawn
 * (`FieldMarchers`), so it's worked out again only when either changes.
 *
 * It's never wider than a dot and stops short of each marcher, so dots and selection rings show
 * through; a leg that runs back over the line bows to one side (`orderLineGeometry`). It sits
 * over the selection box and its handles, takes no presses, and hides while the Follow tool or a
 * shape tool is open (they draw their own ends).
 */
import {
    useEffect,
    useId,
    useMemo,
    useState,
    useSyncExternalStore,
} from "react";
import { useShallow } from "zustand/react/shallow";
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
import { readShortcutContext } from "@/shortcuts/context";
import type { FieldMarchers } from "@/field/three/fieldMarchers";
import {
    fieldToElement,
    useFieldViewStore,
    type FieldView,
} from "@/field/three/fieldView";
import { ordersInForce } from "@/db-functions/rememberedOrder";
import { DOT_RADIUS } from "@/field/editor/hitTest";
import { dotSizes, ringReach } from "@/field/three/selectionRing";
import { useShapeToolStore } from "@/shapes/tool/shapeToolStore";
import {
    Divider,
    EDITOR_BAR,
    EditorButton,
    IconButton,
} from "@/shapes/editor/EditorBarParts";
import {
    followOrderForms,
    formsCover,
    shownOrderOf,
    useMarcherOrderStore,
    withOwnOrder,
    type ShownOrder,
} from "./marcherOrderStore";
import {
    ORDER_HALO_COLOR,
    orderColorAt,
    orderFraction,
    type XY,
} from "./orderSweep";
import {
    legSamples,
    legTangent,
    numberSide,
    orderLegs,
    orderLineSizes,
    orderWidthBetween,
    taperAlong,
    trimLeg,
    type LabelSide,
    type OrderLineSizes,
} from "./orderLineGeometry";
import { usePathPenStore } from "./pathPenStore";

/** How much wider than the line its halo is, each side, in screen pixels */
const HALO = 1;
/** A guessed order: dashed and faded (DL-31) */
const GUESS_DASH = "6 5";
const GUESS_OPACITY = 0.55;
/** The leader's ring: this far outside the dot's selection ring, this thick */
const RING_GAP = 1.5;
const RING_WIDTH = 2;
/** The tail's arrow: its length and half its width, and its gap from the dot's selection ring */
const ARROW_LENGTH = 8;
const ARROW_HALF = 4.5;
const ARROW_GAP = 1.5;
/** Position numbers' size, and their gap from what they sit beside, in screen pixels */
const NUMBER_PX = 11;
const NUMBER_GAP = 2;

/**
 * Whether Alt (Option) is held for the position numbers: not while typing in a text field, nor
 * while a press is held (Alt then changes a drag's snapping, it doesn't ask for numbers); let go
 * when the window loses focus
 */
function useAltHeld(enabled: boolean): boolean {
    const [held, setHeld] = useState(false);
    useEffect(() => {
        if (!enabled) {
            setHeld(false);
            return;
        }
        let alt = false;
        let pressed = false;
        const update = () =>
            setHeld(alt && !pressed && !readShortcutContext().inTextInput);
        const keys = (event: KeyboardEvent) => {
            alt = event.altKey;
            update();
        };
        const down = () => {
            pressed = true;
            update();
        };
        const up = () => {
            pressed = false;
            update();
        };
        const blur = () => {
            alt = false;
            pressed = false;
            update();
        };
        window.addEventListener("keydown", keys, true);
        window.addEventListener("keyup", keys, true);
        window.addEventListener("pointerdown", down, true);
        window.addEventListener("pointerup", up, true);
        window.addEventListener("pointercancel", up, true);
        window.addEventListener("blur", blur);
        return () => {
            window.removeEventListener("keydown", keys, true);
            window.removeEventListener("keyup", keys, true);
            window.removeEventListener("pointerdown", down, true);
            window.removeEventListener("pointerup", up, true);
            window.removeEventListener("pointercancel", up, true);
            window.removeEventListener("blur", blur);
        };
    }, [enabled]);
    return held;
}

/**
 * Where `ids` are drawn (`FieldMarchers.drawn`), as the same map until one of them moves, so a fill
 * that moves no one of them (another marcher dragged, a selection change) works nothing out again
 */
function useDrawnAt(
    marchers: FieldMarchers,
    ids: readonly number[],
    version: number,
): ReadonlyMap<number, XY> {
    const where = useMemo(() => {
        void version;
        const at = marchers.drawn(ids);
        return ids
            .map((id) => {
                const p = at.get(id);
                return p ? `${p.x},${p.y}` : "-";
            })
            .join(";");
    }, [marchers, ids, version]);
    return useMemo(() => {
        void where;
        return marchers.drawn(ids);
    }, [marchers, ids, where]);
}

/** One leg of a line as drawn: the points along it, trimmed clear of its marchers */
interface DrawnPiece {
    readonly samples: readonly XY[];
    readonly colors: readonly [string, string];
    readonly widths: readonly [number, number];
}

/** A position number as drawn: its middle on screen */
interface DrawnNumber {
    readonly at: XY;
    readonly text: string;
    readonly fraction: number;
}

/** A line as drawn, on screen, and how it looks */
interface DrawnLine {
    readonly guessed: boolean;
    readonly pieces: readonly DrawnPiece[];
    /** The leader's ring: its middle, radius and color */
    readonly ring: { at: XY; r: number; color: string } | null;
    /** The arrow past the tail, as SVG points, and its color (not while Set order grows it) */
    readonly arrow: { points: string; color: string } | null;
    readonly numbers: readonly DrawnNumber[];
}

/**
 * A line through `points` (leader first) as drawn: the legs, bowed where one runs back over the
 * line, trimmed clear of each marcher (`marchers` of the points are marchers; a last one past them
 * is Set order's pointer, which the line runs right up to), the leader's ring, the tail's arrow,
 * and the position numbers on the side away from the labels when `numbered`
 */
function drawLine({
    points,
    marchers,
    fractions,
    guessed,
    arrow: withArrow,
    numbered,
    sizes,
    labelSide,
}: {
    points: readonly XY[];
    marchers: number;
    fractions: readonly number[];
    guessed: boolean;
    arrow: boolean;
    numbered: boolean;
    sizes: OrderLineSizes;
    labelSide: LabelSide;
}): DrawnLine {
    if (points.length === 0)
        return { guessed, pieces: [], ring: null, arrow: null, numbers: [] };
    const ringR = sizes.reach + RING_GAP + HALO + RING_WIDTH / 2;
    const ringOut = ringR + RING_WIDTH / 2 + HALO;
    const gapAt = (i: number) =>
        i >= marchers ? 0 : i === 0 ? ringOut + 1 : sizes.gap;
    const legs = orderLegs(points, Math.max(sizes.leader / 2 + 1, 2));
    const pieces = legs.flatMap((leg, i): DrawnPiece[] => {
        const trim = trimLeg(leg, gapAt(i), gapAt(i + 1));
        if (!trim) return [];
        const f0 = fractions[i]!;
        const f1 = fractions[i + 1]!;
        const at = (t: number) => f0 + (f1 - f0) * t;
        return [
            {
                samples: legSamples(leg, trim.t0, trim.t1),
                colors: [orderColorAt(at(trim.t0)), orderColorAt(at(trim.t1))],
                widths: [
                    orderWidthBetween(at(trim.t0), sizes),
                    orderWidthBetween(at(trim.t1), sizes),
                ],
            },
        ];
    });
    const tail = points[marchers - 1];
    const lastLeg = marchers >= 2 ? legs[marchers - 2] : undefined;
    const tailWay = lastLeg ? legTangent(lastLeg, 1) : null;
    const tailColor = orderColorAt(fractions[marchers - 1] ?? 1);
    const arrow =
        withArrow && tail && tailWay
            ? {
                  points: arrowPast(tail, tailWay, sizes.reach),
                  color: tailColor,
              }
            : null;
    // Each number off the legs that leave its marcher, the arrow's among them
    const numbers = numbered
        ? points.slice(0, marchers).map((at, i): DrawnNumber => {
              const ways: XY[] = [];
              const out = legs[i] ? legTangent(legs[i]!, 0) : null;
              if (out) ways.push(out);
              const into = legs[i - 1] ? legTangent(legs[i - 1]!, 1) : null;
              if (into) ways.push({ x: -into.x, y: -into.y });
              if (arrow && i === marchers - 1 && tailWay) ways.push(tailWay);
              const side = numberSide(labelSide, ways);
              const text = `${i + 1}`;
              // Clear of the ring (leader) or the dot's selection ring, then half the text's size
              const halfText =
                  Math.abs(side.x) * (text.length * NUMBER_PX * 0.3) +
                  Math.abs(side.y) * (NUMBER_PX * 0.5);
              const off =
                  (i === 0 ? ringOut : sizes.reach) + NUMBER_GAP + halfText;
              return {
                  at: { x: at.x + side.x * off, y: at.y + side.y * off },
                  text,
                  fraction: fractions[i]!,
              };
          })
        : [];
    return {
        guessed,
        pieces,
        ring: { at: points[0]!, r: ringR, color: orderColorAt(fractions[0]!) },
        arrow,
        numbers,
    };
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
    const always = setting === "always";
    // The Follow tool draws its own ends, and a shape tool its own; the order waits till they close
    const followOpen = usePathPenStore(
        (s) => !!s.session?.follow && s.session.phase !== "closed",
    );
    const shapeOpen = useShapeToolStore((s) => s.tool !== null);
    const labelSide: LabelSide = useUiSettingsStore((s) =>
        s.uiSettings.marcherLabelPosition === "beside" ? "beside" : "above",
    );
    // Set order on has the field, so it shows over either (opening it closes them)
    const showing =
        !isPlaying &&
        (sweep !== null ||
            (!followOpen &&
                !shapeOpen &&
                setting !== "off" &&
                (always || ids.length >= 2)));

    // The forms, read while anything shows the order: the selection's, or everyone's for Always
    const key = ids.join(",");
    useEffect(
        () => (showing ? followOrderForms(always ? "all" : ids) : undefined),
        // `key` is `ids`
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [showing, always, key],
    );
    const formsScope = useMarcherOrderStore((s) => s.formsScope);
    // Forms read for another selection say nothing of this one: nothing is drawn until they're in
    const ready = formsCover(formsScope, always ? "all" : ids);

    // Redrawn when what the field draws changes (a fill, a drag) and when the camera moves
    const version = useSyncExternalStore(
        marchers.subscribe,
        () => marchers.version,
    );
    const view = useFieldViewStore(
        useShallow(
            (s): FieldView => ({
                width: s.width,
                height: s.height,
                zoom: s.zoom,
                panX: s.panX,
                panY: s.panY,
            }),
        ),
    );
    const alt = useAltHeld(showing);

    // The lines in force (Always) follow the forms and the beat, never a fill
    const inForce = useMemo(
        () =>
            showing && !sweep && always && ready && forms
                ? ordersInForce(forms, beat)
                : [],
        [showing, sweep, always, ready, forms, beat],
    );
    // Where the selection stands: the same map until one of them moves
    const ownAt = useDrawnAt(marchers, ids, version);
    const lines = useMemo((): ShownOrder[] => {
        if (!showing || sweep || !ready) return [];
        const own = shownOrderOf(forms, ids, beat, ownAt);
        return always ? withOwnOrder(inForce, own) : own ? [own] : [];
    }, [showing, sweep, ready, forms, ids, beat, ownAt, always, inForce]);

    // Where the lines' marchers stand: the same map until one of them moves
    const lineIds = useMemo(() => lines.flatMap((l) => l.order), [lines]);
    const linesAt = useDrawnAt(marchers, lineIds, version);
    // The dot and its selection ring as the marchers layer draws them, on screen
    const sizes = useMemo(
        () =>
            orderLineSizes(
                DOT_RADIUS * dotSizes(view.zoom).scale * view.zoom,
                ringReach(view.zoom) * view.zoom,
                HALO,
            ),
        [view.zoom],
    );
    const drawn = useMemo((): DrawnLine[] => {
        const onScreen = (p: XY) => fieldToElement(view, p.x, p.y);
        if (sweep) {
            const points = sweep.picked.flatMap((id) => {
                const p = sweep.at.get(id);
                return p ? [onScreen(p)] : [];
            });
            const marchers = points.length;
            const fractions = points.map((_, i) =>
                orderFraction(i, sweep.ids.length),
            );
            if (sweep.pointer && points.length > 0) {
                points.push(onScreen(sweep.pointer));
                fractions.push(fractions.at(-1)!);
            }
            // Numbers show throughout Set order (touch has no Alt)
            return [
                drawLine({
                    points,
                    marchers,
                    fractions,
                    guessed: false,
                    arrow: false,
                    numbered: true,
                    sizes,
                    labelSide,
                }),
            ];
        }
        return lines.map((line) => {
            const points = line.order.flatMap((id) => {
                const p = linesAt.get(id);
                return p ? [onScreen(p)] : [];
            });
            return drawLine({
                points,
                marchers: points.length,
                fractions: points.map((_, i) =>
                    orderFraction(i, points.length),
                ),
                guessed: line.guessed,
                arrow: true,
                numbered: alt,
                sizes,
                labelSide,
            });
        });
    }, [sweep, lines, linesAt, view, sizes, labelSide, alt]);

    const prefix = useId().replace(/:/g, "");
    if (!showing) return null;
    return (
        <>
            {/* Over the selection box and its handles, which still take the presses through it */}
            <svg
                className="pointer-events-none absolute inset-0 z-[5] h-full w-full"
                data-testid="marcherOrderOverlay"
                data-lines={drawn.length}
                data-guessed={drawn.some((l) => l.guessed) || undefined}
            >
                {drawn.map((line, i) => (
                    <OrderLine key={i} id={`${prefix}-${i}`} line={line} />
                ))}
                {drawn.flatMap((line, l) =>
                    line.numbers.map((n, i) => (
                        <text
                            key={`${l}-${i}`}
                            x={n.at.x}
                            y={n.at.y}
                            textAnchor="middle"
                            dominantBaseline="central"
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
                    )),
                )}
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

/** A path through `samples`, for a dashed (guessed) leg */
const pathOf = (samples: readonly XY[]): string =>
    samples.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

/** One line: halo under it, the tapered gradient body, the leader's ring and the tail's arrow */
function OrderLine({ id, line }: { id: string; line: DrawnLine }) {
    const { pieces, guessed, ring, arrow } = line;
    if (!ring) return null;
    return (
        <g
            opacity={guessed ? GUESS_OPACITY : 1}
            data-testid={guessed ? "marcherOrderGuess" : "marcherOrderLine"}
        >
            <defs>
                {pieces.map(({ samples, colors }, i) => (
                    <linearGradient
                        key={i}
                        id={`${id}-${i}`}
                        gradientUnits="userSpaceOnUse"
                        x1={samples[0]!.x}
                        y1={samples[0]!.y}
                        x2={samples.at(-1)!.x}
                        y2={samples.at(-1)!.y}
                    >
                        <stop offset="0" stopColor={colors[0]} />
                        <stop offset="1" stopColor={colors[1]} />
                    </linearGradient>
                ))}
            </defs>
            {guessed ? (
                <>
                    {pieces.map(({ samples, widths }, i) => (
                        <path
                            key={`h${i}`}
                            d={pathOf(samples)}
                            fill="none"
                            stroke={ORDER_HALO_COLOR}
                            strokeWidth={(widths[0] + widths[1]) / 2 + 2 * HALO}
                            strokeDasharray={GUESS_DASH}
                        />
                    ))}
                    {pieces.map(({ samples, widths }, i) => (
                        <path
                            key={i}
                            d={pathOf(samples)}
                            fill="none"
                            stroke={`url(#${id}-${i})`}
                            strokeWidth={(widths[0] + widths[1]) / 2}
                            strokeDasharray={GUESS_DASH}
                        />
                    ))}
                </>
            ) : (
                <>
                    {pieces.map(({ samples, widths }, i) => (
                        <polygon
                            key={`h${i}`}
                            points={taperAlong(
                                samples,
                                widths[0] / 2 + HALO,
                                widths[1] / 2 + HALO,
                            )}
                            fill={ORDER_HALO_COLOR}
                            stroke={ORDER_HALO_COLOR}
                            strokeWidth={0.5}
                            strokeLinejoin="round"
                        />
                    ))}
                    {pieces.map(({ samples, widths }, i) => (
                        <polygon
                            key={i}
                            points={taperAlong(
                                samples,
                                widths[0] / 2,
                                widths[1] / 2,
                            )}
                            fill={`url(#${id}-${i})`}
                        />
                    ))}
                </>
            )}
            {/* The leader's ring, outside the dot and its selection ring */}
            <circle
                cx={ring.at.x}
                cy={ring.at.y}
                r={ring.r}
                fill="none"
                stroke={ORDER_HALO_COLOR}
                strokeWidth={RING_WIDTH + 2 * HALO}
            />
            <circle
                cx={ring.at.x}
                cy={ring.at.y}
                r={ring.r}
                fill="none"
                stroke={ring.color}
                strokeWidth={RING_WIDTH}
                data-testid="marcherOrderLeader"
            />
            {/* The arrow just past the tail, along the last leg's way there */}
            {arrow && (
                <polygon
                    points={arrow.points}
                    fill={arrow.color}
                    stroke={ORDER_HALO_COLOR}
                    strokeWidth={HALO}
                    strokeLinejoin="round"
                    data-testid="marcherOrderTail"
                />
            )}
        </g>
    );
}

/** The tail's arrow, just past the tail's dot and selection ring, pointing on along `way` */
function arrowPast(tail: XY, way: XY, reach: number): string {
    const { x: ux, y: uy } = way;
    const base = {
        x: tail.x + ux * (reach + ARROW_GAP),
        y: tail.y + uy * (reach + ARROW_GAP),
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
