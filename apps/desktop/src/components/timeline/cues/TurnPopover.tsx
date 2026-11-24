/**
 * The turn popover (fork #993): a Facing cue's turn, opened by double-clicking its bar in the
 * Facing lane or by Edit turn…. A dial sets where the performers end up (drag past a full circle
 * to add a spin), From shows where they start (read-only), To and Counts take numbers, and the
 * chips pick a direction, which each performer reaches the nearest way. Every change is one undo
 * step, through the cue commands (they act on the picked cue, which opening this picks).
 */
import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useTranslate } from "@tolgee/react";
import clsx from "clsx";
import { POPOVER_CLASS } from "@/components/ui/popupClasses";
import { useCueCommands } from "@/cues/useCueCommands";
import type { EditorCues } from "@/cues/useShowCues";
import {
    DIRECTION_DEGREES,
    directionOf,
    formatDegrees,
    type FacingDirection,
} from "@/cues/facing";
import { facingTargetDegrees } from "@openmarch/core";

/** The dial's radius, in its own units (the SVG is 120 across) */
const R = 44;

/** The point at angle `degrees` on the dial: 0 (front) at the bottom, 90 (side 2) to the right */
const pointAt = (degrees: number, r = R) => {
    const a = (degrees * Math.PI) / 180;
    return { x: Math.sin(a) * r, y: Math.cos(a) * r };
};

/** The angle the pointer is at on the dial, in (−180, 180] */
const angleOf = (x: number, y: number) => (Math.atan2(x, y) * 180) / Math.PI;

/**
 * The dial's next angle as the pointer moves: the previous one plus the short way round to where
 * the pointer is, so going round past a full circle adds a spin.
 */
export function dialAngle(previous: number, pointer: number): number {
    let d = (pointer - previous) % 360;
    if (d > 180) d -= 360;
    else if (d <= -180) d += 360;
    return previous + d;
}

/** The arc drawn from `from` to `to` (degrees), as an SVG path; a whole turn and more is a ring */
function arcPath(from: number, to: number): string {
    const sweep = to - from;
    if (Math.abs(sweep) < 1e-6) return "";
    if (Math.abs(sweep) >= 360) {
        const a = pointAt(from);
        const b = pointAt(from + 180);
        return `M${a.x} ${a.y} A${R} ${R} 0 1 1 ${b.x} ${b.y} A${R} ${R} 0 1 1 ${a.x} ${a.y}`;
    }
    const a = pointAt(from);
    const b = pointAt(to);
    // Positive degrees run counterclockwise on screen (front at the bottom, side 2 to the right)
    return `M${a.x} ${a.y} A${R} ${R} 0 ${Math.abs(sweep) > 180 ? 1 : 0} ${sweep > 0 ? 0 : 1} ${b.x} ${b.y}`;
}

export function TurnPopover({
    cueId,
    show,
    names,
    dialNames,
    rowName,
    fromDegrees,
    anchor,
    onClose,
}: {
    cueId: number;
    show: EditorCues;
    names: Readonly<Record<FacingDirection, string>>;
    /** The dial's short names: the field's terse side names ("S1", "SR") */
    dialNames: Readonly<Record<FacingDirection, string>>;
    /** Who the row it opened on is, for the title */
    rowName: string;
    /** Where that row faces when the turn starts */
    fromDegrees: number;
    /** Where it opens, in the lane's own pixels: under the turn's start */
    anchor: { x: number; y: number };
    onClose: () => void;
}) {
    const { t } = useTranslate();
    const commands = useCueCommands();
    const cue = show.cues.find((c) => c.id === cueId);
    const start = cue ? (show.countOfBeat.get(cue.beatId) ?? 0) : 0;
    const counts = cue?.transition ?? 0;
    const to = cue
        ? facingTargetDegrees(cue.value, cue.settings, fromDegrees)
        : fromDegrees;
    // What the dial and fields show while they're being changed, before the write lands
    const [draft, setDraft] = useState<number | null>(null);
    const [toText, setToText] = useState(String(to));
    const [countsText, setCountsText] = useState(String(counts));
    useEffect(() => setToText(String(Math.round(to * 10) / 10)), [to]);
    useEffect(() => setCountsText(String(counts)), [counts]);
    // The commands act on the picked cue: once it isn't this one, the popover goes
    const picked = commands.cue?.id === cueId;
    useEffect(() => {
        if (commands.cue !== null && !picked) onClose();
    }, [commands.cue, picked, onClose]);
    const shown = draft ?? to;
    const svg = useRef<SVGSVGElement>(null);
    const drag = useRef<number | null>(null);

    const setAngle = (degrees: number) => {
        if (!Number.isFinite(degrees)) return;
        commands.editTurn({ choice: { kind: "angle", degrees } });
    };
    const setCounts = (value: number) => {
        if (!Number.isFinite(value) || value < 0) return;
        const whole = Math.round(value);
        commands.editTurn({ transition: whole === 0 ? null : whole });
    };
    const pointerAngle = (e: React.PointerEvent) => {
        const box = svg.current!.getBoundingClientRect();
        return angleOf(
            e.clientX - (box.left + box.width / 2),
            e.clientY - (box.top + box.height / 2),
        );
    };
    const dot = pointAt(shown);
    const fromPoint = pointAt(fromDegrees, R - 6);
    const toDirection = directionOf(shown);
    if (!cue) return null;
    return (
        <Popover.Root
            open
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <Popover.Anchor asChild>
                <div
                    aria-hidden
                    className="pointer-events-none absolute h-0 w-0"
                    style={{ left: anchor.x, top: anchor.y }}
                />
            </Popover.Anchor>
            <Popover.Portal>
                <Popover.Content
                    data-testid="turn-popover"
                    side="top"
                    align="start"
                    sideOffset={6}
                    collisionPadding={8}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    className={clsx(
                        POPOVER_CLASS,
                        "z-50 flex w-240 flex-col gap-8",
                    )}
                >
                    <div className="text-body font-medium">
                        {t("cues.turn.title", {
                            name: rowName,
                            count: start + 1,
                        })}
                    </div>
                    <svg
                        ref={svg}
                        data-testid="turn-dial"
                        role="slider"
                        aria-label={t("cues.turn.dial")}
                        aria-valuenow={Math.round(shown)}
                        aria-valuetext={formatDegrees(shown)}
                        tabIndex={0}
                        viewBox="-60 -60 120 120"
                        className="mx-auto size-128 cursor-grab touch-none"
                        onPointerDown={(e) => {
                            e.currentTarget.setPointerCapture(e.pointerId);
                            drag.current = dialAngle(shown, pointerAngle(e));
                            setDraft(drag.current);
                        }}
                        onPointerMove={(e) => {
                            if (drag.current === null) return;
                            drag.current = dialAngle(
                                drag.current,
                                pointerAngle(e),
                            );
                            setDraft(drag.current);
                        }}
                        onPointerUp={() => {
                            const end = drag.current;
                            drag.current = null;
                            if (end === null) return;
                            // Whole degrees, as typed ones are
                            setAngle(Math.round(end));
                            setDraft(null);
                        }}
                        onPointerCancel={() => {
                            drag.current = null;
                            setDraft(null);
                        }}
                        onKeyDown={(e) => {
                            const step = e.shiftKey ? 45 : 5;
                            if (
                                e.key === "ArrowLeft" ||
                                e.key === "ArrowDown"
                            ) {
                                e.preventDefault();
                                e.stopPropagation();
                                setAngle(to - step);
                            } else if (
                                e.key === "ArrowRight" ||
                                e.key === "ArrowUp"
                            ) {
                                e.preventDefault();
                                e.stopPropagation();
                                setAngle(to + step);
                            }
                        }}
                    >
                        <circle
                            r={R}
                            fill="none"
                            className="stroke-stroke"
                            strokeWidth={2}
                        />
                        {(
                            [
                                ["front", 0, 56],
                                ["back", 0, -50],
                                ["side1", -54, 3],
                                ["side2", 54, 3],
                            ] as const
                        ).map(([key, x, y]) => (
                            <text
                                key={key}
                                x={x}
                                y={y}
                                textAnchor="middle"
                                // eslint-disable-next-line no-restricted-syntax -- a label drawn inside the 120-unit dial, scaled with it
                                className="fill-text-subtitle text-[8px]"
                            >
                                {dialNames[key]}
                            </text>
                        ))}
                        <path
                            d={arcPath(fromDegrees, shown)}
                            fill="none"
                            className="stroke-accent"
                            strokeWidth={5}
                            strokeLinecap="round"
                        />
                        <line
                            x1={0}
                            y1={0}
                            x2={fromPoint.x}
                            y2={fromPoint.y}
                            className="stroke-text-subtitle"
                            strokeWidth={2}
                        />
                        <line
                            x1={0}
                            y1={0}
                            x2={dot.x * 0.9}
                            y2={dot.y * 0.9}
                            className="stroke-accent"
                            strokeWidth={3}
                        />
                        <circle
                            cx={dot.x}
                            cy={dot.y}
                            r={6}
                            className="fill-accent"
                        />
                    </svg>
                    <p className="text-sub text-text-subtitle text-center">
                        {t("cues.turn.dialHint")}
                    </p>
                    <label className="text-body flex items-center justify-between gap-8">
                        {t("cues.turn.from", { count: start + 1 })}
                        <output
                            data-testid="turn-from"
                            className="rounded-6 border-stroke bg-fg-2 text-text-subtitle h-26 w-80 border px-8 text-right leading-[24px]"
                        >
                            {formatDegrees(fromDegrees)}
                        </output>
                    </label>
                    <label className="text-body flex items-center justify-between gap-8">
                        {t("cues.turn.to", { count: start + counts + 1 })}
                        <input
                            data-testid="turn-to"
                            inputMode="decimal"
                            value={toText}
                            onChange={(e) => setToText(e.target.value)}
                            onBlur={() =>
                                setAngle(Number(toText.replace("−", "-")))
                            }
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter")
                                    setAngle(Number(toText.replace("−", "-")));
                            }}
                            className="rounded-6 border-stroke bg-fg-2 text-body h-26 w-80 border px-8 text-right"
                        />
                    </label>
                    <label className="text-body flex items-center justify-between gap-8">
                        {t("cues.turn.counts")}
                        <input
                            data-testid="turn-counts"
                            inputMode="numeric"
                            value={countsText}
                            placeholder={t("cues.turn.instant")}
                            onChange={(e) => setCountsText(e.target.value)}
                            onBlur={() => setCounts(Number(countsText || 0))}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter")
                                    setCounts(Number(countsText || 0));
                            }}
                            className="rounded-6 border-stroke bg-fg-2 text-body h-26 w-80 border px-8 text-right"
                        />
                    </label>
                    <div className="flex flex-wrap gap-4">
                        {(
                            Object.keys(DIRECTION_DEGREES) as FacingDirection[]
                        ).map((key) => (
                            <button
                                key={key}
                                type="button"
                                data-testid={`turn-chip-${key}`}
                                aria-pressed={toDirection === key}
                                onClick={() =>
                                    commands.editTurn({ choice: { kind: key } })
                                }
                                className={clsx(
                                    "text-sub touch:min-h-44 h-24 rounded-full border px-8 transition-colors duration-150",
                                    toDirection === key
                                        ? "border-accent bg-accent text-text-invert"
                                        : "border-stroke bg-fg-2 hover:border-accent",
                                )}
                            >
                                {names[key]}
                            </button>
                        ))}
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
