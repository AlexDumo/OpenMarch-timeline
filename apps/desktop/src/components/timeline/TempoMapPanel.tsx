/**
 * The tempo map (Tempo lab `tempoMap`, experiment E11): a keyboard-driven table with one row per
 * tempo or meter change at a measure. Opened from the transport's "⋯" menu or Shift+T; nobody
 * sees it unless they turn the flag on and open it. Every edit only changes count lengths, and
 * each is one undo entry (`retimeBeats`).
 */
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type RefObject,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { DotsThreeIcon, XIcon } from "@phosphor-icons/react";
import clsx from "clsx";
import { workspaceSettingsKeys } from "@/hooks/queries/useWorkspaceSettings";
import { useRetimeBeats } from "@/hooks/queries/useTempo";
import { useTempoLabFlag } from "@/stores/UiSettingsStore";
import {
    addRowAt,
    editRowMeter,
    editRowRamp,
    editRowTempo,
    findMeasure,
    formatBpm,
    formatMeter,
    formatTempo,
    markText,
    meterText,
    parseMeterCell,
    parseRampCell,
    parseTempoCell,
    removeRow,
    retimeArgsOf,
    rowTempoText,
    UNIT_GLYPH,
    type TempoMapEditError,
    type TempoMapEditResult,
    type TempoMapRow,
} from "@/timeline/tempo";
import { isTyping, overlayOpen } from "./timelineHotkeys";
import { useTempoMapState } from "./useTempoMapState";

/** The table's columns; only meter, tempo and rit./accel. are edited. */
const COLUMNS = [
    { key: "measure", label: "Measure", editable: false, width: "w-[88px]" },
    { key: "meter", label: "Meter", editable: true, width: "w-[100px]" },
    { key: "tempo", label: "Tempo", editable: true, width: "w-[100px]" },
    {
        key: "ramp",
        label: "Rit./accel.",
        editable: true,
        width: "min-w-[140px] flex-1",
    },
    { key: "start", label: "Starts", editable: false, width: "w-[84px]" },
    { key: "counts", label: "Counts", editable: false, width: "w-[104px]" },
] as const;
type ColumnKey = (typeof COLUMNS)[number]["key"];

const EDIT_ERRORS: Record<TempoMapEditError, string> = {
    noPreviousRow: "There's no row before this one to take the tempo from",
    tooSlow: "Too slow: tempos start at 40 and a count lasts at most 30 s",
    tooFast: "Too fast: a count can't be shorter than 0.15 s (400 per minute)",
    rampNeedsCounts: "A rit. or accel. needs at least two counts",
    changesCounts:
        "That changes the number of counts: not in this prototype. Only regroup (3/4 to 7/8 2+2+3, 4/4 to 12/8)",
    rowExists: "A row already starts there",
    noSuchMeasure: "There's no such measure",
    notTyped:
        "This row comes from the counts themselves; only rows you added can be removed",
};

const TEMPO_HELP =
    "Type 152.5, ♩=152.5, q=152.5, dq=176 (♩.=176), e=352, ♩.=♩ or =prev";
const RAMP_HELP =
    "Type the tempo it ends on (100, rit. to ♩=100), or - for none";
const METER_HELP = "Regroup: 7/8 2+2+3, 5/8 3+2, 12/8";

/** "1:23.456" */
export const formatStart = (seconds: number) => {
    const ms = Math.round(seconds * 1000);
    const m = Math.floor(ms / 60000);
    const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
    return `${m}:${s}`;
};

export const tempoText = rowTempoText;

export const rampText = (row: TempoMapRow) =>
    row.shape !== "ramp"
        ? ""
        : `${row.endBpm < row.startBpm ? "rit." : "accel."} to ${formatTempo(row.unit, row.endBpm, row.exact)}`;

const measureText = (row: TempoMapRow) =>
    `m${row.measureNumber}${row.rehearsalMark ? ` ${row.rehearsalMark}` : ""}`;

const countsText = (row: TempoMapRow) =>
    `${row.from}–${row.to - 1} (${row.to - row.from})`;

function cellText(row: TempoMapRow, column: ColumnKey): string {
    switch (column) {
        case "measure":
            return measureText(row);
        case "meter":
            return meterText(row);
        case "tempo":
            return tempoText(row);
        case "ramp":
            return rampText(row);
        case "start":
            return formatStart(row.startTime);
        case "counts":
            return countsText(row);
    }
}

/** What a cell's editor starts with: the value without "≈", so Enter right away rewrites it. */
function editText(row: TempoMapRow, column: ColumnKey): string {
    if (column === "tempo")
        return `${UNIT_GLYPH[row.unit]}=${formatBpm(row.shape === "uneven" ? row.averageBpm : row.startBpm)}`;
    if (column === "ramp")
        return row.shape === "ramp"
            ? `${UNIT_GLYPH[row.unit]}=${formatBpm(row.endBpm)}`
            : "";
    if (column === "meter") return row.label ?? formatMeter(row.meter);
    return cellText(row, column);
}

type Message = { text: string; tone: "error" | "info" } | null;

/**
 * The Measure cell's dot: ● a tempo typed here (or read from the score) that still plays; ○ one
 * that a drag or a fit has since moved, with the written value in its tooltip (FX-4).
 */
function TypedDot({ row }: { row: TempoMapRow }) {
    const written =
        row.markedBpm !== undefined
            ? formatTempo(row.unit, row.markedBpm, true)
            : null;
    const from = row.source === "import" ? "From the score" : "Typed";
    const title = !written
        ? "A row you added"
        : row.exact
          ? `${from}: ${written}`
          : `${from} ${written}; changed since (now ${rowTempoText(row)})`;
    return (
        <span
            className={clsx(
                "text-[10px]",
                row.exact || !written ? "text-accent" : "text-text-subtitle",
            )}
            title={title}
            aria-label={title}
            data-testid="tempo-map-typed"
            data-exact={row.exact || undefined}
        >
            {row.exact || !written ? "●" : "○"}
        </span>
    );
}

/** The table itself, for the panel (and for tests). */
export function TempoMapTable({
    onClose,
    gridRef: outerGridRef,
}: {
    onClose?: () => void;
    /** The grid, so the panel can put the focus in it when it opens */
    gridRef?: RefObject<HTMLDivElement | null>;
}) {
    const map = useTempoMapState();
    const { rows } = map.state;
    const retime = useRetimeBeats();
    const queryClient = useQueryClient();
    const [active, setActive] = useState({ row: 0, col: 2 });
    const [editing, setEditing] = useState<string | null>(null);
    const [message, setMessage] = useState<Message>(null);
    const [addText, setAddText] = useState("");
    const ownGridRef = useRef<HTMLDivElement>(null);
    const gridRef = outerGridRef ?? ownGridRef;
    const addRef = useRef<HTMLInputElement>(null);

    const row = Math.min(active.row, Math.max(rows.length - 1, 0));
    const column = COLUMNS[active.col];

    const focusGrid = useCallback(
        () => requestAnimationFrame(() => gridRef.current?.focus()),
        [gridRef],
    );

    const write = useCallback(
        async (
            result: TempoMapEditResult,
            done:
                | string
                | ((r: Extract<TempoMapEditResult, { ok: true }>) => string),
        ) => {
            if (!result.ok) {
                setMessage({ text: EDIT_ERRORS[result.error], tone: "error" });
                return false;
            }
            try {
                await retime.mutateAsync(
                    retimeArgsOf({
                        write: result.write,
                        beatIds: map.beatIds,
                        measureStartBeatIds: map.measureStartBeatIds,
                        syncedBeatIds: map.syncedBeatIds,
                    }),
                );
                // The next edit builds on the marks and synced counts this one wrote
                await queryClient.refetchQueries({
                    queryKey: workspaceSettingsKeys.all(),
                });
            } catch {
                // The mutation's own toast says what went wrong
                setMessage({ text: "Couldn't save that edit", tone: "error" });
                return false;
            }
            setMessage({
                text: typeof done === "string" ? done : done(result),
                tone: "info",
            });
            return true;
        },
        [map, retime, queryClient],
    );

    const commit = async (text: string) => {
        const target = rows[row];
        if (!target) return;
        let result: TempoMapEditResult;
        if (column.key === "tempo") {
            const cell = parseTempoCell(text);
            if (cell.kind === "error") {
                setMessage({ text: TEMPO_HELP, tone: "error" });
                return;
            }
            result = editRowTempo(map.state, row, cell);
        } else if (column.key === "ramp") {
            const cell = parseRampCell(text);
            if (cell.kind === "error") {
                setMessage({ text: RAMP_HELP, tone: "error" });
                return;
            }
            result = editRowRamp(map.state, row, cell);
        } else if (column.key === "meter") {
            const cell = parseMeterCell(text);
            if (cell.kind === "error") {
                setMessage({ text: METER_HELP, tone: "error" });
                return;
            }
            result = editRowMeter(map.state, row, cell.meter);
        } else return;
        // Say what was written, not what was typed: "=prev" reads "m29: ♩=176"
        const resolved = (r: Extract<TempoMapEditResult, { ok: true }>) => {
            const mark = r.write.marks.get(target.measureIndex);
            const what = mark
                ? markText(mark, {
                      withMeter:
                          column.key === "meter" ||
                          (mark.meter !== undefined &&
                              formatMeter(mark.meter) !==
                                  formatMeter(target.meter)),
                  })
                : "";
            return `${measureText(target)}: ${what || text.trim() || "no rit."}`;
        };
        if (await write(result, resolved)) {
            setEditing(null);
            focusGrid();
        }
    };

    const addRow = async () => {
        const index = findMeasure(map.state.measures, addText);
        const result =
            index < 0
                ? ({ ok: false, error: "noSuchMeasure" } as const)
                : addRowAt(map.state, index);
        if (await write(result, `Added a row at ${addText.trim()}`)) {
            setAddText("");
            const at = map.state.rows.findIndex((r) => r.measureIndex > index);
            setActive({ row: at < 0 ? rows.length : at, col: 2 });
            focusGrid();
        }
    };

    const onGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (editing !== null) return;
        const move = (dRow: number, dCol: number) => {
            event.preventDefault();
            setMessage(null);
            setActive({
                row: Math.max(0, Math.min(rows.length - 1, row + dRow)),
                col: Math.max(
                    0,
                    Math.min(COLUMNS.length - 1, active.col + dCol),
                ),
            });
        };
        switch (event.key) {
            case "ArrowUp":
                return move(-1, 0);
            case "ArrowDown":
                return move(1, 0);
            case "ArrowLeft":
                return move(0, -1);
            case "ArrowRight":
                return move(0, 1);
            case "Home":
                return move(event.ctrlKey ? -rows.length : 0, -COLUMNS.length);
            case "End":
                return move(event.ctrlKey ? rows.length : 0, COLUMNS.length);
            case "Enter":
            case "F2":
                event.preventDefault();
                if (!column.editable || !rows[row]) {
                    setMessage({
                        text: `${column.label} comes from the counts and can't be typed`,
                        tone: "info",
                    });
                    return;
                }
                setMessage(null);
                setEditing(editText(rows[row], column.key));
                return;
            case "Delete":
            case "Backspace":
                event.preventDefault();
                if (rows[row])
                    void write(
                        removeRow(map.state, row),
                        `Removed the row at ${measureText(rows[row])}`,
                    );
                return;
            case "+":
            case "Insert":
                event.preventDefault();
                addRef.current?.focus();
                return;
        }
        // Space (play, elsewhere) does nothing here: no tempo or meter starts with it
        if (event.key === " ") {
            event.preventDefault();
            return;
        }
        // Typing starts an edit, as in a spreadsheet
        if (
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            column.editable &&
            rows[row]
        ) {
            event.preventDefault();
            setMessage(null);
            setEditing(event.key);
        }
    };

    return (
        <div className="flex min-h-0 flex-col gap-8">
            <div
                ref={gridRef}
                role="grid"
                aria-label="Tempo map"
                aria-rowcount={rows.length + 1}
                aria-colcount={COLUMNS.length}
                aria-activedescendant={
                    editing === null
                        ? `tempo-map-${row}-${active.col}`
                        : undefined
                }
                tabIndex={0}
                data-testid="tempo-map-grid"
                onKeyDown={onGridKeyDown}
                className="border-stroke rounded-6 focus-visible:ring-accent min-h-0 overflow-auto border font-mono text-[12px] outline-hidden focus-visible:ring-2"
            >
                <div
                    role="row"
                    className="bg-fg-2 text-text-subtitle sticky top-0 flex"
                >
                    {COLUMNS.map((c) => (
                        <div
                            key={c.key}
                            role="columnheader"
                            className={clsx(
                                "px-8 py-4 font-sans text-[11px]",
                                "shrink-0",
                                c.width,
                            )}
                        >
                            {c.label}
                        </div>
                    ))}
                </div>
                {rows.map((r, i) => (
                    <div
                        role="row"
                        key={r.measureIndex}
                        aria-rowindex={i + 2}
                        data-testid="tempo-map-row"
                        className="border-stroke flex border-t"
                    >
                        {COLUMNS.map((c, j) => {
                            const isActive = i === row && j === active.col;
                            const text = cellText(r, c.key);
                            return (
                                <div
                                    key={c.key}
                                    id={`tempo-map-${i}-${j}`}
                                    role="gridcell"
                                    aria-readonly={!c.editable || undefined}
                                    aria-selected={isActive}
                                    data-column={c.key}
                                    onClick={() => {
                                        setActive({ row: i, col: j });
                                        setEditing(null);
                                        gridRef.current?.focus();
                                    }}
                                    onDoubleClick={() => {
                                        if (c.editable)
                                            setEditing(editText(r, c.key));
                                    }}
                                    className={clsx(
                                        "flex min-h-26 items-center gap-4 truncate px-8 py-3",
                                        "shrink-0",
                                        c.width,
                                        !c.editable && "text-text-subtitle",
                                        isActive &&
                                            "ring-accent bg-accent/10 ring-1 ring-inset",
                                    )}
                                >
                                    {isActive && editing !== null ? (
                                        <input
                                            autoFocus
                                            aria-label={`${c.label} at ${measureText(r)}`}
                                            data-testid="tempo-map-editor"
                                            value={editing}
                                            onChange={(e) => {
                                                setEditing(e.target.value);
                                                setMessage(null);
                                            }}
                                            onKeyDown={(e) => {
                                                e.stopPropagation();
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    void commit(editing);
                                                } else if (e.key === "Escape") {
                                                    e.preventDefault();
                                                    setEditing(null);
                                                    setMessage(null);
                                                    focusGrid();
                                                }
                                            }}
                                            onBlur={() => setEditing(null)}
                                            className="bg-bg-1 text-text rounded-4 border-accent h-20 w-full min-w-0 border px-4 outline-hidden"
                                        />
                                    ) : (
                                        <>
                                            <span className="truncate">
                                                {text}
                                            </span>
                                            {c.key === "measure" && r.typed && (
                                                <TypedDot row={r} />
                                            )}
                                            {c.key === "meter" &&
                                                r.meterInferred &&
                                                r.meter.groups && (
                                                    <span
                                                        className="text-text-subtitle text-[10px]"
                                                        title="Read from the count lengths"
                                                    >
                                                        ?
                                                    </span>
                                                )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
            <p
                role="status"
                aria-live="polite"
                data-testid="tempo-map-message"
                className={clsx(
                    "min-h-16 text-[11px]",
                    message?.tone === "error"
                        ? "text-red"
                        : "text-text-subtitle",
                )}
            >
                {message?.text ??
                    (column.key === "tempo"
                        ? TEMPO_HELP
                        : column.key === "ramp"
                          ? RAMP_HELP
                          : column.key === "meter"
                            ? METER_HELP
                            : "Arrows move, Enter edits and saves, Esc cancels. Delete removes a row you added. Each edit is one undo.")}
            </p>
            <form
                className="flex items-center gap-8 text-[12px]"
                onSubmit={(e) => {
                    e.preventDefault();
                    void addRow();
                }}
            >
                <label htmlFor="tempo-map-add" className="text-text-subtitle">
                    Add a row at
                </label>
                <input
                    id="tempo-map-add"
                    ref={addRef}
                    data-testid="tempo-map-add"
                    value={addText}
                    placeholder="m45 or C"
                    onChange={(e) => setAddText(e.target.value)}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Escape") {
                            e.preventDefault();
                            focusGrid();
                        }
                    }}
                    className="bg-bg-1 text-text rounded-4 border-stroke focus:border-accent h-24 w-[96px] border px-6 font-mono outline-hidden"
                />
                <span className="text-text-subtitle text-[11px]">
                    Splits a row without changing any count (+ from the table)
                </span>
                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-text-subtitle hover:text-text ml-auto text-[11px]"
                    >
                        Close (Esc)
                    </button>
                )}
            </form>
        </div>
    );
}

/**
 * Whether a key pressed inside the tempo map stays there: everything but Ctrl/⌘ shortcuts (undo,
 * save) and Esc, which closes the map (Radix listens for it on the document).
 */
export const mapOwnsKey = (event: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
}) => !event.ctrlKey && !event.metaKey && event.key !== "Escape";

/** The tempo map as a side panel that leaves the timeline and field usable. */
export function TempoMapPanel({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const gridRef = useRef<HTMLDivElement>(null);
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
            <Dialog.Portal>
                <Dialog.Content
                    data-testid="tempo-map"
                    // Typing starts in the grid's first tempo cell, never on ✕ (FX-1)
                    onOpenAutoFocus={(e) => {
                        e.preventDefault();
                        gridRef.current?.focus();
                    }}
                    // While the map has the focus its keys are its own: Space, R, WASD and the
                    // other single-key shortcuts don't reach the app. Ctrl/⌘ ones (undo) still do
                    onKeyDown={(e) => {
                        if (!mapOwnsKey(e)) return;
                        e.stopPropagation();
                    }}
                    onInteractOutside={(e) => e.preventDefault()}
                    // Esc in a cell editor or the add box cancels that, not the panel
                    onEscapeKeyDown={(e) => {
                        if (document.activeElement instanceof HTMLInputElement)
                            e.preventDefault();
                    }}
                    className="border-stroke bg-modal text-text shadow-modal rounded-6 backdrop-blur-32 fixed top-48 right-16 z-[400] flex max-h-[calc(100vh-96px)] w-[660px] max-w-[calc(100vw-32px)] flex-col gap-12 border p-16 font-sans"
                >
                    <div className="flex items-start justify-between gap-8">
                        <div>
                            <Dialog.Title className="text-h5 leading-none">
                                Tempo map
                            </Dialog.Title>
                            <Dialog.Description className="text-text-subtitle mt-4 text-[11px]">
                                One row per tempo or meter change. = is a tempo
                                typed here or read from the score, still as
                                written; ≈ came from a drag, tapping or an
                                average. Typing only changes when counts land.
                            </Dialog.Description>
                        </div>
                        <Dialog.Close
                            aria-label="Close the tempo map"
                            className="text-text hover:text-red"
                        >
                            <XIcon size={18} />
                        </Dialog.Close>
                    </div>
                    <TempoMapTable
                        gridRef={gridRef}
                        onClose={() => onOpenChange(false)}
                    />
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/**
 * The transport's "⋯" menu with "Tempo map…", and Shift+T, behind the Tempo lab flag. Renders
 * nothing with the flag off.
 */
export function TempoMapMenu() {
    const enabled = useTempoLabFlag("tempoMap");
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (!enabled) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (
                event.key.toLowerCase() !== "t" ||
                !event.shiftKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey ||
                event.repeat ||
                isTyping(event.target) ||
                overlayOpen()
            )
                return;
            event.preventDefault();
            setOpen(true);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [enabled]);
    if (!enabled) return null;
    return (
        <>
            <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                    <button
                        type="button"
                        data-testid="timeline-more-menu"
                        aria-label="More timeline tools"
                        title="More timeline tools"
                        className="rounded-4 text-text enabled:hover:bg-fg-2 focus-visible:ring-accent flex size-24 items-center justify-center outline-hidden focus-visible:ring-2"
                    >
                        <DotsThreeIcon size={18} weight="bold" />
                    </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                    <DropdownMenu.Content
                        align="end"
                        sideOffset={6}
                        className="bg-modal text-text rounded-6 border-stroke shadow-modal z-50 flex min-w-[180px] flex-col gap-4 border p-4 backdrop-blur-md"
                    >
                        <DropdownMenu.Item
                            data-testid="tempo-map-open"
                            onSelect={() => setOpen(true)}
                            className="rounded-4 data-[highlighted]:bg-fg-2 flex cursor-default items-center justify-between gap-16 px-8 py-6 text-[12px] outline-hidden select-none"
                        >
                            Tempo map…
                            <span className="text-text-subtitle font-mono text-[11px]">
                                Shift+T
                            </span>
                        </DropdownMenu.Item>
                    </DropdownMenu.Content>
                </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <TempoMapPanel open={open} onOpenChange={setOpen} />
        </>
    );
}
