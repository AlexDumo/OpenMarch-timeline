import clsx from "clsx";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
    DotsThreeIcon,
    FlipHorizontalIcon,
    FlipVerticalIcon,
    LinkSimpleBreakIcon,
    LinkSimpleIcon,
    MinusIcon,
    PlusIcon,
} from "@phosphor-icons/react";
import { fieldToElement, useFieldViewStore } from "@/field/three/fieldView";
import { boxBounds, shortBy, type BoxParams } from "../box/boxGeometry";
import { DEFAULT_PIVOT, rotationDegrees } from "../frame/frame";
import { currentShapeField } from "../field/shapeFieldContext";
import {
    toggleRatioLock,
    useShapeEditorStore,
} from "../frame/shapeEditorStore";
import { toolEnvFor } from "../tool/toolEnv";
import type { ToolEnv } from "../tool/toolKind";
import { useShapeToolStore } from "../tool/shapeToolStore";
import {
    flipBox,
    onField,
    scrubRotation,
    scrubSize,
    scrubSpacing,
    turnTo,
    withFieldCount,
    withSpacing,
} from "./boxEdits";
import {
    usePlacedEditTarget,
    useToolEditTarget,
    type ShapeEditTarget,
} from "./editTargets";
import { formatSteps } from "./format";
import { parseDegrees, parseSize, parseSteps, scrubDistance } from "./scrub";
import { ScrubNumber, type ScrubMove } from "./ScrubNumber";
import { isBasicMode } from "@/stores/EditorModeStore";

/** The gap between the shape's outline and the editor, in CSS px */
const GAP_PX = 14;

/**
 * The floating editor (08-shape-system-ux.md, "The floating editor"), the main place for editing
 * a shape: a small bar under the open shape, or the selected placed one, with the numbers people
 * change most. It moves with the shape and flips above it when there's no room below. Before a
 * shape is drawn, a hint at the top of the field says how to draw one.
 *
 * For a box: `− 6 × 2 + │ ↔ 2 ↕ 2 steps 🔗 │ ⋯ │ Place`. Every number can be typed or dragged,
 * and follows the field: across is side to side however the box is turned. ⋯ opens a second row:
 * the rotation (typed or dragged), flips, and who goes where. Place shows only for a new
 * shape; a selected placed shape saves each edit on release.
 */
export function ShapeEditor({ stepPx }: { stepPx: number }) {
    const toolOpen = useShapeToolStore((s) => s.tool !== null);
    const drawn = useShapeToolStore((s) => s.tool?.params != null);
    const tool = useToolEditTarget();
    const placed = usePlacedEditTarget();
    if (toolOpen && !drawn)
        return (
            <div
                className="rounded-6 border-stroke bg-modal text-body text-text shadow-modal pointer-events-none absolute top-12 left-1/2 z-10 -translate-x-1/2 border px-12 py-6"
                data-testid="shape-tool-hint"
            >
                Drag on the field to draw a box · Esc to cancel
            </div>
        );
    const target = toolOpen ? tool : placed;
    if (!target) return null;
    return (
        <ShapeEditorBar
            target={target}
            stepPx={stepPx}
            testId={toolOpen ? "shape-tool-readout" : "placed-box-readout"}
        />
    );
}

/** The env an editor change is worked out with, Alt being "don't snap" as on the field */
const envFor = (keys: { alt: boolean; shift: boolean }): ToolEnv | null => {
    const field = currentShapeField();
    return field ? toolEnvFor(field, keys) : null;
};

const PLAIN = { alt: false, shift: false };

function ShapeEditorBar({
    target,
    stepPx,
    testId,
}: {
    target: ShapeEditTarget;
    stepPx: number;
    testId: string;
}) {
    const { params, spots } = target;
    const ratioLocked = useShapeEditorStore((s) => s.ratioLocked);
    const pivot = useShapeEditorStore((s) => s.pivot);
    const [more, setMore] = useState(false);
    const place = usePlacement(params, spots);
    // The box at the press of a number's drag
    const base = useRef<BoxParams>(params);

    // Across is side to side on the field, however the box is turned (owner, 2026-10-17)
    const field = onField(params, spots);
    const short = shortBy(params, spots);
    const across = formatSteps(field.acrossSpacing / stepPx);
    const deep = formatSteps(field.deepSpacing / stepPx);
    const degrees = rotationDegrees(params.rotation);
    const turnPivot = isBasicMode() ? DEFAULT_PIVOT : pivot;

    /** One change at once, worked out with no keys held */
    const apply = (change: (env: ToolEnv) => BoxParams) => {
        const env = envFor(PLAIN);
        if (env) target.apply(change(env));
    };
    /** A number's drag: the change from the box at the press, previewed live */
    const scrub = (
        change: (b: BoxParams, m: ScrubMove, env: ToolEnv) => BoxParams,
    ) => ({
        onScrubStart: () => {
            base.current = params;
            target.begin();
        },
        onScrub: (m: ScrubMove) => {
            const env = envFor(m);
            if (env) target.preview(change(base.current, m, env));
        },
        onScrubEnd: (keep: boolean) => target.end(keep),
    });
    /** A spacing as typed: steps, the field's across or deep */
    const typeSpacing = (key: "across" | "deep") => (text: string) => {
        const steps = parseSteps(text);
        if (steps === null) return false;
        apply((env) => withSpacing(params, key, steps, spots, env));
        return true;
    };

    return (
        <div
            ref={place.ref}
            className="rounded-6 border-stroke bg-modal text-sub text-text shadow-modal absolute z-10 flex -translate-x-1/2 flex-col gap-4 border px-6 py-4 whitespace-nowrap"
            style={place.style}
            data-testid={testId}
            data-shape-editor
            data-placement={place.above ? "above" : "below"}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <div className="flex items-center gap-6">
                <span
                    className="flex items-center gap-2"
                    data-testid={`${testId}-text`}
                >
                    <IconButton
                        label="One fewer across"
                        disabled={field.across <= 1}
                        onClick={() =>
                            apply((env) =>
                                withFieldCount(
                                    params,
                                    spots,
                                    "across",
                                    field.across - 1,
                                    env,
                                ),
                            )
                        }
                    >
                        <MinusIcon size={12} />
                    </IconButton>
                    <ScrubNumber
                        display={`${field.across} × ${field.deep}`}
                        axis="both"
                        label="Size, across × deep"
                        testId="shape-editor-size"
                        {...scrub((b, m, env) =>
                            scrubSize(
                                b,
                                m.axis === "x" ? "across" : "deep",
                                scrubDistance(m.axis, m.dx, m.dy),
                                spots,
                                env,
                            ),
                        )}
                        onType={(text) => {
                            const size = parseSize(text);
                            if (!size) return false;
                            apply((env) =>
                                size.across !== field.across ||
                                size.deep === undefined
                                    ? withFieldCount(
                                          params,
                                          spots,
                                          "across",
                                          size.across,
                                          env,
                                      )
                                    : withFieldCount(
                                          params,
                                          spots,
                                          "deep",
                                          size.deep,
                                          env,
                                      ),
                            );
                            return true;
                        }}
                    />
                    <IconButton
                        label="One more across"
                        disabled={field.across >= spots}
                        onClick={() =>
                            apply((env) =>
                                withFieldCount(
                                    params,
                                    spots,
                                    "across",
                                    field.across + 1,
                                    env,
                                ),
                            )
                        }
                    >
                        <PlusIcon size={12} />
                    </IconButton>
                    {short > 0 && (
                        <span className="text-text/60">· {short} short</span>
                    )}
                    {target.empty > 0 && (
                        <span className="text-text/60">
                            · {target.empty} empty
                        </span>
                    )}
                </span>
                {spots > 1 && (
                    <>
                        <Divider />
                        <span className="flex items-center gap-2">
                            {field.across > 1 && (
                                <>
                                    <span className="text-text/60" aria-hidden>
                                        ↔
                                    </span>
                                    <ScrubNumber
                                        display={across}
                                        axis="x"
                                        label="Side-to-side spacing, in steps"
                                        testId="shape-editor-across"
                                        {...scrub((b, m, env) =>
                                            scrubSpacing(
                                                b,
                                                field.acrossKey,
                                                scrubDistance("x", m.dx, m.dy),
                                                spots,
                                                env,
                                            ),
                                        )}
                                        onType={typeSpacing(field.acrossKey)}
                                    />
                                </>
                            )}
                            {field.deep > 1 && (
                                <>
                                    <span className="text-text/60" aria-hidden>
                                        ↕
                                    </span>
                                    <ScrubNumber
                                        display={deep}
                                        axis="y"
                                        label="Front-to-back spacing, in steps"
                                        testId="shape-editor-deep"
                                        {...scrub((b, m, env) =>
                                            scrubSpacing(
                                                b,
                                                field.deepKey,
                                                scrubDistance("y", m.dx, m.dy),
                                                spots,
                                                env,
                                            ),
                                        )}
                                        onType={typeSpacing(field.deepKey)}
                                    />
                                </>
                            )}
                            <span className="text-text/60">steps</span>
                            {field.across > 1 && field.deep > 1 && (
                                <IconButton
                                    label={
                                        ratioLocked
                                            ? "Spacings locked together: click to unlock"
                                            : "Lock the two spacings together"
                                    }
                                    pressed={ratioLocked}
                                    onClick={toggleRatioLock}
                                    testId="shape-editor-ratio-lock"
                                >
                                    {ratioLocked ? (
                                        <LinkSimpleIcon size={14} />
                                    ) : (
                                        <LinkSimpleBreakIcon size={14} />
                                    )}
                                </IconButton>
                            )}
                        </span>
                    </>
                )}
                {target.drawnOn && (
                    <span className="text-text/50">from {target.drawnOn}</span>
                )}
                <Divider />
                <IconButton
                    label="More: turn, flip, who goes where"
                    pressed={more}
                    onClick={() => setMore((m) => !m)}
                    testId="shape-editor-more"
                >
                    <DotsThreeIcon size={16} weight="bold" />
                </IconButton>
                {target.place && (
                    <>
                        <Divider />
                        <button
                            type="button"
                            className="bg-accent text-text-invert rounded-4 px-8 py-2 font-medium hover:opacity-90"
                            onPointerDown={keepFocus}
                            onClick={target.place}
                            data-testid="shape-editor-place"
                        >
                            Place
                        </button>
                    </>
                )}
            </div>
            {more && (
                <div
                    className="flex items-center gap-6"
                    data-testid="shape-editor-more-row"
                >
                    <span className="flex items-center gap-2">
                        <span className="text-text/60">Turn</span>
                        <ScrubNumber
                            display={`${degrees}°`}
                            editText={String(degrees)}
                            axis="x"
                            label="Rotation, in degrees clockwise"
                            testId="shape-editor-rotation"
                            {...scrub((b, m, env) =>
                                scrubRotation(
                                    b,
                                    scrubDistance("x", m.dx, m.dy),
                                    spots,
                                    turnPivot,
                                    env,
                                ),
                            )}
                            onType={(text) => {
                                const typed = parseDegrees(text);
                                if (typed === null) return false;
                                apply((env) =>
                                    turnTo(
                                        params,
                                        spots,
                                        typed,
                                        turnPivot,
                                        env,
                                    ),
                                );
                                return true;
                            }}
                        />
                    </span>
                    <Divider />
                    <TextButton
                        label="Flip side to side"
                        onClick={() =>
                            apply((env) =>
                                flipBox(
                                    params,
                                    spots,
                                    "across",
                                    turnPivot,
                                    env,
                                ),
                            )
                        }
                        testId="shape-editor-flip-across"
                    >
                        <FlipHorizontalIcon size={14} />
                        Flip ↔
                    </TextButton>
                    <TextButton
                        label="Flip front to back"
                        onClick={() =>
                            apply((env) =>
                                flipBox(params, spots, "deep", turnPivot, env),
                            )
                        }
                        testId="shape-editor-flip-deep"
                    >
                        <FlipVerticalIcon size={14} />
                        Flip ↕
                    </TextButton>
                    <Divider />
                    <span className="text-text/60">Who goes where</span>
                    <span className="flex flex-col gap-1">
                        <Segmented
                            value={target.kept ? null : target.order}
                            options={[
                                { value: "nearest", label: "Least travel" },
                                { value: "drill", label: "Drill order" },
                            ]}
                            onChange={target.setOrder}
                            testId="shape-editor-order"
                        />
                        {target.kept && (
                            <span
                                className="text-text/60 text-xs"
                                data-testid="shape-editor-order-kept"
                            >
                                Kept from your turn or flip · pick one to redo
                            </span>
                        )}
                    </span>
                </div>
            )}
        </div>
    );
}

/**
 * Where the editor sits: under the shape's outline, centered, and above it when there's no room
 * below in the field. Follows the field as it pans and zooms.
 */
function usePlacement(params: BoxParams, spots: number) {
    const view = useFieldViewStore();
    const ref = useRef<HTMLDivElement>(null);
    const [room, setRoom] = useState({ height: 0, field: Infinity });
    const b = boxBounds(params, spots);
    const bottom = fieldToElement(view, (b.left + b.right) / 2, b.bottom);
    const top = fieldToElement(view, (b.left + b.right) / 2, b.top);
    // The outline's spots have a radius and the handles stick out: clear them
    const pad = GAP_PX + 6;
    // Its own height (the ⋯ row opens) and the field's, as they change
    useLayoutEffect(() => {
        const el = ref.current;
        const field = el?.offsetParent;
        if (!el || !field) return;
        const measure = () =>
            setRoom({ height: el.offsetHeight, field: field.clientHeight });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        observer.observe(field);
        return () => observer.disconnect();
    }, []);
    const above =
        bottom.y + pad + room.height > room.field &&
        top.y - pad - room.height > 0;
    return {
        ref,
        above,
        style: above
            ? { left: top.x, top: top.y - pad - room.height }
            : { left: bottom.x, top: bottom.y + pad },
    };
}

/**
 * A press on the editor's buttons doesn't move focus to them, so Enter still places the shape and
 * Escape still cancels it, rather than pressing the last button clicked again
 */
const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

/** A button in the ⋯ row: an icon and a word, so nobody has to guess (sims, F1) */
function TextButton({
    label,
    onClick,
    testId,
    children,
}: {
    label: string;
    onClick: () => void;
    testId?: string;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onPointerDown={keepFocus}
            onClick={onClick}
            data-testid={testId}
            className="rounded-4 hover:text-accent hover:bg-fg-2 flex items-center gap-4 px-4 py-2"
        >
            {children}
        </button>
    );
}

function Divider() {
    return <span className="bg-stroke h-16 w-px" aria-hidden />;
}

function IconButton({
    label,
    onClick,
    disabled,
    pressed,
    testId,
    children,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    pressed?: boolean;
    testId?: string;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={pressed}
            disabled={disabled}
            onPointerDown={keepFocus}
            onClick={onClick}
            data-testid={testId}
            className={clsx(
                "rounded-4 flex items-center p-2 disabled:opacity-40",
                pressed ? "text-accent bg-fg-2" : "hover:text-accent",
            )}
        >
            {children}
        </button>
    );
}

function Segmented<V extends string>({
    value,
    options,
    onChange,
    testId,
}: {
    /** Null when none is chosen */
    value: V | null;
    options: readonly { value: V; label: string }[];
    onChange: (value: V) => void;
    testId?: string;
}) {
    return (
        <span
            className="rounded-4 border-stroke flex border"
            role="radiogroup"
            data-testid={testId}
        >
            {options.map((o) => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={o.value === value}
                    onPointerDown={keepFocus}
                    onClick={() => onChange(o.value)}
                    className={clsx(
                        "px-6 py-1",
                        o.value === value
                            ? "bg-accent text-text-invert"
                            : "hover:text-accent",
                    )}
                >
                    {o.label}
                </button>
            ))}
        </span>
    );
}
