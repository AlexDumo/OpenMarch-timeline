/**
 * Visuals mode's cue band under the timeline's clip rows
 * (performer-behavior.md sections 7.1 and 7.2): for the focused who on the
 * current tab, read-only rows of broader cues, the editable lane, rows of
 * exceptions, then the result row, colored by where each value comes from
 * and hatched where the who is mixed.
 *
 * On the lane, a click on empty space adds a state on that count, and a drag
 * adds a phrase of that length; dragging a cue moves it, dragging a phrase's
 * end sets its length, and Delete removes the picked cue. Everything lands on
 * a count: there is nothing between counts.
 */
import {
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { T, useTolgee } from "@tolgee/react";
import clsx from "clsx";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import type { CueTarget } from "@openmarch/core";
import {
    createCuesMutationOptions,
    deleteCuesMutationOptions,
    updateCuesMutationOptions,
} from "@/hooks/queries/useCues";
import { useVisualsStore } from "@/stores/VisualsStore";
import type {
    TimelineBand,
    TimelineBandGeometry,
} from "@/components/timeline/TimelineBand";
import type { VisualsBandData } from "./useVisualsBandData";
import { useTargetLabel } from "./useTargetLabel";
import {
    newCueValue,
    type LaneCue,
    type LaneRow,
    type ResultSpan,
} from "./visualsLanes";
import type { VisualsChannel } from "./visualsWho";

const HEADER = 22;
const GREY_ROW = 14;
const LANE = 28;
const RESULT = 18;
const GAP = 4;

/** The band's height for what it shows. */
export function visualsBandHeight(
    data: VisualsBandData | null,
    collapsed: boolean,
): number {
    if (!data || collapsed) return HEADER;
    const rows = data.lanes.broader.length + data.lanes.exceptions.length;
    return HEADER + rows * GREY_ROW + LANE + RESULT + GAP * 3;
}

const CHANNEL_KEYS: Record<VisualsChannel, string> = {
    feet: "visuals.channels.feet",
    horn_equipment: "visuals.channels.hornEquipment",
    facing: "visuals.channels.facing",
    body: "visuals.channels.body",
};

const SOURCE_CLASS: Record<NonNullable<ResultSpan["source"]>, string> = {
    own: "bg-accent/70 text-text-invert",
    broader: "bg-text/25 text-text",
    exception: "bg-yellow/60 text-text",
    default: "bg-fg-2 text-text-subtitle",
};

const HATCH = {
    backgroundImage:
        "repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-text) 25%, transparent) 0 4px, transparent 4px 8px)",
};

/**
 * A cue's block on a row. A state is its ramp into its count (a snap has
 * none), then its value holding until the next cue, with the label; a
 * phrase is its span.
 */
function CueBlock({
    cue,
    pixelsPerBeat,
    height,
    className,
    rampClassName,
    children,
    style,
    ...rest
}: {
    cue: LaneCue;
    pixelsPerBeat: number;
    height: number;
    className?: string;
    /** The ramp's tint, for states. */
    rampClassName?: string;
    children?: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
    const left = cue.from * pixelsPerBeat;
    const width = (cue.holdTo - cue.from) * pixelsPerBeat;
    const ramp = cue.kind === "state" ? (cue.to - cue.from) * pixelsPerBeat : 0;
    return (
        <div
            {...rest}
            className={clsx(
                "rounded-4 absolute top-0 flex items-center overflow-hidden text-[10px] leading-none whitespace-nowrap",
                className,
            )}
            style={{
                ...style,
                left,
                width: Math.max(width, 6),
                height,
                paddingLeft: ramp + 4,
            }}
            title={cue.label}
        >
            {ramp > 0 && (
                <div
                    aria-hidden
                    className={clsx(
                        "pointer-events-none absolute top-0 left-0 h-full",
                        rampClassName,
                    )}
                    style={{ width: ramp }}
                />
            )}
            {children}
        </div>
    );
}

function GreyRow({
    row,
    label,
    pixelsPerBeat,
    onGo,
}: {
    row: LaneRow;
    label: string;
    pixelsPerBeat: number;
    onGo: (target: CueTarget) => void;
}) {
    return (
        <div
            className="relative"
            style={{ height: GREY_ROW }}
            data-testid={`visuals-row-${row.key}`}
        >
            {row.cues.map((cue) => (
                <CueBlock
                    key={cue.id}
                    cue={cue}
                    pixelsPerBeat={pixelsPerBeat}
                    height={GREY_ROW - 3}
                    className="bg-text/15 text-text-subtitle hover:bg-text/25 cursor-pointer"
                    rampClassName="bg-gradient-to-r from-transparent to-text/25"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onGo(row.target)}
                >
                    {label}: {cue.label}
                </CueBlock>
            ))}
        </div>
    );
}

type Gesture =
    | { kind: "create"; start: number; end: number }
    | { kind: "move"; cue: LaneCue; startX: number; delta: number }
    | { kind: "length"; cue: LaneCue; startX: number; delta: number };

function EditableLane({
    data,
    pixelsPerBeat,
}: {
    data: VisualsBandData;
    pixelsPerBeat: number;
}) {
    const { t } = useTolgee();
    const queryClient = useQueryClient();
    const { mutate: createCues } = useMutation(
        createCuesMutationOptions(queryClient),
    );
    const { mutate: updateCues } = useMutation(
        updateCuesMutationOptions(queryClient),
    );
    const { mutate: deleteCues } = useMutation(
        deleteCuesMutationOptions(queryClient),
    );
    const selectedCueId = useVisualsStore((s) => s.selectedCueId);
    const setSelectedCueId = useVisualsStore((s) => s.setSelectedCueId);
    const laneRef = useRef<HTMLDivElement>(null);
    const [gesture, setGesture] = useState<Gesture | null>(null);
    const lastCount = data.counts.beatIdOfCount.length - 1;
    const clampCount = (c: number) => Math.max(0, Math.min(lastCount, c));
    const countAt = (clientX: number) => {
        const left = laneRef.current?.getBoundingClientRect().left ?? 0;
        return clampCount(Math.round((clientX - left) / pixelsPerBeat));
    };
    const { target, channel, carries } = data;

    const add = (from: number, to: number) => {
        if (!target) return;
        const start = Math.min(from, to);
        const length = Math.abs(to - from) + 1;
        const phrase =
            length >= 2 ? newCueValue(channel, "phrase", carries) : null;
        const value = phrase ?? newCueValue(channel, "state", carries);
        if (!value) return;
        createCues([
            {
                channel,
                kind: phrase ? "phrase" : "state",
                target,
                beatId: data.counts.beatIdOfCount[start]!,
                value,
                length: phrase ? length : null,
            },
        ]);
    };

    const onLanePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        // the lane's gestures, not the timeline's scrub or range
        e.stopPropagation();
        if (e.button !== 0 || !target) return;
        const start = countAt(e.clientX);
        e.currentTarget.setPointerCapture(e.pointerId);
        setSelectedCueId(null);
        setGesture({ kind: "create", start, end: start });
    };
    const startCueGesture =
        (cue: LaneCue, kind: "move" | "length") =>
        (e: ReactPointerEvent<HTMLDivElement>) => {
            e.stopPropagation();
            if (e.button !== 0) return;
            laneRef.current?.setPointerCapture(e.pointerId);
            setSelectedCueId(cue.id);
            laneRef.current?.focus();
            setGesture({ kind, cue, startX: e.clientX, delta: 0 });
        };
    const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!gesture) return;
        if (gesture.kind === "create")
            setGesture({ ...gesture, end: countAt(e.clientX) });
        else
            setGesture({
                ...gesture,
                delta: Math.round((e.clientX - gesture.startX) / pixelsPerBeat),
            });
    };
    const onPointerUp = () => {
        const g = gesture;
        setGesture(null);
        if (!g) return;
        if (g.kind === "create") add(g.start, g.end);
        else if (g.kind === "move" && g.delta !== 0) {
            const count = clampCount(g.cue.count + g.delta);
            if (count !== g.cue.count)
                updateCues([
                    {
                        id: g.cue.id,
                        beatId: data.counts.beatIdOfCount[count]!,
                    },
                ]);
        } else if (g.kind === "length" && g.delta !== 0) {
            const length = Math.max(2, g.cue.to - g.cue.from + g.delta);
            updateCues([{ id: g.cue.id, length }]);
        }
    };

    // what the lane draws while a gesture runs
    const shown = data.lanes.own.map((cue) => {
        if (gesture?.kind === "move" && gesture.cue.id === cue.id) {
            const count = clampCount(cue.count + gesture.delta);
            const shift = count - cue.count;
            return {
                ...cue,
                count,
                from: cue.from + shift,
                to: cue.to + shift,
                holdTo: cue.holdTo + shift,
            };
        }
        if (gesture?.kind === "length" && gesture.cue.id === cue.id) {
            const to = Math.max(cue.from + 2, cue.to + gesture.delta);
            return { ...cue, to, holdTo: to };
        }
        return cue;
    });

    return (
        <div
            ref={laneRef}
            role="group"
            aria-label={t("visuals.band.lane")}
            tabIndex={0}
            data-testid="visuals-lane"
            className={clsx(
                "rounded-4 bg-fg-2/60 relative outline-none",
                target ? "cursor-crosshair" : "cursor-not-allowed",
            )}
            style={{ height: LANE }}
            onPointerDown={onLanePointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setGesture(null)}
            onKeyDown={(e) => {
                if (
                    (e.key === "Delete" || e.key === "Backspace") &&
                    selectedCueId !== null
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteCues(new Set([selectedCueId]));
                    setSelectedCueId(null);
                }
            }}
        >
            {shown.map((cue) =>
                cue.kind === "phrase" ? (
                    // a phrase's span is the phrase: grab it anywhere
                    <CueBlock
                        key={cue.id}
                        cue={cue}
                        pixelsPerBeat={pixelsPerBeat}
                        height={LANE}
                        data-testid={`visuals-cue-${cue.id}`}
                        data-count={cue.count}
                        aria-selected={selectedCueId === cue.id}
                        className={clsx(
                            "bg-accent/40 border-accent cursor-grab border pr-6 text-[11px]",
                            selectedCueId === cue.id && "ring-text ring-1",
                        )}
                        onPointerDown={startCueGesture(cue, "move")}
                    >
                        <span className="pointer-events-none truncate">
                            {cue.label}
                        </span>
                        <div
                            data-testid={`visuals-cue-${cue.id}-end`}
                            className="absolute top-0 right-0 h-full w-6 cursor-ew-resize"
                            onPointerDown={startCueGesture(cue, "length")}
                        />
                    </CueBlock>
                ) : (
                    // a state: its hold is paint, so a click there adds a cue;
                    // its ramp and its own count are the grip
                    <div key={cue.id}>
                        <CueBlock
                            cue={cue}
                            pixelsPerBeat={pixelsPerBeat}
                            height={LANE}
                            className={clsx(
                                "bg-accent/15 border-accent/40 pointer-events-none border pr-6 text-[11px]",
                                selectedCueId === cue.id && "ring-text ring-1",
                            )}
                            rampClassName="bg-gradient-to-r from-transparent to-accent/50"
                        >
                            <span className="truncate">{cue.label}</span>
                        </CueBlock>
                        <div
                            data-testid={`visuals-cue-${cue.id}`}
                            data-count={cue.count}
                            aria-selected={selectedCueId === cue.id}
                            title={cue.label}
                            className="absolute top-0 cursor-grab"
                            style={{
                                left: cue.from * pixelsPerBeat,
                                width: Math.max(
                                    10,
                                    (cue.to + 1 - cue.from) * pixelsPerBeat,
                                ),
                                height: LANE,
                            }}
                            onPointerDown={startCueGesture(cue, "move")}
                        />
                    </div>
                ),
            )}
            {gesture?.kind === "create" && (
                <div
                    className="bg-accent/30 rounded-4 pointer-events-none absolute top-0"
                    style={{
                        left:
                            Math.min(gesture.start, gesture.end) *
                            pixelsPerBeat,
                        width:
                            (Math.abs(gesture.end - gesture.start) + 1) *
                            pixelsPerBeat,
                        height: LANE,
                    }}
                />
            )}
        </div>
    );
}

function ResultRow({
    spans,
    pixelsPerBeat,
}: {
    spans: ResultSpan[];
    pixelsPerBeat: number;
}) {
    const { t } = useTolgee();
    return (
        <div
            className="relative"
            style={{ height: RESULT }}
            data-testid="visuals-result"
        >
            {spans.map((s) => (
                <div
                    key={s.from}
                    data-testid="visuals-result-span"
                    data-source={s.mixed ? "mixed" : s.source}
                    className={clsx(
                        "absolute top-0 flex items-center overflow-hidden border-r border-r-black/10 px-4 text-[10px] leading-none whitespace-nowrap",
                        s.mixed ? "text-text" : SOURCE_CLASS[s.source!],
                    )}
                    style={{
                        left: s.from * pixelsPerBeat,
                        width: (s.to - s.from) * pixelsPerBeat,
                        height: RESULT - 2,
                        ...(s.mixed ? HATCH : {}),
                    }}
                    title={s.mixed ? t("visuals.band.mixed") : (s.label ?? "")}
                >
                    {s.mixed ? t("visuals.band.mixed") : s.label}
                </div>
            ))}
        </div>
    );
}

function BandBody({
    data,
    geometry,
}: {
    data: VisualsBandData | null;
    geometry: TimelineBandGeometry;
}) {
    const { t } = useTolgee();
    const collapsed = useVisualsStore((s) => s.bandCollapsed);
    const toggle = useVisualsStore((s) => s.toggleBandCollapsed);
    const toggleFocus = useVisualsStore((s) => s.toggleFocus);
    const label = useTargetLabel();
    const { pixelsPerBeat, top, width } = geometry;

    // a grey row's cue goes to its who; a hand-picked set isn't one yet
    const goTo = (target: CueTarget) => {
        if (target.kind === "band") toggleFocus({ kind: "band" });
        else if (target.kind === "section")
            toggleFocus({ kind: "section", section: target.section });
        else if (target.kind === "tag")
            toggleFocus({ kind: "tag", tagId: target.tagId });
    };

    const title = data
        ? t("visuals.band.editing", {
              channel: t(CHANNEL_KEYS[data.channel]),
              who: label(data.target),
          })
        : t("visuals.band.focusFirst");

    return (
        <div
            data-testid="visuals-band"
            className="border-stroke absolute left-0 border-t"
            style={{ top, width, height: visualsBandHeight(data, collapsed) }}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <div
                className="sticky left-0 flex w-fit items-center gap-4"
                style={{ height: HEADER }}
            >
                <button
                    type="button"
                    className="text-text-subtitle hover:text-text flex items-center gap-4 px-4 text-[11px]"
                    onClick={toggle}
                    aria-expanded={!collapsed}
                    data-testid="visuals-band-toggle"
                >
                    {collapsed ? (
                        <CaretRightIcon size={10} />
                    ) : (
                        <CaretDownIcon size={10} />
                    )}
                    <span data-testid="visuals-band-title">{title}</span>
                </button>
                {data && !data.target && (
                    <span className="text-yellow text-[11px]">
                        <T keyName="visuals.band.selectFirst" />
                    </span>
                )}
            </div>
            {data && !collapsed && (
                <div className="flex flex-col" style={{ gap: GAP }}>
                    {data.lanes.broader.map((row) => (
                        <GreyRow
                            key={row.key}
                            row={row}
                            label={label(row.target)}
                            pixelsPerBeat={pixelsPerBeat}
                            onGo={goTo}
                        />
                    ))}
                    <EditableLane data={data} pixelsPerBeat={pixelsPerBeat} />
                    {data.lanes.exceptions.map((row) => (
                        <GreyRow
                            key={row.key}
                            row={row}
                            label={label(row.target)}
                            pixelsPerBeat={pixelsPerBeat}
                            onGo={goTo}
                        />
                    ))}
                    <ResultRow
                        spans={data.result}
                        pixelsPerBeat={pixelsPerBeat}
                    />
                </div>
            )}
        </div>
    );
}

/** Visuals mode's band for the timeline: its height and what it draws. */
export function visualsTimelineBand(
    data: VisualsBandData | null,
    collapsed: boolean,
): TimelineBand {
    return {
        height: visualsBandHeight(data, collapsed),
        render: (geometry: TimelineBandGeometry) => (
            <BandBody data={data} geometry={geometry} />
        ),
    };
}
