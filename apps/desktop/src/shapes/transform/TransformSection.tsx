import clsx from "clsx";
import { useRef, type ReactNode } from "react";
import { keepFocus } from "../editor/keepFocus";
import {
    FlipHorizontalIcon,
    FlipVerticalIcon,
    MinusIcon,
    PlusIcon,
} from "@phosphor-icons/react";
import { getButtonClassName } from "@openmarch/ui";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useUpdateSelectedMarchersOnSelectedPage } from "@/hooks/queries/useMarcherPages";
import MarcherRotationInput from "@/components/inspector/marcher/MarcherRotationInput";
import {
    DEGREE,
    PIVOT_KEYS,
    rotationDegrees,
    type FlipAxis,
    type Pivot,
    type PivotKey,
} from "../frame/frame";
import { pivotOf, withPivot } from "../frame/pivot";
import { flipShape, scrubTurn, turnShape } from "../frame/gestures";
import { scaleReadout, scaleShape } from "../frame/scale";
import { setShapePivot, useShapeEditorStore } from "../frame/shapeEditorStore";
import { currentShapeField } from "../field/shapeFieldContext";
import {
    usePlacedEditTarget,
    useToolEditTarget,
    type ShapeEditTarget,
} from "../editor/editTargets";
import { parseDegrees, scrubDistance } from "../editor/scrub";
import { ScrubNumber, type ScrubMove } from "../editor/ScrubNumber";
import { toolEnvFor } from "../tool/toolEnv";
import type { ToolEnv } from "../tool/toolKind";
import { useShapeHidden, useShapeToolStore } from "../tool/shapeToolStore";
import { flipSelection, selectionPivot } from "./selectionTransform";
import { GlyphText } from "../editor/GlyphText";
import { Tip } from "../editor/Tip";

/**
 * The inspector's Transform section (#349, spec #344, "Editing and transforming"), whenever
 * marchers are selected: the pivot grid, the rotation and the two flips, all around the pivot.
 * For a shape (the open one, or a selected placed one) it also scales by interval, half a step
 * per − or +, never by a percentage; the shape keeps its turn and flip in its recipe. For a plain
 * selection only positions change: no scale, no recipe. The same in Basic and Expert. Hidden
 * while the open shape waits out of sight (#416).
 */
export function TransformSection() {
    const selected = useSelectedMarchers()?.selectedMarchers ?? [];
    const toolOpen = useShapeToolStore((s) => s.tool !== null);
    const away = useShapeHidden();
    const tool = useToolEditTarget();
    const placed = usePlacedEditTarget();
    // The open shape is waiting out of sight (#416): nothing here acts on it
    if (toolOpen && away) return null;
    // A kind armed with nothing drawn yet has no shape: the selection's own controls show
    const target = toolOpen ? tool : placed;
    if (!target && selected.length === 0) return null;
    return (
        <div className="flex flex-col gap-8" data-testid="transform-section">
            <h5 className="text-h5">Transform</h5>
            <div className="flex items-start gap-12">
                {target ? (
                    <PivotGrid
                        pivot={pivotOf(target.params)}
                        onPick={(key) =>
                            target.apply(withPivot(target.params, key))
                        }
                    />
                ) : (
                    <SelectionPivotGrid />
                )}
                {target ? (
                    <ShapeTransform target={target} />
                ) : (
                    <SelectionTransform count={selected.length} />
                )}
            </div>
        </div>
    );
}

const PIVOT_NAMES: Record<PivotKey, string> = {
    nw: "back left",
    n: "back",
    ne: "back right",
    w: "left",
    c: "center",
    e: "right",
    sw: "front left",
    s: "front",
    se: "front right",
};

/** A plain selection's pivot: the session's, as there is no shape to keep it */
function SelectionPivotGrid() {
    const pivot = useShapeEditorStore((s) => s.pivot);
    return <PivotGrid pivot={pivot} onPick={setShapePivot} />;
}

/**
 * What turns, flips and scales go around: a corner, an edge's middle or the center. A shape's
 * pivot dragged elsewhere on the field (#350) lights none of them.
 */
function PivotGrid({
    pivot,
    onPick,
}: {
    pivot: Pivot;
    onPick: (key: PivotKey) => void;
}) {
    return (
        <div
            role="radiogroup"
            aria-label="Pivot"
            className="rounded-4 border-stroke grid shrink-0 grid-cols-3 gap-2 border p-4"
            data-testid="transform-pivot"
        >
            {PIVOT_KEYS.map((key) => (
                <Tip
                    key={key}
                    label={`Turn, flip and scale around the ${PIVOT_NAMES[key]}`}
                >
                    <button
                        type="button"
                        role="radio"
                        aria-checked={key === pivot}
                        aria-label={`Pivot: ${PIVOT_NAMES[key]}`}
                        onPointerDown={keepFocus}
                        onClick={() => onPick(key)}
                        data-testid={`transform-pivot-${key}`}
                        className="flex size-16 items-center justify-center"
                    >
                        <span
                            className={clsx(
                                "block rounded-full",
                                key === pivot
                                    ? "bg-accent size-8"
                                    : "bg-text/30 hover:bg-accent/60 size-6",
                            )}
                        />
                    </button>
                </Tip>
            ))}
        </div>
    );
}

/** The env a change is worked out with, Alt being "don't snap" as on the field */
const envFor = (keys: { alt: boolean; shift: boolean }): ToolEnv | null => {
    const field = currentShapeField();
    return field ? toolEnvFor(field, keys) : null;
};

const PLAIN = { alt: false, shift: false };

/** A shape's rotation, flips and scale */
function ShapeTransform({ target }: { target: ShapeEditTarget }) {
    const { kind, params, spots } = target;
    // The shape's own (#350)
    const pivot = pivotOf(params);
    // The shape at the press of the rotation's drag
    const base = useRef<unknown>(params);
    const env = envFor(PLAIN);
    const degrees = rotationDegrees(kind.frameOf(params, spots).rotation);
    const apply = (change: (env: ToolEnv) => unknown) => {
        const env = envFor(PLAIN);
        const next = env && change(env);
        if (next != null) target.apply(next);
    };
    const less = env && scaleShape(kind, params, spots, -1, pivot, env);
    const more = env && scaleShape(kind, params, spots, 1, pivot, env);
    const scaleWord = kind.scaling === "interval" ? "spacing" : "size";

    return (
        <div className="flex min-w-0 flex-col gap-8" data-shape-editor>
            <Row label="Turn">
                <ScrubNumber
                    display={`${degrees}°`}
                    editText={String(degrees)}
                    axis="x"
                    label="Rotation, in degrees clockwise"
                    testId="transform-rotation"
                    onScrubStart={() => {
                        base.current = params;
                        target.begin();
                    }}
                    onScrub={(m: ScrubMove) => {
                        const env = envFor(m);
                        if (!env) return;
                        target.preview(
                            scrubTurn(
                                kind,
                                base.current,
                                spots,
                                scrubDistance("x", m.dx, m.dy),
                                pivot,
                                env,
                            ),
                        );
                    }}
                    onScrubEnd={(keep) => target.end(keep)}
                    onType={(text) => {
                        const typed = parseDegrees(text);
                        if (typed === null) return false;
                        apply((env) =>
                            turnShape(
                                kind,
                                params,
                                spots,
                                typed * DEGREE,
                                pivot,
                                env,
                            ),
                        );
                        return true;
                    }}
                />
            </Row>
            <Flips
                onFlip={(axis) =>
                    apply((env) =>
                        flipShape(kind, params, spots, axis, pivot, env),
                    )
                }
            />
            <Row label="Scale">
                <SmallButton
                    label={`Closer: ${scaleWord} half a step less`}
                    disabled={less == null}
                    onClick={() => less != null && target.apply(less)}
                    testId="transform-scale-less"
                >
                    <MinusIcon size={12} />
                </SmallButton>
                <span
                    className="text-sub tabular-nums"
                    data-testid="transform-scale"
                >
                    {env && (
                        <GlyphText
                            text={scaleReadout(kind, params, spots, env)}
                            size={12}
                        />
                    )}
                </span>
                <SmallButton
                    label={`Wider: ${scaleWord} half a step more`}
                    disabled={more == null}
                    onClick={() => more != null && target.apply(more)}
                    testId="transform-scale-more"
                >
                    <PlusIcon size={12} />
                </SmallButton>
            </Row>
        </div>
    );
}

/**
 * A plain selection's rotation and flips: positions only. The rotation turns the marchers on the
 * field as it's typed or dragged and saves when the input is left, as before (user story 54).
 */
function SelectionTransform({ count }: { count: number }) {
    const pivot = useShapeEditorStore((s) => s.pivot);
    const { mutate: update } = useUpdateSelectedMarchersOnSelectedPage();
    const around = (box: {
        left: number;
        top: number;
        right: number;
        bottom: number;
    }) =>
        selectionPivot(
            [
                { x: box.left, y: box.top },
                { x: box.right, y: box.bottom },
            ],
            pivot,
        )!;
    return (
        <div className="flex min-w-0 flex-1 flex-col gap-8">
            <MarcherRotationInput around={around} />
            <Flips
                disabled={count < 2}
                onFlip={(axis) =>
                    update(({ currentCoordinates }) =>
                        flipSelection(currentCoordinates, axis, pivot),
                    )
                }
            />
        </div>
    );
}

function Flips({
    onFlip,
    disabled,
}: {
    onFlip: (axis: FlipAxis) => void;
    disabled?: boolean;
}) {
    const button = clsx(
        getButtonClassName({ variant: "secondary", size: "compact" }),
        "flex items-center gap-4",
    );
    return (
        <div className="flex gap-4">
            <Tip label="Flip side to side around the pivot">
                <button
                    type="button"
                    className={button}
                    disabled={disabled}
                    onPointerDown={keepFocus}
                    onClick={() => onFlip("across")}
                    data-testid="transform-flip-across"
                >
                    <FlipHorizontalIcon size={14} />
                    <GlyphText text="Flip ↔" />
                </button>
            </Tip>
            <Tip label="Flip front to back around the pivot">
                <button
                    type="button"
                    className={button}
                    disabled={disabled}
                    onPointerDown={keepFocus}
                    onClick={() => onFlip("deep")}
                    data-testid="transform-flip-deep"
                >
                    <FlipVerticalIcon size={14} />
                    <GlyphText text="Flip ↕" />
                </button>
            </Tip>
        </div>
    );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="text-sub flex items-center gap-4">
            <span className="text-text/60 w-[5ch]">{label}</span>
            {children}
        </div>
    );
}

function SmallButton({
    label,
    onClick,
    disabled,
    testId,
    children,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    testId?: string;
    children: ReactNode;
}) {
    return (
        <Tip label={label}>
            <button
                type="button"
                aria-label={label}
                disabled={disabled}
                onPointerDown={keepFocus}
                onClick={onClick}
                data-testid={testId}
                className="rounded-4 hover:text-accent flex items-center p-2 disabled:opacity-40"
            >
                {children}
            </button>
        </Tip>
    );
}
