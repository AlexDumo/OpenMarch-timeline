/**
 * A line's order on the field (pathways step 4h, design E "the lane"): a soft neutral lane under
 * the line's dots, cut away round every dot so dots and selection rings keep their own color, with a
 * solid tip past the leader (the drawing rules are `orderLane`). An order that runs back over its own
 * marchers loses the tip and shows its numbers; one whose legs cross thins to a thread with darts and
 * shows its numbers. A guessed order isn't drawn at rest; while Alt is held it shows hollow and
 * dashed. Position badges show while Alt is held, and always while Set order is on (touch has no
 * Alt). Set order draws the lane it has picked so far, growing behind the pointer, with the bar that
 * says how to go on and keeps or cancels it.
 *
 * The forms are read once per edit (`followOrderForms`), the selection's only unless Always shows
 * every line; what's drawn follows the camera and where the lines' marchers are drawn
 * (`FieldMarchers`), so it's worked out again only when either changes. It sits over the selection
 * box and its handles, takes no presses, and hides while the Follow tool or a shape tool is open
 * (they draw their own ends).
 */
import {
    useEffect,
    useId,
    useMemo,
    useRef,
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
import type { FieldTheme } from "@openmarch/core";
import { useFieldViewStore, type FieldView } from "@/field/three/fieldView";
import { ordersInForce } from "@/db-functions/rememberedOrder";
import { DOT_RADIUS } from "@/field/editor/hitTest";
import { dotSizes, ringReach } from "@/field/three/selectionRing";
import {
    labelBoxAt,
    autoLabelSizeOf,
    labelSizeOf,
    type LabelStyle,
} from "@/field/three/layers/LabelsLayer";
import type { GlyphAtlas } from "@/field/three/sdfText";
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
import type { XY } from "./orderSweep";
import {
    BADGE_FONT,
    BADGE_HEIGHT,
    badgeWidth,
    classifyOrder,
    laneDarts,
    laneHalfWidth,
    laneTip,
    neighborHalfWidths,
    placeNumbers,
    threadDarts,
    type Box,
    type OrderLaneKind,
    type PlacedBadge,
} from "./orderLane";
import { usePathPenStore } from "./pathPenStore";

/** The lane's dark ink: the tip, the leader's badge, the darts */
const LANE_INK = "#1c1f26";

/** The lane's colors on a light or a dark field: neutral only, so red stays marchers and blue selection */
interface LaneInk {
    readonly lane: string;
    readonly thread: string;
    readonly guess: string;
    readonly guessTip: string;
    readonly edge: string;
    readonly dart: string;
    readonly threadDart: string;
    readonly dartOpacity: number;
}

function laneInk(dark: boolean): LaneInk {
    return dark
        ? {
              lane: "rgba(255,255,255,0.30)",
              thread: "rgba(255,255,255,0.85)",
              guess: "rgba(255,255,255,0.9)",
              guessTip: "rgba(255,255,255,0.15)",
              edge: "rgba(255,255,255,0.9)",
              dart: LANE_INK,
              threadDart: "#fff",
              dartOpacity: 0.75,
          }
        : {
              lane: "rgba(28,31,38,0.15)",
              thread: "rgba(28,31,38,0.55)",
              guess: "rgba(28,31,38,0.6)",
              guessTip: "#fff",
              edge: "none",
              dart: LANE_INK,
              threadDart: LANE_INK,
              dartOpacity: 0.5,
          };
}

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

/**
 * Where every marcher (not an item) is drawn, in field units, as the same array until one of them
 * moves: the marchers a leg of the line mustn't cover
 */
function useEveryoneAt(
    marchers: FieldMarchers,
    version: number,
    enabled: boolean,
): readonly XY[] {
    const last = useRef<readonly XY[]>([]);
    return useMemo(() => {
        void version;
        if (!enabled) return (last.current = []);
        const at: XY[] = [];
        const { positions, hidden, isItem } = marchers;
        for (let i = 0; i < marchers.ids.length; i++)
            if (!hidden[i] && !isItem[i])
                at.push({ x: positions[i * 2]!, y: positions[i * 2 + 1]! });
        const before = last.current;
        const same =
            before.length === at.length &&
            before.every((p, i) => p.x === at[i]!.x && p.y === at[i]!.y);
        return same ? before : (last.current = at);
    }, [marchers, version, enabled]);
}

/** The marchers' name labels as the field draws them, for the line to keep clear of */
export interface OrderLabels {
    /** Each marcher's label text, by id */
    readonly text: ReadonlyMap<number, string>;
    readonly style: LabelStyle;
    /** The labels' font, to measure them */
    readonly atlas: GlyphAtlas;
    /**
     * Labels smaller than this on screen, in CSS px per em, aren't drawn: the field quality's
     * `labelFadeFrom`
     */
    readonly fadeFrom: number;
}

/** A line as drawn, on screen, and how it looks */
interface DrawnLine {
    readonly kind: OrderLaneKind;
    readonly guessed: boolean;
    /** Leader first; Set order's pointer last while it grows the line */
    readonly points: readonly XY[];
    readonly halfWidth: number;
    /** The solid tip past the leader (a plain lane only) */
    readonly tip: string | null;
    readonly darts: readonly string[];
    readonly numbers: readonly PlacedBadge[];
    /** Some numbers had no room: only the ends show, and the field asks for a closer zoom */
    readonly crowded: boolean;
    /** The lane's box, for the closer-zoom note */
    readonly box: Box;
}

/**
 * A line through `points` (leader first; the first `marchers` are marchers, a last one past them is
 * Set order's pointer) as drawn: its kind, the tip and darts of a plain lane, and its numbers when
 * `numbered` or when the lane can't tell the order (doubling back, crossing). Numbers keep clear of
 * the tip, the marchers' name labels (`busy`) and every dot (`dots`).
 */
function drawLine({
    points,
    marchers,
    guessed,
    numbered,
    halfWidth,
    dotRadius,
    busy,
    dots,
}: {
    points: readonly XY[];
    marchers: number;
    guessed: boolean;
    numbered: boolean;
    halfWidth: number;
    dotRadius: number;
    busy: readonly Box[];
    dots: readonly XY[];
}): DrawnLine {
    const own = points.slice(0, marchers);
    const kind = classifyOrder(points, dotRadius);
    const tip = kind === "lane" ? laneTip(points, halfWidth) : null;
    const darts =
        kind === "lane"
            ? laneDarts(points, dotRadius)
            : kind === "crossed"
              ? threadDarts(points)
              : [];
    const { badges, crowded } =
        numbered || kind !== "lane"
            ? placeNumbers({
                  points: own,
                  kind,
                  halfWidth,
                  dotRadius,
                  busy: tip ? [...busy, tip.box] : busy,
                  dots,
              })
            : { badges: [], crowded: false };
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return {
        kind,
        guessed,
        points,
        halfWidth,
        tip: tip?.points ?? null,
        darts,
        numbers: badges,
        crowded,
        box: {
            minX: Math.min(...xs) - halfWidth,
            minY: Math.min(...ys) - halfWidth,
            maxX: Math.max(...xs) + halfWidth,
            maxY: Math.max(...ys) + halfWidth,
        },
    };
}

/** Whether a field color is dark enough that the lane turns light on it */
function isDarkField({
    r,
    g,
    b,
}: {
    r: number;
    g: number;
    b: number;
}): boolean {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
}

export default function MarcherOrderOverlay({
    marchers,
    labels,
    theme,
}: {
    marchers: FieldMarchers;
    /** The field's colors: on a dark field the lane turns light */
    theme: FieldTheme;
    /** The marchers' name labels as drawn; none: the line doesn't keep clear of them */
    labels?: OrderLabels;
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
    const dotRadius = DOT_RADIUS * dotSizes(view.zoom).scale * view.zoom;
    const reach = ringReach(view.zoom) * view.zoom;
    // Everyone under a lane, whose dots it's cut away from: the same array until one of them moves
    const everyoneAt = useEveryoneAt(marchers, version, showing);
    // Worked out on screen but with the pan left out (the field scaled by the zoom, then moved by
    // the pan), so panning only moves what's drawn (the SVG group below) and works nothing out again
    const zoom = view.zoom;
    const everyone = useMemo(
        () => everyoneAt.map((p) => ({ x: p.x * zoom, y: p.y * zoom })),
        [everyoneAt, zoom],
    );
    // The size the labels are drawn at: Auto's for where everyone stands, else the style's
    const labelSize = useMemo(
        () =>
            !showing || !labels
                ? 0
                : labels.style.form === "auto"
                  ? autoLabelSizeOf(
                        labels.style,
                        marchers,
                        labels.text,
                        labels.atlas,
                    )
                  : labelSizeOf(labels.style),
        // `version` is where everyone stands
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [showing, labels, marchers, version],
    );
    const selectedSet = useMemo(() => new Set(ids), [ids]);
    const drawn = useMemo((): DrawnLine[] => {
        const onScreen = (p: XY): XY => ({ x: p.x * zoom, y: p.y * zoom });
        // Every drawn label's ink on screen, when labels are drawn and big enough to read: numbers
        // keep clear of them
        const labelBox = (id: number, p: XY): Box | null => {
            const text = labels?.text.get(id);
            if (
                !labels ||
                !text ||
                labels.style.form === "off" ||
                labelSize * zoom <= labels.fadeFrom
            )
                return null;
            const box = labelBoxAt(
                p.x,
                p.y,
                labels.atlas.measure(text),
                labelSize,
                labels.style.beside,
                true,
            );
            return {
                minX: (box.x - box.width / 2) * zoom,
                minY: (box.y - box.height / 2) * zoom,
                maxX: (box.x + box.width / 2) * zoom,
                maxY: (box.y + box.height / 2) * zoom,
            };
        };
        const busyOf = (
            order: readonly number[],
            at: ReadonlyMap<number, XY>,
        ) =>
            order.flatMap((id) => {
                const p = at.get(id);
                const box = p ? labelBox(id, p) : null;
                return box ? [box] : [];
            });
        if (sweep) {
            const points = sweep.picked.flatMap((id) => {
                const p = sweep.at.get(id);
                return p ? [onScreen(p)] : [];
            });
            const count = points.length;
            if (sweep.pointer && count > 0)
                points.push(onScreen(sweep.pointer));
            // Numbers show throughout Set order (touch has no Alt)
            return [
                drawLine({
                    points,
                    marchers: count,
                    guessed: false,
                    numbered: true,
                    halfWidth: laneHalfWidth(dotRadius, reach, true),
                    dotRadius,
                    busy: busyOf(sweep.ids, sweep.at),
                    dots: everyone,
                }),
            ];
        }
        // A guessed order isn't drawn at rest; Alt shows it, hollow and dashed
        const shown = lines.filter((line) => !line.guessed || alt);
        const pointsOf = shown.map((line) =>
            line.order.flatMap((id) => {
                const p = linesAt.get(id);
                return p ? [onScreen(p)] : [];
            }),
        );
        // Lanes of neighboring lines narrow so they never touch
        const halfWidths = neighborHalfWidths(
            pointsOf,
            shown.map((line) =>
                laneHalfWidth(
                    dotRadius,
                    reach,
                    line.order.some((id) => selectedSet.has(id)),
                ),
            ),
            dotRadius,
        );
        const busy = busyOf(lineIds, linesAt);
        return shown.map((line, l) =>
            drawLine({
                points: pointsOf[l]!,
                marchers: pointsOf[l]!.length,
                guessed: line.guessed,
                numbered: alt,
                halfWidth: halfWidths[l]!,
                dotRadius,
                busy,
                dots: everyone,
            }),
        );
    }, [
        sweep,
        lines,
        lineIds,
        linesAt,
        zoom,
        dotRadius,
        reach,
        alt,
        everyone,
        labels,
        labelSize,
        selectedSet,
    ]);
    // The dots the lanes are cut away from: everyone's dot, and a selected marcher's ring too
    const holes = useMemo(() => {
        const selectedAt = [
            ...(sweep ? sweep.ids : ids).flatMap((id) => {
                const p = (sweep ? sweep.at : linesAt).get(id);
                return p
                    ? [{ at: { x: p.x * zoom, y: p.y * zoom }, r: reach }]
                    : [];
            }),
        ];
        return [
            ...everyone.map((at) => ({ at, r: dotRadius + 0.5 })),
            ...selectedAt,
        ];
    }, [sweep, ids, linesAt, everyone, zoom, dotRadius, reach]);
    const fieldBackground = theme.background;
    const ink = useMemo(
        () => laneInk(isDarkField(fieldBackground)),
        [fieldBackground],
    );

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
                <g
                    transform={`translate(${view.panX} ${view.panY})`}
                    fontFamily="Inter, system-ui, Arial, sans-serif"
                >
                    {drawn.map((line, i) => (
                        <OrderLine
                            key={i}
                            id={`${prefix}-${i}`}
                            line={line}
                            ink={ink}
                            holes={holes}
                        />
                    ))}
                    {drawn.flatMap((line, l) =>
                        line.numbers.map((badge, i) => (
                            <OrderBadge
                                key={`${l}-${i}`}
                                badge={badge}
                                guessed={line.guessed}
                            />
                        )),
                    )}
                    {drawn.map(
                        (line, i) =>
                            line.crowded && <ZoomNote key={i} box={line.box} />,
                    )}
                </g>
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

/** A path through `points` */
const pathOf = (points: readonly XY[]): string =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

/**
 * One line: the soft lane (a thread when its legs cross), with every dot under it cut out so the
 * dots and their selection rings keep their own color; a guessed order as a hollow dashed outline;
 * then the tip and the darts
 */
function OrderLine({
    id,
    line,
    ink,
    holes,
}: {
    id: string;
    line: DrawnLine;
    ink: LaneInk;
    /** The dots (and selection rings) the lane is cut away from: their middles and radii */
    holes: readonly { at: XY; r: number }[];
}) {
    const { kind, guessed, points, halfWidth, tip, darts, box } = line;
    if (points.length < 2) return null;
    const d = pathOf(points);
    const width = halfWidth * 2;
    const inBox = holes.filter(
        ({ at, r }) =>
            at.x + r >= box.minX &&
            at.x - r <= box.maxX &&
            at.y + r >= box.minY &&
            at.y - r <= box.maxY,
    );
    const mask = (
        <mask
            id={`${id}-holes`}
            maskUnits="userSpaceOnUse"
            x={box.minX - 4}
            y={box.minY - 4}
            width={box.maxX - box.minX + 8}
            height={box.maxY - box.minY + 8}
        >
            <rect
                x={box.minX - 4}
                y={box.minY - 4}
                width={box.maxX - box.minX + 8}
                height={box.maxY - box.minY + 8}
                fill="white"
            />
            {guessed && (
                <path
                    d={d}
                    fill="none"
                    stroke="black"
                    strokeWidth={Math.max(width - 2.4, 0)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            )}
            {inBox.map(({ at, r }, i) => (
                <circle key={i} cx={at.x} cy={at.y} r={r} fill="black" />
            ))}
        </mask>
    );
    return (
        <g
            data-testid={guessed ? "marcherOrderGuess" : "marcherOrderLine"}
            data-kind={kind}
        >
            <defs>{mask}</defs>
            {kind === "crossed" ? (
                <path
                    d={d}
                    fill="none"
                    stroke={ink.thread}
                    strokeWidth={1.25}
                    strokeLinejoin="round"
                    strokeDasharray={guessed ? "4 3" : undefined}
                    mask={`url(#${id}-holes)`}
                />
            ) : (
                <path
                    d={d}
                    fill="none"
                    stroke={guessed ? ink.guess : ink.lane}
                    strokeWidth={width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={guessed ? "4 3" : undefined}
                    mask={`url(#${id}-holes)`}
                />
            )}
            {tip && (
                <polygon
                    points={tip}
                    fill={guessed ? ink.guessTip : LANE_INK}
                    stroke={guessed ? ink.guess : ink.edge}
                    strokeWidth={guessed ? 1.2 : 1}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                    data-testid="marcherOrderTip"
                />
            )}
            {darts.map((points, i) => (
                <polygon
                    key={i}
                    points={points}
                    fill={kind === "crossed" ? ink.threadDart : ink.dart}
                    opacity={kind === "crossed" ? 0.7 : ink.dartOpacity}
                />
            ))}
        </g>
    );
}

/** A position badge: solid at the leader, rimmed at the tail, quiet between; dashed for a guess */
function OrderBadge({
    badge,
    guessed,
}: {
    badge: PlacedBadge;
    guessed: boolean;
}) {
    const { at, text, role } = badge;
    const w = badgeWidth(text);
    const solid = role === "leader" && !guessed;
    const strong = role !== "middle";
    return (
        <g data-testid="marcherOrderNumber" data-role={role}>
            <rect
                x={at.x - w / 2}
                y={at.y - BADGE_HEIGHT / 2}
                width={w}
                height={BADGE_HEIGHT}
                rx={BADGE_HEIGHT / 2}
                fill={solid ? LANE_INK : "#fff"}
                stroke={
                    solid ? "#fff" : strong ? LANE_INK : "rgba(28,31,38,0.35)"
                }
                strokeWidth={solid ? 1 : strong ? 1.4 : 1}
                strokeDasharray={guessed ? "2.5 2" : undefined}
            />
            <text
                x={at.x}
                y={at.y + 3.1}
                textAnchor="middle"
                fontSize={BADGE_FONT}
                fontWeight={strong ? 700 : 600}
                fill={solid ? "#fff" : strong ? LANE_INK : "#3a3f4a"}
            >
                {text}
            </text>
        </g>
    );
}

/** The note under a line whose numbers didn't all fit */
function ZoomNote({ box }: { box: Box }) {
    const text = tolgee.t("pathways.order.zoomIn", "Zoom in to read the order");
    const w = 12 + text.length * 5.6;
    const x = (box.minX + box.maxX) / 2 - w / 2;
    const y = box.maxY + 20;
    return (
        <g data-testid="marcherOrderZoomNote">
            <rect
                x={x}
                y={y}
                width={w}
                height={18}
                rx={6}
                fill="#fff"
                stroke="rgba(0,0,0,0.14)"
            />
            <text x={x + 6} y={y + 12.5} fontSize={11} fill="#202020">
                {text}
            </text>
        </g>
    );
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
