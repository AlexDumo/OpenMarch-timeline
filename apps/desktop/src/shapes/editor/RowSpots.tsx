import { useEffect, useRef, useSyncExternalStore } from "react";
import clsx from "clsx";
import tolgee from "@/global/singletons/Tolgee";
import { prefersReducedMotion } from "@/components/timeline/reducedMotion";
import {
    dotSize,
    followPointer,
    LENS_FLAT,
    needsLens,
    sameColumn,
    spotAt,
    spotUnder,
    warp,
    type LensRow,
} from "./rowLens";

/** The spot pointed at, or reached by key: row `row` of the strips, spot `spot` in it */
export interface LensSpot {
    readonly row: number;
    readonly spot: number;
}

/**
 * The Rows menu's strips, shared by all of them (`rowLens.ts`): which row and spot are pointed at,
 * and the lens's place and how far it's open. Each strip and the readouts subscribe; the menu
 * itself doesn't re-render as the lens moves.
 */
export interface RowLens {
    subscribe(listener: () => void): () => void;
    version(): number;
    /** The rows as this render lists them, top to bottom */
    setRows(rows: readonly LensRow[]): void;
    setWidth(width: number): void;
    /** A strip's element, for moving between rows by key */
    setStrip(at: number, el: HTMLElement | null): void;
    point(at: number, px: number): void;
    leave(): void;
    touchStart(at: number, px: number, clientX: number): void;
    touchMove(px: number, clientX: number): void;
    /** A touch lifted: true when it was a tap on the magnified row, which presses its spot */
    touchEnd(): boolean;
    focusRow(at: number): void;
    blur(): void;
    /** A key on strip `at`: "press" for Space or Enter, true when the lens used it */
    key(at: number, key: string, shift: boolean): "press" | boolean;
    hovered(): LensSpot | null;
    view(): {
        readonly rows: readonly LensRow[];
        readonly X: (u: number) => number;
        readonly width: number;
        readonly open: number;
        readonly focus: number;
        readonly lens: boolean;
        readonly input: "pointer" | "touch" | "key" | null;
    };
}

export function createRowLens(): RowLens {
    let rows: readonly LensRow[] = [];
    let width = 0;
    let input: "pointer" | "touch" | "key" | null = null;
    let row: number | null = null;
    let px = 0;
    let keySpot = 0;
    let pinned = false;
    let press: { x: number; wasPinned: boolean; moved: boolean } | null = null;
    let open = 0;
    let target = 0;
    let focus = 0;
    let version = 0;
    let frame = 0;
    let leaving: ReturnType<typeof setTimeout> | null = null;
    const strips = new Map<number, HTMLElement>();
    const listeners = new Set<() => void>();
    const lens = () => needsLens(rows, width);

    const notify = () => {
        version++;
        for (const l of listeners) l();
    };
    const step = () => {
        frame = 0;
        const goal = lens() ? target : 0;
        open =
            prefersReducedMotion() || Math.abs(goal - open) < 0.002
                ? goal
                : open + (goal - open) * 0.25;
        if (lens() && row !== null && rows[row]) {
            if (input === "key") focus = spotAt(rows[row]!, keySpot);
            else if (input !== null)
                focus = followPointer(rows, width, focus, open, px);
        }
        notify();
        if (open !== goal) kick();
    };
    function kick() {
        if (frame) return;
        frame =
            typeof requestAnimationFrame === "function"
                ? requestAnimationFrame(step)
                : (setTimeout(step, 16) as unknown as number);
    }
    const stopLeaving = () => {
        if (leaving) clearTimeout(leaving);
        leaving = null;
    };
    const reset = () => {
        input = null;
        row = null;
        pinned = false;
        target = 0;
        kick();
    };
    // A tap outside the strips lets go of a lens a touch left open
    const outside = (e: PointerEvent) => {
        if ((e.target as Element | null)?.closest?.("[data-row-lens]")) return;
        document.removeEventListener("pointerdown", outside, true);
        if (pinned) reset();
    };

    return {
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        version: () => version,
        setRows(next) {
            rows = next;
            if (row !== null && row >= rows.length) row = null;
            const at = row === null ? null : rows[row];
            if (at) keySpot = Math.min(keySpot, at.length - 1);
        },
        setWidth(next) {
            if (next === width) return;
            width = next;
            kick();
        },
        setStrip(at, el) {
            if (el) strips.set(at, el);
            else strips.delete(at);
        },
        point(at, x) {
            stopLeaving();
            input = "pointer";
            row = at;
            px = x;
            target = 1;
            kick();
        },
        leave() {
            if (input !== "pointer") return;
            stopLeaving();
            // Moving from one row's strip to the next isn't leaving
            leaving = setTimeout(reset, 80);
        },
        touchStart(at, x, clientX) {
            press = {
                x: clientX,
                wasPinned: pinned && row === at,
                moved: false,
            };
            input = "touch";
            pinned = true;
            row = at;
            px = x;
            target = 1;
            document.addEventListener("pointerdown", outside, true);
            kick();
        },
        touchMove(x, clientX) {
            if (!press) return;
            if (Math.abs(clientX - press.x) > 6) press.moved = true;
            px = x;
            kick();
        },
        touchEnd() {
            // Where every spot is full size already, a tap presses it straight away
            const tap = !!press && !press.moved && (press.wasPinned || !lens());
            press = null;
            kick();
            return tap;
        },
        focusRow(at) {
            if (input === "pointer" || input === "touch") return;
            const r = rows[at];
            if (!r) return;
            if (input !== "key" || row === null)
                keySpot = Math.floor(r.length / 2);
            input = "key";
            row = at;
            keySpot = Math.min(keySpot, r.length - 1);
            target = 1;
            kick();
        },
        blur() {
            if (input !== "key") return;
            // Focus moving to another row's strip keeps the lens
            setTimeout(() => {
                if (
                    !(document.activeElement as Element | null)?.closest?.(
                        "[data-row-lens]",
                    )
                )
                    reset();
            }, 0);
        },
        key(at, key, shift) {
            const r = rows[at];
            if (!r) return false;
            if (input !== "key" || row !== at) {
                input = "key";
                row = at;
                keySpot = Math.min(keySpot, r.length - 1);
                target = 1;
            }
            const by = shift ? 5 : 1;
            if (key === "ArrowLeft") keySpot = Math.max(0, keySpot - by);
            else if (key === "ArrowRight")
                keySpot = Math.min(r.length - 1, keySpot + by);
            else if (key === "Home") keySpot = 0;
            else if (key === "End") keySpot = r.length - 1;
            else if (key === "ArrowUp" || key === "ArrowDown") {
                const next = at + (key === "ArrowUp" ? -1 : 1);
                const to = rows[next];
                if (!to) return false;
                keySpot = sameColumn(r, keySpot, to);
                row = next;
                strips.get(next)?.focus();
            } else if (key === " " || key === "Enter") return "press";
            else return false;
            kick();
            return true;
        },
        hovered() {
            if (row === null || input === null) return null;
            const r = rows[row];
            if (!r) return null;
            if (input === "key") return { row, spot: keySpot };
            return {
                row,
                spot: spotUnder(rows, r, width, focus, open, px),
            };
        },
        view: () => ({
            rows,
            X: warp(rows, width, focus, open),
            width,
            open,
            focus,
            lens: lens(),
            input,
        }),
    };
}

function useLens(lens: RowLens) {
    useSyncExternalStore(lens.subscribe, lens.version);
}

/**
 * One row's spots in the Rows menu: dots, hollow where a spot is empty, all of them in the
 * strip's width; a press leaves the spot under the pointer empty, or fills it again.
 */
export function RowSpots({
    lens,
    at,
    spots,
    accent,
    label,
    onPress,
    testId,
}: {
    lens: RowLens;
    /** Which strip this is, top to bottom */
    at: number;
    spots: readonly boolean[];
    accent: boolean;
    label: string;
    onPress: (spot: number) => void;
    testId: string;
}) {
    useLens(lens);
    const box = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const el = box.current;
        if (!el) return;
        lens.setStrip(at, el);
        const size = () => lens.setWidth(el.clientWidth);
        size();
        const watch =
            typeof ResizeObserver === "function"
                ? new ResizeObserver(size)
                : null;
        watch?.observe(el);
        return () => {
            watch?.disconnect();
            lens.setStrip(at, null);
        };
    }, [lens, at]);
    const v = lens.view();
    const row = v.rows[at];
    const hot = lens.hovered();
    const x = (e: { clientX: number }) =>
        e.clientX - (box.current?.getBoundingClientRect().left ?? 0);
    const dots: React.ReactNode[] = [];
    const holes: React.ReactNode[] = [];
    if (row && v.width > 0)
        spots.forEach((filled, j) => {
            const u = spotAt(row, j);
            const cx = v.X(u);
            const d = dotSize(v.X, u);
            if (filled) dots.push(<circle key={j} cx={cx} cy={12} r={d / 2} />);
            else
                holes.push(
                    <circle
                        key={j}
                        cx={cx}
                        cy={12}
                        r={Math.max(d, 4.5) / 2}
                        className="fill-bg-1 stroke-current"
                        strokeWidth={1.3}
                    />,
                );
            if (hot?.row === at && hot.spot === j)
                holes.push(
                    <circle
                        key={`ring-${j}`}
                        cx={cx}
                        cy={12}
                        r={Math.max(d, 4.5) / 2 + 3}
                        className="fill-none stroke-current"
                        strokeWidth={1.5}
                        data-testid={`${testId}-pointed`}
                    />,
                );
        });
    const band =
        v.lens && v.open > 0.02
            ? {
                  from: v.X(v.focus - LENS_FLAT - 0.5),
                  to: v.X(v.focus + LENS_FLAT + 0.5),
              }
            : null;
    return (
        <div
            ref={box}
            role="group"
            tabIndex={0}
            aria-label={label}
            data-row-lens=""
            data-testid={testId}
            className={clsx(
                "rounded-4 focus-visible:outline-accent relative h-24 min-w-0 cursor-pointer touch-none outline-offset-0 focus-visible:outline-2",
                accent ? "text-accent" : "text-text",
            )}
            onPointerMove={(e) => {
                if (e.pointerType === "touch") lens.touchMove(x(e), e.clientX);
                else lens.point(at, x(e));
            }}
            onPointerLeave={(e) => {
                if (e.pointerType !== "touch") lens.leave();
            }}
            onPointerDown={(e) => {
                if (e.pointerType !== "touch") return;
                e.currentTarget.setPointerCapture?.(e.pointerId);
                lens.touchStart(at, x(e), e.clientX);
            }}
            onPointerUp={(e) => {
                if (e.pointerType !== "touch") return;
                if (lens.touchEnd()) {
                    const spot = lens.hovered();
                    if (spot) onPress(spot.spot);
                }
            }}
            onClick={(e) => {
                // A touch presses on its own lift (above)
                if (lens.view().input === "touch") return;
                lens.point(at, x(e));
                const spot = lens.hovered();
                if (spot) onPress(spot.spot);
            }}
            onFocus={() => lens.focusRow(at)}
            onBlur={() => lens.blur()}
            onKeyDown={(e) => {
                const used = lens.key(at, e.key, e.shiftKey);
                if (!used) return;
                e.preventDefault();
                e.stopPropagation();
                if (used === "press") {
                    const spot = lens.hovered();
                    if (spot) onPress(spot.spot);
                }
            }}
        >
            <svg
                className="absolute inset-0 block h-full w-full overflow-hidden fill-current"
                aria-hidden
            >
                {band && (
                    <rect
                        x={band.from}
                        y={1}
                        width={band.to - band.from}
                        height={22}
                        rx={4}
                        className="fill-accent/10"
                        opacity={v.open}
                    />
                )}
                {dots}
                {holes}
            </svg>
        </div>
    );
}

/** How many spots are each side of the one pointed at, over its column above the rows */
export function RowSpotsCount({ lens }: { lens: RowLens }) {
    useLens(lens);
    const hot = lens.hovered();
    const v = lens.view();
    const row = hot ? v.rows[hot.row] : null;
    if (!hot || !row) return null;
    const x = Math.max(0, Math.min(v.width, v.X(spotAt(row, hot.spot))));
    return (
        <span
            className="rounded-6 border-stroke bg-modal text-sub shadow-modal pointer-events-none absolute bottom-0 z-10 -translate-x-1/2 border px-4 whitespace-nowrap tabular-nums"
            style={{ left: x }}
            data-testid="shape-rows-spot-count"
        >
            {tolgee.t("shapes.rows.spotCount", "← {left} · {right} →", {
                left: hot.spot,
                right: row.length - 1 - hot.spot,
            })}
        </span>
    );
}

/**
 * The line under the rows: what a press does, or, while a spot is pointed at, which spot it is and
 * how many are each side of it. Read out to screen readers as it changes.
 */
export function RowSpotsReadout({
    lens,
    names,
    spots,
    across,
}: {
    lens: RowLens;
    names: readonly string[];
    spots: readonly (readonly boolean[])[];
    across: boolean;
}) {
    useLens(lens);
    const hot = lens.hovered();
    const v = lens.view();
    let text: string;
    if (hot && spots[hot.row]) {
        const row = spots[hot.row]!;
        const values = {
            name: names[hot.row] ?? "",
            spot: hot.spot + 1,
            count: row.length,
            left: hot.spot,
            right: row.length - 1 - hot.spot,
        };
        const where = across
            ? tolgee.t(
                  "shapes.rows.spotAcross",
                  "{name}, spot {spot} of {count}: {left} to the left, {right} to the right",
                  values,
              )
            : tolgee.t(
                  "shapes.rows.spotUpDown",
                  "{name}, spot {spot} of {count}: {left} toward the front, {right} toward the back",
                  values,
              );
        const does = row[hot.spot]
            ? tolgee.t("shapes.rows.leaveEmpty", "Leave this spot empty")
            : tolgee.t(
                  "shapes.rows.fillSpot",
                  "Empty spot: press to take it out",
              );
        text = `${where}. ${does}`;
    } else
        text = v.lens
            ? tolgee.t(
                  "shapes.rows.lensHint",
                  "Point along a row to see its spots up close. Press a dot to leave that spot empty",
              )
            : tolgee.t(
                  "shapes.rows.dotHint",
                  "Press a dot to leave that spot empty",
              );
    return (
        <span
            className="text-text/60 min-h-40 px-4"
            aria-live="polite"
            data-testid="shape-rows-readout"
        >
            {text}
        </span>
    );
}
