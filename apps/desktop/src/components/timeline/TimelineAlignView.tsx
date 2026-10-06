import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { WaveformIcon, XIcon } from "@phosphor-icons/react";
import tolgee from "@/global/singletons/Tolgee";
import { Input } from "@openmarch/ui";
import clsx from "clsx";
import { toast } from "sonner";
import { countTimes, type RetimeResult } from "@/timeline/tempo";
import { useTempoLabFlag } from "@/stores/UiSettingsStore";
import {
    alignDropTime,
    alignFlags,
    alignHold,
    alignMove,
    countName,
    countTempo,
    heldCounts,
    holdChip,
    moveChip,
    syncedWith,
    typedPageTempo,
    TYPED_TEMPO_CEILING_BPM,
    TYPED_TEMPO_FLOOR_BPM,
    alignTimeTicks,
    type AlignChip,
    type AlignFlag,
    type AlignPage,
    type AlignTranslate,
} from "./timelineAlign";
import type { TimelineXAxis } from "./timelineAxis";
import type { TimelineAlign } from "./TimelineViewModel";
import { timelineMenuContentGuards } from "./TimelineRangeMenu";

/** How far, in pixels, a press must move before it is a drag rather than a click */
export const ALIGN_DRAG_PX = 3;
/** An arrow nudge: 10 ms, or 1 ms with Shift (11-ui.md B Keyboard) */
const NUDGE_SECONDS = 0.01;
const NUDGE_FINE_SECONDS = 0.001;
/** Nudges that follow each other this closely are one edit, written once */
const NUDGE_SETTLE_MS = 700;
/** Remembers that the "synced" toast was shown, per user */
const SYNCED_TOAST_KEY = "openmarch.tempo.syncedToastShown";

type AlignWithOffset = TimelineAlign & { readonly offset: number };

/** The Align view's strings (`tempo.align.*` in en.json) */
export const alignT: AlignTranslate = (key, params) =>
    tolgee.t(key, params as Record<string, string | number>);

/** What a drag or nudge would write, drawn in memory until it's released */
export interface AlignPreview {
    readonly kind: "move" | "hold";
    /** The spec count being moved (a hold moves the tick after the held count) */
    readonly index: number;
    readonly durations: number[];
    /** Seconds count 1 moved against the music; the counts draw this much later */
    readonly origin: number;
    readonly effect: RetimeResult["effect"];
    readonly chip: AlignChip;
    /** Where the count was, in seconds on the music */
    readonly ghostTime: number;
    /** The synced counts the edit writes */
    readonly synced: number[];
    /** Where the chip floats, in client pixels */
    readonly anchor: {
        readonly x: number;
        readonly top: number;
        /** The viewport's edges, which the chip stays inside */
        readonly left: number;
        readonly right: number;
    } | null;
    /** Written, waiting for the timeline to show it */
    readonly committed?: boolean;
}

interface AlignGesture {
    readonly kind: "move" | "hold";
    readonly index: number;
    readonly head?: string;
    readonly originTime: number;
    readonly startClientX: number;
    readonly sync: boolean;
    moved: boolean;
}

const readToastShown = () => {
    try {
        return localStorage.getItem(SYNCED_TOAST_KEY) === "1";
    } catch {
        return false;
    }
};
const writeToastShown = () => {
    try {
        localStorage.setItem(SYNCED_TOAST_KEY, "1");
    } catch {
        // Private windows: the toast may show again, which is harmless
    }
};

/**
 * The Align view's edits (E7): dragging a flag, a rehearsal mark or a count tick, and arrow
 * nudges, previewed in memory and written once on release as one undo entry (`onRetime`).
 *
 * @param pixelsPerSecond the Align view's zoom
 * @param playheadTime the playhead, in seconds, which drags snap to
 */
export function useAlignEdit({
    align,
    pages,
    pixelsPerSecond,
    playheadTime,
    viewportRef,
    t,
}: {
    align: AlignWithOffset | undefined;
    pages: readonly AlignPage[];
    pixelsPerSecond: number;
    playheadTime: number;
    viewportRef: React.RefObject<HTMLDivElement | null>;
    t: AlignTranslate;
}) {
    const [preview, setPreview] = useState<AlignPreview | null>(null);
    const gesture = useRef<AlignGesture | null>(null);
    const frame = useRef(0);
    const nudge = useRef<{
        index: number;
        seconds: number;
        timer: ReturnType<typeof setTimeout> | null;
        element: HTMLElement;
    } | null>(null);
    const scope = useTempoLabFlag("alignDragScope");
    const flags = useMemo(() => alignFlags(pages).map((f) => f.index), [pages]);
    const latest = useRef({
        align,
        pages,
        pixelsPerSecond,
        playheadTime,
        t,
        scope,
        flags,
    });
    latest.current = {
        align,
        pages,
        pixelsPerSecond,
        playheadTime,
        t,
        scope,
        flags,
    };

    // A written edit stays drawn until the timeline gets the new counts, so nothing flickers back
    const durations = align?.durations;
    useEffect(() => {
        setPreview((current) => (current?.committed ? null : current));
    }, [durations]);
    useEffect(
        () => () => {
            cancelAnimationFrame(frame.current);
            if (nudge.current?.timer) clearTimeout(nudge.current.timer);
        },
        [],
    );

    /** The edit for count `index` (or the tick after a held count) landing at `toTime` */
    const compute = useCallback(
        (
            kind: "move" | "hold",
            index: number,
            toTime: number,
            sync: boolean,
            head: string | undefined,
            anchor: AlignPreview["anchor"],
        ): AlignPreview | null => {
            const {
                align: a,
                pages: p,
                t: tr,
                scope: sc,
                flags: fl,
            } = latest.current;
            if (!a) return null;
            const times = countTimes(a.durations);
            const ghostTime = times[index] ?? 0;
            if (kind === "hold") {
                const result = alignHold({
                    durations: a.durations,
                    index,
                    toTime,
                    synced: a.synced,
                    scope: sc,
                    flags: fl,
                });
                if (!result) return null;
                return {
                    kind,
                    index,
                    durations: result.durations,
                    origin: 0,
                    effect: result.effect,
                    chip: holdChip({
                        before: a.durations,
                        result,
                        index,
                        pages: p,
                        synced: a.synced,
                        t: tr,
                    }),
                    ghostTime,
                    synced: [...a.synced],
                    anchor,
                };
            }
            const result = alignMove({
                durations: a.durations,
                index,
                toTime,
                synced: a.synced,
                scope: sc,
                flags: fl,
            });
            return {
                kind,
                index,
                durations: result.durations,
                origin: result.originShift,
                effect: result.effect,
                chip: moveChip({
                    before: a.durations,
                    result,
                    index,
                    pages: p,
                    audioOffsetSeconds: a.audioOffsetSeconds,
                    head,
                    synced: a.synced,
                    t: tr,
                }),
                ghostTime,
                synced: syncedWith(a.synced, index, sync),
                anchor,
            };
        },
        [],
    );

    const commit = useCallback((next: AlignPreview | null) => {
        const a = latest.current.align;
        if (!a || !next) {
            setPreview(null);
            return;
        }
        const changed =
            next.origin !== 0 ||
            next.durations.some((d, i) => d !== a.durations[i]);
        // A release where it started writes nothing, not even the sync (11-ui.md B Snapping);
        // it says so, since at a low zoom a small correction can land back on the old place
        if (!changed) {
            setPreview(null);
            toast.info(latest.current.t("tempo.align.chip.noChange"));
            return;
        }
        setPreview({ ...next, committed: true, anchor: null });
        const done = () =>
            setPreview((current) => (current?.committed ? null : current));
        const written = a.onRetime({
            durations: next.durations,
            originShift: next.origin,
            synced: next.synced,
        });
        if (written && typeof written.then === "function")
            written.then(done, done);
        else done();
        const newlySynced =
            next.synced.length > a.synced.length && next.kind === "move";
        if (newlySynced && !readToastShown()) {
            writeToastShown();
            // Named as the transport and the chip name it: "Pg 11 ct 16" (FB-3)
            toast.info(
                latest.current.t("tempo.align.syncedToast", {
                    place: countName(latest.current.pages, next.index),
                }),
            );
        }
    }, []);

    const timeAt = (gestureState: AlignGesture, clientX: number) =>
        gestureState.originTime +
        (clientX - gestureState.startClientX) / latest.current.pixelsPerSecond;

    const anchorAt = useCallback(
        (clientX: number): AlignPreview["anchor"] => {
            const bounds = viewportRef.current?.getBoundingClientRect();
            return bounds
                ? {
                      x: Math.min(Math.max(clientX, bounds.left), bounds.right),
                      top: bounds.top,
                      left: bounds.left,
                      right: bounds.right,
                  }
                : null;
        },
        [viewportRef],
    );

    /** Pointer handlers that make an element drag count `index` */
    const dragProps = useCallback(
        (
            kind: "move" | "hold",
            index: number,
            head?: string,
        ): {
            onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
            onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
            onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
            onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
            onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
        } => ({
            onPointerDown: (event) => {
                if (event.button !== 0 || event.ctrlKey || event.metaKey)
                    return;
                const a = latest.current.align;
                if (!a) return;
                event.stopPropagation();
                event.currentTarget.setPointerCapture?.(event.pointerId);
                gesture.current = {
                    kind,
                    index,
                    head,
                    originTime: countTimes(a.durations)[index] ?? 0,
                    startClientX: event.clientX,
                    sync: !event.shiftKey,
                    moved: false,
                };
            },
            onPointerMove: (event) => {
                const g = gesture.current;
                if (!g || g.index !== index || g.kind !== kind) return;
                if (
                    !g.moved &&
                    Math.abs(event.clientX - g.startClientX) < ALIGN_DRAG_PX
                )
                    return;
                g.moved = true;
                const clientX = event.clientX;
                const altKey = event.altKey;
                cancelAnimationFrame(frame.current);
                frame.current = requestAnimationFrame(() => {
                    const current = gesture.current;
                    if (!current) return;
                    const { playheadTime: playhead, pixelsPerSecond } =
                        latest.current;
                    // Count 1 and the music: the playhead is on the old clock, as the pointer is
                    const snapped = alignDropTime({
                        time: timeAt(current, clientX),
                        playhead,
                        origin: current.originTime,
                        pixelsPerSecond,
                        disabled: altKey,
                    });
                    setPreview(
                        compute(
                            current.kind,
                            current.index,
                            snapped.time,
                            current.sync,
                            current.head,
                            anchorAt(clientX),
                        ),
                    );
                });
            },
            onPointerUp: (event) => {
                const g = gesture.current;
                if (!g) return;
                gesture.current = null;
                cancelAnimationFrame(frame.current);
                event.currentTarget.releasePointerCapture?.(event.pointerId);
                if (!g.moved) return;
                const { playheadTime: playhead, pixelsPerSecond } =
                    latest.current;
                const snapped = alignDropTime({
                    time: timeAt(g, event.clientX),
                    playhead,
                    origin: g.originTime,
                    pixelsPerSecond,
                    disabled: event.altKey,
                });
                commit(
                    compute(
                        g.kind,
                        g.index,
                        snapped.time,
                        g.sync,
                        g.head,
                        null,
                    ),
                );
            },
            onPointerCancel: () => {
                gesture.current = null;
                cancelAnimationFrame(frame.current);
                setPreview(null);
            },
            onKeyDown: (event) => {
                if (event.key === "Escape" && gesture.current) {
                    // Esc drops the drag; it never leaves Align
                    event.stopPropagation();
                    gesture.current = null;
                    cancelAnimationFrame(frame.current);
                    setPreview(null);
                    return;
                }
                if (
                    kind !== "move" ||
                    (event.key !== "ArrowLeft" && event.key !== "ArrowRight") ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.altKey
                )
                    return;
                event.preventDefault();
                event.stopPropagation();
                const a = latest.current.align;
                if (!a) return;
                const step =
                    (event.shiftKey ? NUDGE_FINE_SECONDS : NUDGE_SECONDS) *
                    (event.key === "ArrowLeft" ? -1 : 1);
                const current =
                    nudge.current?.index === index ? nudge.current : null;
                if (current?.timer) clearTimeout(current.timer);
                const seconds = (current?.seconds ?? 0) + step;
                const element = event.currentTarget;
                const originTime = countTimes(a.durations)[index] ?? 0;
                const bounds = element.getBoundingClientRect();
                const next = compute(
                    "move",
                    index,
                    originTime + seconds,
                    true,
                    head,
                    anchorAt(bounds.left + bounds.width / 2),
                );
                setPreview(next);
                nudge.current = {
                    index,
                    seconds,
                    element,
                    timer: setTimeout(() => {
                        nudge.current = null;
                        commit(next);
                    }, NUDGE_SETTLE_MS),
                };
            },
        }),
        // `timeAt` reads only the gesture and `latest`
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [anchorAt, commit, compute],
    );

    const cancel = useCallback(() => {
        gesture.current = null;
        cancelAnimationFrame(frame.current);
        setPreview(null);
    }, []);

    return { preview, dragProps, cancel, commit };
}

/**
 * The Align toggle in the transport (11-ui.md A): lit with the accent fill while on, with a ✕
 * that leaves it. Its label shows when the header has room.
 */
export function TimelineAlignToggle({
    on,
    onToggle,
    showLabel,
}: {
    on: boolean;
    onToggle: (on: boolean) => void;
    showLabel: boolean;
}) {
    const t = alignT;
    return (
        <div
            className={clsx(
                "rounded-4 flex h-24 shrink-0 items-center",
                on && "bg-accent text-text-invert",
            )}
        >
            <button
                type="button"
                data-testid="timeline-align-toggle"
                aria-pressed={on}
                aria-label={t("tempo.align.button")}
                title={
                    on ? t("tempo.align.onTooltip") : t("tempo.align.tooltip")
                }
                onClick={() => onToggle(!on)}
                className={clsx(
                    "focus-visible:ring-accent rounded-4 flex h-24 items-center gap-4 px-4 text-[11px] outline-hidden focus-visible:ring-2",
                    !on && "text-text enabled:hover:text-accent hover:bg-fg-2",
                )}
            >
                <WaveformIcon size={16} weight={on ? "bold" : "regular"} />
                {showLabel && <span>{t("tempo.align.button")}</span>}
            </button>
            {on && (
                <button
                    type="button"
                    data-testid="timeline-align-off"
                    aria-label={t("tempo.align.buttonOff")}
                    title={t("tempo.align.buttonOff")}
                    onClick={() => onToggle(false)}
                    className="rounded-4 flex size-20 items-center justify-center outline-hidden hover:bg-black/15 focus-visible:ring-2"
                >
                    <XIcon size={12} weight="bold" />
                </button>
            )}
        </div>
    );
}

/** The Align view's time line, under the page names in the ruler: "0:40", "0:41", … */
export function TimelineAlignTimeLine({
    extent,
    pixelsPerSecond,
}: {
    extent: number;
    pixelsPerSecond: number;
}) {
    const ticks = useMemo(
        () => alignTimeTicks(extent, pixelsPerSecond),
        [extent, pixelsPerSecond],
    );
    return (
        <div
            aria-hidden="true"
            data-testid="timeline-align-times"
            className="pointer-events-none absolute top-0 left-0 z-[5] h-28"
            style={{ width: extent * pixelsPerSecond }}
        >
            {ticks.map((tick) => (
                <span
                    key={tick.seconds}
                    className="text-text-subtitle absolute bottom-2 border-l border-current pl-2 font-mono text-[9px] leading-none opacity-80"
                    style={{ left: tick.seconds * pixelsPerSecond }}
                >
                    {tick.label}
                </span>
            ))}
        </div>
    );
}

/**
 * The handles on count 1 and each page's flag in the ruler (11-ui.md B): drag onto the music,
 * arrows nudge, right-click to sync or unsync. A synced flag's grip is solid, an unsynced one
 * hollow, so "this one stays put" is visible without color alone. They sit above the playhead's
 * head, so count 1 can be dragged while the playhead rests on it (the playhead still scrubs from
 * anywhere else).
 */
/** "A. B", without doubling the full stop when `first` already ends a sentence */
export const joinSentences = (first: string, second: string) =>
    /[.!?…]$/.test(first.trim())
        ? `${first.trim()} ${second}`
        : `${first}. ${second}`;

export function TimelineAlignFlags({
    flags,
    axis,
    offset,
    synced,
    preview,
    dragProps,
    onSetSynced,
    onFlagClick,
    formatTime,
}: {
    flags: readonly AlignFlag[];
    axis: TimelineXAxis;
    offset: number;
    synced: readonly number[];
    preview: AlignPreview | null;
    dragProps: ReturnType<typeof useAlignEdit>["dragProps"];
    onSetSynced: (synced: readonly number[]) => void;
    /** A click that didn't drag (punch-in tap retargets to the flag, E9) */
    onFlagClick?: (index: number) => void;
    formatTime: (seconds: number) => string;
}) {
    const t = alignT;
    const [menu, setMenu] = useState<{
        index: number;
        x: number;
        y: number;
    } | null>(null);
    const syncedSet = new Set(synced);
    const pressX = useRef(0);
    return (
        <>
            {flags.map((flag) => {
                const view = flag.index - offset;
                const x = axis.x(view);
                const isSynced = flag.index <= 1 || syncedSet.has(flag.index);
                const active = preview?.index === flag.index;
                const time = formatTime(axis.toUnit(view));
                const label = flag.page
                    ? t("tempo.align.flagHandle", {
                          page: flag.page.label,
                          time,
                      })
                    : t("tempo.align.countOneHandle", { time });
                return (
                    <button
                        key={flag.index}
                        type="button"
                        data-testid="timeline-align-flag"
                        data-timeline-interactive="true"
                        data-count={flag.index}
                        data-synced={isSynced || undefined}
                        aria-label={
                            isSynced
                                ? joinSentences(label, t("tempo.align.synced"))
                                : label
                        }
                        title={`${label}${isSynced ? `\n${t("tempo.align.synced")}` : ""}`}
                        {...dragProps("move", flag.index, undefined)}
                        onPointerDownCapture={(event) => {
                            pressX.current = event.clientX;
                        }}
                        onClick={
                            onFlagClick
                                ? (event) => {
                                      // Not the click that ends a drag
                                      if (
                                          Math.abs(
                                              event.clientX - pressX.current,
                                          ) < ALIGN_DRAG_PX
                                      )
                                          onFlagClick(flag.index);
                                  }
                                : undefined
                        }
                        onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (flag.index <= 1) return;
                            setMenu({
                                index: flag.index,
                                x: event.clientX,
                                y: event.clientY,
                            });
                        }}
                        className="group focus-visible:ring-accent absolute top-0 z-[55] flex h-28 w-12 -translate-x-1/2 cursor-col-resize touch-none justify-center outline-hidden focus-visible:ring-2"
                        style={{ left: x }}
                    >
                        <span
                            aria-hidden="true"
                            className={clsx(
                                "rounded-2 mt-0 block h-12 w-[9px] border-2",
                                isSynced
                                    ? "border-accent bg-accent"
                                    : "border-text-subtitle bg-bg-1 group-hover:border-accent",
                                active && "ring-accent ring-2",
                            )}
                        />
                        <span
                            aria-hidden="true"
                            className={clsx(
                                "absolute top-12 bottom-0 left-1/2 -translate-x-1/2",
                                isSynced || active
                                    ? "bg-accent w-[2px]"
                                    : "bg-text-subtitle group-hover:bg-accent w-px group-hover:w-[2px]",
                            )}
                        />
                    </button>
                );
            })}
            {menu && (
                <DropdownMenu.Root
                    open
                    modal={false}
                    onOpenChange={(next) => {
                        if (!next) setMenu(null);
                    }}
                >
                    <DropdownMenu.Trigger asChild>
                        <span
                            aria-hidden="true"
                            className="pointer-events-none fixed size-0"
                            style={{ left: menu.x, top: menu.y }}
                        />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                        <DropdownMenu.Content
                            {...timelineMenuContentGuards}
                            data-testid="timeline-align-flag-menu"
                            align="start"
                            className="bg-modal text-text rounded-6 border-stroke shadow-modal z-[200] flex min-w-[160px] flex-col gap-4 border p-4 backdrop-blur-md"
                        >
                            <DropdownMenu.Item
                                onSelect={() =>
                                    onSetSynced(
                                        syncedSet.has(menu.index)
                                            ? synced.filter(
                                                  (s) => s !== menu.index,
                                              )
                                            : syncedWith(
                                                  synced,
                                                  menu.index,
                                                  true,
                                              ),
                                    )
                                }
                                className="rounded-4 data-[highlighted]:bg-fg-2 cursor-default px-8 py-6 text-[12px] outline-hidden select-none"
                            >
                                {syncedSet.has(menu.index)
                                    ? t("tempo.align.unsync")
                                    : t("tempo.align.markSynced")}
                            </DropdownMenu.Item>
                        </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                </DropdownMenu.Root>
            )}
        </>
    );
}

/**
 * Count ticks in the measure row (11-ui.md B Holds): drag one to hold the count before it, as for
 * a fermata. Held counts are hatched. Ticks only take the pointer when a count is wide enough to
 * aim at.
 */
export function TimelineAlignTicks({
    axis,
    offset,
    durations,
    pages,
    flagCounts,
    top,
    height,
    dragProps,
}: {
    axis: TimelineXAxis;
    offset: number;
    durations: readonly number[];
    pages: readonly AlignPage[];
    flagCounts: ReadonlySet<number>;
    top: number;
    height: number;
    dragProps: ReturnType<typeof useAlignEdit>["dragProps"];
}) {
    const t = alignT;
    const held = useMemo(
        () => heldCounts(durations, pages),
        [durations, pages],
    );
    const ticks: number[] = [];
    for (let index = Math.max(2, offset + 1); index < durations.length; index++)
        if (
            !flagCounts.has(index) &&
            axis.pxPerBeatAt(index - offset - 1) >= 10
        )
            ticks.push(index);
    return (
        <>
            {[...held].map((index) => (
                <span
                    key={`held-${index}`}
                    aria-hidden="true"
                    data-testid="timeline-align-held"
                    className="pointer-events-none absolute z-[5] opacity-[0.18]"
                    style={{
                        left: axis.x(index - offset),
                        width: axis.span(index - offset, index - offset + 1),
                        top,
                        height,
                        backgroundImage:
                            "repeating-linear-gradient(135deg, var(--color-text) 0 1px, transparent 1px 5px)",
                    }}
                />
            ))}
            {ticks.map((index) => (
                <span
                    key={index}
                    data-testid="timeline-align-tick"
                    data-timeline-interactive="true"
                    title={t("tempo.align.tickHandle")}
                    {...dragProps("hold", index)}
                    className="hover:bg-accent/40 absolute z-10 w-[6px] -translate-x-1/2 cursor-col-resize touch-none"
                    style={{ left: axis.x(index - offset), top, height }}
                />
            ))}
        </>
    );
}

/**
 * While dragging: the old place as a dashed ghost, the counts that re-space tinted, the ones that
 * shift lightly tinted, and the synced count that holds the rest marked (12-ux.md 3).
 */
export function TimelineAlignPreviewLayer({
    preview,
    axis,
    offset,
    pixelsPerSecond,
    top,
    height,
}: {
    preview: AlignPreview;
    axis: TimelineXAxis;
    offset: number;
    pixelsPerSecond: number;
    top: number;
    height: number;
}) {
    const x = (index: number) => axis.x(index - offset);
    const { effect } = preview;
    return (
        <div
            aria-hidden="true"
            data-testid="timeline-align-preview"
            className="pointer-events-none absolute inset-0 z-[25]"
        >
            {effect.respaced.map((range) => (
                <span
                    key={`${range.from}-${range.to}`}
                    className="bg-accent/15 absolute"
                    style={{
                        left: x(range.from),
                        width: Math.max(0, x(range.to) - x(range.from)),
                        top,
                        height,
                    }}
                />
            ))}
            {effect.shifted && (
                <span
                    className="bg-text/5 border-text-subtitle absolute border-l border-dashed"
                    style={{
                        left: x(effect.shifted.from),
                        width: Math.max(0, axis.width - x(effect.shifted.from)),
                        top,
                        height,
                    }}
                />
            )}
            {effect.heldFrom !== null && (
                <span
                    className="bg-accent absolute w-[2px] opacity-60"
                    style={{ left: x(effect.heldFrom) - 1, top, height }}
                />
            )}
            <span
                data-testid="timeline-align-ghost"
                className="border-text absolute border-l border-dashed opacity-60"
                style={{
                    left: preview.ghostTime * pixelsPerSecond,
                    top: 0,
                    height: top + height,
                }}
            />
        </div>
    );
}

/** The "what will move" chip, floating over the ruler at the dragged count (11-ui.md B States) */
export function TimelineAlignChip({ preview }: { preview: AlignPreview }) {
    const ref = useRef<HTMLDivElement>(null);
    const { anchor } = preview;
    // Centered on the count, but never past the timeline's edges
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element || !anchor) return;
        const half = element.offsetWidth / 2;
        const x = Math.min(
            Math.max(anchor.x, anchor.left + half),
            Math.max(anchor.left + half, anchor.right - half),
        );
        element.style.left = `${x}px`;
    });
    if (!anchor || !preview.chip.text) return null;
    return createPortal(
        <div
            ref={ref}
            role="status"
            data-testid="timeline-align-chip"
            data-amber={preview.chip.amber || undefined}
            className={clsx(
                "bg-modal text-text shadow-modal rounded-6 pointer-events-none fixed z-[70] border px-8 py-3 font-mono text-[11px] whitespace-nowrap",
                preview.chip.amber ? "border-yellow" : "border-stroke",
            )}
            style={{
                left: anchor.x,
                top: anchor.top - 4,
                transform: "translate(-50%, -100%)",
            }}
        >
            {preview.chip.text}
        </div>,
        document.body,
    );
}

/** "Tempo… [120]" on a page in Align: type a BPM (40 or more) for every count of the page */
export function TimelineAlignTempoPrompt({
    page,
    x,
    y,
    align,
    onClose,
}: {
    page: AlignPage;
    x: number;
    y: number;
    align: TimelineAlign;
    onClose: () => void;
}) {
    const t = alignT;
    const current = countTempo(align.durations, page.start);
    const [value, setValue] = useState(current === null ? "" : String(current));
    const [error, setError] = useState<string | null>(null);
    const formRef = useRef<HTMLFormElement>(null);
    // A press outside closes it (not blur: the menu that opened it hands focus back as it closes)
    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            if (!formRef.current?.contains(event.target as Node)) onClose();
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () =>
            document.removeEventListener("pointerdown", onPointerDown, true);
    }, [onClose]);
    const submit = () => {
        const bpm = Number(value);
        const result = typedPageTempo({
            durations: align.durations,
            page,
            bpm,
            synced: align.synced,
        });
        if (!result) {
            setError(
                t("tempo.align.tempoRange", {
                    min: TYPED_TEMPO_FLOOR_BPM,
                    max: TYPED_TEMPO_CEILING_BPM,
                }),
            );
            return;
        }
        void align.onRetime({
            durations: result.durations,
            originShift: 0,
            synced: align.synced,
        });
        onClose();
    };
    return createPortal(
        <form
            ref={formRef}
            data-testid="timeline-align-tempo"
            className="bg-modal text-text border-stroke shadow-modal rounded-6 fixed z-[70] flex flex-col gap-4 border p-8 text-[12px]"
            style={{ left: x, top: y }}
            onSubmit={(event) => {
                event.preventDefault();
                submit();
            }}
        >
            <label className="flex items-center gap-8">
                {t("tempo.align.tempoPrompt", { page: page.label })}
                <Input
                    compact
                    autoFocus
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={value}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => {
                        setValue(event.target.value);
                        setError(null);
                    }}
                    onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Escape") onClose();
                    }}
                    className="w-[80px] font-mono"
                />
            </label>
            {error && <p className="text-red text-[11px]">{error}</p>}
        </form>,
        document.body,
    );
}
