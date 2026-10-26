import clsx from "clsx";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { keepFocus } from "./keepFocus";
import { RichTips, Tip } from "./Tip";
import {
    FlipHorizontalIcon,
    FlipVerticalIcon,
    LinkSimpleIcon,
    MinusIcon,
    PlusIcon,
    ArrowClockwiseIcon,
    PathIcon,
    UserSwitchIcon,
} from "@phosphor-icons/react";
import { fieldToElement, useFieldViewStore } from "@/field/three/fieldView";
import { DEGREE, rotationDegrees } from "../frame/frame";
import { pivotOf } from "../frame/pivot";
import {
    flipShape,
    scrubTurn,
    shapeOutline,
    turnShape,
} from "../frame/gestures";
import { currentShapeField } from "../field/shapeFieldContext";
import {
    toggleRatioLock,
    useShapeEditorStore,
} from "../frame/shapeEditorStore";
import { toolEnvFor } from "../tool/toolEnv";
import type { AnyToolKind, ToolEnv } from "../tool/toolKind";
import { useShapeHidden, useShapeToolStore } from "../tool/shapeToolStore";
import { ShapeAwayChip } from "./ShapeAwayChip";
import { GlyphText } from "./GlyphText";
import { useShapePointerOver } from "../tool/shapeToolMode";
import "./ShapeEditorSurface.css";
import {
    chipLayout,
    quarterTurn,
    sizeRun,
    type ChipNumber,
    type SizeRun,
} from "./chip";
import {
    usePlacedEditTarget,
    useToolEditTarget,
    type ShapeEditTarget,
} from "./editTargets";
import { parseDegrees, scrubDistance } from "./scrub";
import { ScrubNumber, type ScrubMove } from "./ScrubNumber";
import { SaveShapeButton } from "../library/SaveShapeButton";
import { LayoutMenu } from "./LayoutPicker";
import { ReshuffleButton } from "./ReshuffleButton";
import { CloseUpButton } from "./CloseUpButton";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";

/** The gap between the shape's outline and the editor, in CSS px */
const GAP_PX = 14;

/**
 * The floating editor (08-shape-system-ux.md, "The floating editor"), the main place for editing
 * a shape: a small bar under the open shape, or the selected placed one, with the numbers people
 * change most. It moves with the shape and flips above it when there's no room below. Before a
 * shape is drawn, a hint at the top of the field says how to draw one.
 *
 * It fades with the pointer away from both the shape, open or placed (#430), and itself, so what's
 * under it shows, and it is solid while the pointer is over either, with focus inside it or a
 * menu of its open (`ShapeEditorSurface.css`). Its numbers are the kind's primary parameters (#344, `chipLayout`), so it works for any kind.
 * One row, no ⋯ (#429; owner: keep it compact), for a box:
 * `− 6 × 2 + │ ↔ 2 ↕ 2 steps 🔗 │ ↻ 0° ⇋ ⇵ Recalculate │ ⌇ ☆ │ Place`, and in Spread
 * `↔ 2 steps Reshuffle │ …`. Every number can be typed or dragged, and follows the field: across
 * is side to side however the box is turned. ↻ adds a quarter turn to the degrees beside it.
 * Recalculate works out who goes where again by least travel, which moving and turning keep until
 * it's pressed, and shows its word only when it would change something; Close up shows for a
 * placed shape with holes (#392). Pathways and ☆ Save, which leave the shape as it is, come last
 * before Place. Its
 * controls show the app's tooltips (`RichTips`). Under the editor, a box in Files has its layout
 * menu in a pill of its own (#387, #429). Place shows only for a new shape; a selected placed
 * shape saves each edit on release. While the open shape waits out of sight (#416) the editor
 * hides, and away from its moment a chip goes back to it.
 */
export function ShapeEditor({ stepPx }: { stepPx: number }) {
    const armed = useShapeToolStore((s) =>
        s.tool !== null && s.tool.params === null ? s.tool.kind : null,
    );
    const toolOpen = useShapeToolStore((s) => s.tool !== null);
    const hidden = useShapeHidden();
    const tool = useToolEditTarget();
    const placed = usePlacedEditTarget();
    if (hidden) return <ShapeAwayChip />;
    if (armed)
        return (
            <div
                className="rounded-6 border-stroke bg-bg-1 bg-modal text-body text-text shadow-modal pointer-events-none absolute top-12 left-1/2 z-10 -translate-x-1/2 border px-12 py-6"
                data-testid="shape-tool-hint"
            >
                Drag on the field to draw a {armed.shape.label.toLowerCase()} ·
                Esc to cancel
            </div>
        );
    const target = toolOpen ? tool : placed;
    if (!target) return null;
    return (
        <RichTips>
            <ShapeEditorBar
                target={target}
                stepPx={stepPx}
                testId={toolOpen ? "shape-tool-readout" : "placed-box-readout"}
            />
        </RichTips>
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
    const { kind, params, spots } = target;
    const ratioLocked = useShapeEditorStore((s) => s.ratioLocked);
    // The editor fades with the pointer away from it and the shape (#426, #430)
    const overShape = useShapePointerOver();
    // The shape's own pivot (#350), the same in Basic and Expert (spec #344)
    const pivot = pivotOf(params);
    const place = usePlacement(kind, params, spots);
    // The shape at the press of a number's drag
    const base = useRef<unknown>(params);

    // A run of − and + presses grows from where it began, so the shape doesn't creep (#387)
    const run = useRef<SizeRun | null>(null);
    const anchor = sizeRun(run.current, kind, params, spots);
    const env = envFor(PLAIN);
    const layout = env
        ? chipLayout(kind, params, spots, { ...env, stepPx, anchor })
        : { values: [], intervals: [], ratioLock: false };
    const degrees = rotationDegrees(kind.frameOf(params, spots).rotation);

    /** One change at once, worked out with no keys held */
    const apply = (change: (env: ToolEnv) => unknown) => {
        const env = envFor(PLAIN);
        if (env) target.apply(change(env));
    };
    /** A number's drag: the change from the shape at the press, previewed live */
    const scrub = (
        change: (b: unknown, m: ScrubMove, env: ToolEnv) => unknown,
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
    /** A declared number, typed or dragged */
    const number = ({ param, display }: ChipNumber) => (
        <ScrubNumber
            display={display}
            axis={param.drag}
            label={param.label}
            testId={`shape-editor-${param.key}`}
            {...scrub((b, m, env) => param.scrub(b, spots, m, env))}
            onType={(text) => {
                const env = envFor(PLAIN);
                const next = env && param.type(params, spots, text, env);
                if (next == null) return false;
                target.apply(next);
                return true;
            }}
        />
    );

    return (
        <div
            ref={place.ref}
            className="shape-editor-surface text-sub text-text pointer-events-none absolute z-10 flex flex-col items-center gap-4 whitespace-nowrap *:pointer-events-auto"
            style={place.style}
            data-over={overShape}
            {...place.hold}
            data-testid={testId}
            data-shape-editor
            data-placement={place.above ? "above" : "below"}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <div
                className="rounded-6 border-stroke bg-bg-1 bg-modal shadow-modal flex items-center gap-6 border px-6 py-4"
                data-testid={`${testId}-bar`}
            >
                <span
                    className="flex items-center gap-2"
                    data-testid={`${testId}-text`}
                >
                    {layout.values.map((x) => (
                        <span
                            key={x.param.key}
                            className="flex items-center gap-2"
                        >
                            {x.param.stepper && (
                                <IconButton
                                    label={x.param.stepper.less}
                                    disabled={x.less === null}
                                    onClick={() => {
                                        if (x.less === null) return;
                                        run.current = {
                                            params: x.less,
                                            anchor,
                                        };
                                        target.apply(x.less);
                                    }}
                                >
                                    <MinusIcon size={12} />
                                </IconButton>
                            )}
                            {number(x)}
                            {x.param.stepper && (
                                <IconButton
                                    label={x.param.stepper.more}
                                    disabled={x.more === null}
                                    onClick={() => {
                                        if (x.more === null) return;
                                        run.current = {
                                            params: x.more,
                                            anchor,
                                        };
                                        target.apply(x.more);
                                    }}
                                >
                                    <PlusIcon size={12} />
                                </IconButton>
                            )}
                            {x.note && (
                                <span className="text-text/60">· {x.note}</span>
                            )}
                        </span>
                    ))}
                    {target.empty > 0 && (
                        <span className="text-text/60">
                            · {target.empty} empty
                        </span>
                    )}
                </span>
                {layout.intervals.length > 0 && (
                    <>
                        <Divider />
                        <span className="flex items-center gap-2">
                            {layout.intervals.map((x) => (
                                <span
                                    key={x.param.key}
                                    className="flex items-center gap-2"
                                >
                                    {x.param.glyph && (
                                        <span
                                            className="text-text/60"
                                            aria-hidden
                                        >
                                            <GlyphText text={x.param.glyph} />
                                        </span>
                                    )}
                                    {number(x)}
                                </span>
                            ))}
                            <span className="text-text/60">steps</span>
                            {layout.ratioLock && (
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
                                    {/* One chain either way, lit in the accent when locked: a broken
                                        link didn't read as anything (owner) */}
                                    <LinkSimpleIcon size={14} />
                                </IconButton>
                            )}
                        </span>
                    </>
                )}
                <ReshuffleButton
                    target={target}
                    envFor={() => envFor(PLAIN)}
                    className="rounded-4 hover:text-accent hover:bg-fg-2 px-4 py-2"
                    testId="shape-editor-reshuffle"
                />
                {target.drawnOn && (
                    <span className="text-text/50">from {target.drawnOn}</span>
                )}
                <Divider />
                <span className="flex items-center gap-2">
                    {/* The turn: ↻ adds a quarter, and the degrees beside it can be typed or
                        dragged (owner) */}
                    <IconButton
                        label="Turn 90° clockwise"
                        onClick={() =>
                            apply((env) =>
                                quarterTurn(kind, params, spots, env),
                            )
                        }
                        testId="shape-editor-quarter-turn"
                    >
                        <ArrowClockwiseIcon size={14} />
                    </IconButton>
                    <ScrubNumber
                        display={`${degrees}°`}
                        editText={String(degrees)}
                        axis="x"
                        label="Turn, in degrees clockwise"
                        testId="shape-editor-rotation"
                        {...scrub((b, m, env) =>
                            scrubTurn(
                                kind,
                                b,
                                spots,
                                scrubDistance("x", m.dx, m.dy),
                                pivot,
                                env,
                            ),
                        )}
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
                    <IconButton
                        label="Flip side to side"
                        onClick={() =>
                            apply((env) =>
                                flipShape(
                                    kind,
                                    params,
                                    spots,
                                    "across",
                                    pivot,
                                    env,
                                ),
                            )
                        }
                        testId="shape-editor-flip-across"
                    >
                        <FlipHorizontalIcon size={14} />
                    </IconButton>
                    <IconButton
                        label="Flip front to back"
                        onClick={() =>
                            apply((env) =>
                                flipShape(
                                    kind,
                                    params,
                                    spots,
                                    "deep",
                                    pivot,
                                    env,
                                ),
                            )
                        }
                        testId="shape-editor-flip-deep"
                    >
                        <FlipVerticalIcon size={14} />
                    </IconButton>
                    <IconButton
                        label={
                            target.recalculate
                                ? "Recalculate who goes where: least travel from where everyone comes from"
                                : target.empty > 0
                                  ? "Recalculate who goes where: close up the empty spots first"
                                  : "Who goes where is already least travel"
                        }
                        disabled={!target.recalculate}
                        onClick={() => target.recalculate?.()}
                        testId="shape-editor-recalculate"
                    >
                        <UserSwitchIcon size={14} />
                        {/* The word only when it can do something: greyed out, it's the widest
                            thing on the bar for nothing (owner, review round r429) */}
                        {target.recalculate && "Recalculate"}
                    </IconButton>
                    <CloseUpButton
                        target={target}
                        compact
                        className="rounded-4 hover:text-accent flex min-h-24 min-w-24 items-center justify-center p-4"
                        testId="shape-editor-close-up"
                    />
                </span>
                {/* What doesn't change the shape itself, at the end (owner): its pathways and
                    saving it to the library */}
                <Divider />
                <span className="flex items-center gap-2">
                    {target.place && <PathwaysButton />}
                    <SaveShapeButton
                        shape={{ kind, params, spots }}
                        stepPx={stepPx}
                        compact
                        className="rounded-4 hover:text-accent flex min-h-24 min-w-24 items-center justify-center p-4"
                        testId="shape-editor-save"
                    />
                </span>
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
            {/* The layout settings: a pill of their own under the editor (owner). Only the bar and
                the pill take the pointer, not the empty space beside the pill */}
            <LayoutMenu
                target={target}
                envFor={() => envFor(PLAIN)}
                className="rounded-6 border-stroke bg-bg-1 bg-modal shadow-modal border px-6 py-2"
            />
        </div>
    );
}

/**
 * Where the editor sits: under the shape's outline, centered, and above it when there's no room
 * below in the field, kept inside the field side to side. Follows the field as it pans and zooms,
 * but holds still while the pointer is on it, so a button doesn't slide away between two clicks
 * as the numbers change (sims, F3: 5 of 8 clicked the wrong thing).
 */
function usePlacement(kind: AnyToolKind, params: unknown, spots: number) {
    const view = useFieldViewStore();
    const ref = useRef<HTMLDivElement>(null);
    const [room, setRoom] = useState({
        width: 0,
        height: 0,
        fieldWidth: Infinity,
        fieldHeight: Infinity,
    });
    const [held, setHeld] = useState<{ left: number; top: number } | null>(
        null,
    );
    const b = boundsOf(shapeOutline(kind, params, spots));
    const bottom = fieldToElement(view, (b.left + b.right) / 2, b.bottom);
    const top = fieldToElement(view, (b.left + b.right) / 2, b.top);
    // The outline's spots have a radius and the handles stick out: clear them
    const pad = GAP_PX + 6;
    // Its own size (the Save form opens) and the field's, as they change
    useLayoutEffect(() => {
        const el = ref.current;
        const field = el?.offsetParent;
        if (!el || !field) return;
        const measure = () =>
            setRoom({
                width: el.offsetWidth,
                height: el.offsetHeight,
                fieldWidth: field.clientWidth,
                fieldHeight: field.clientHeight,
            });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        observer.observe(field);
        return () => observer.disconnect();
    }, []);
    const above =
        bottom.y + pad + room.height > room.fieldHeight &&
        top.y - pad - room.height > 0;
    const anchor = above ? top : bottom;
    const margin = 4;
    const left = Math.max(
        margin,
        Math.min(
            anchor.x - room.width / 2,
            room.fieldWidth - room.width - margin,
        ),
    );
    const at = held ?? {
        left,
        top: above ? top.y - pad - room.height : bottom.y + pad,
    };
    return {
        ref,
        above,
        style: at,
        hold: {
            onPointerEnter: () => setHeld(at),
            onPointerLeave: () => setHeld(null),
        },
    };
}

/** The field-square rectangle around an outline */
function boundsOf(points: readonly { x: number; y: number }[]) {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
    };
}

function Divider() {
    return <span className="bg-stroke h-16 w-px" aria-hidden />;
}

/**
 * Pathways (#403): shows or hides the open shape's walks; its start rings always show (#417).
 * Off until asked for, so the shape reads clearly while it's drawn; the choice is remembered.
 */
function PathwaysButton() {
    const shown = useUiSettingsStore((s) => s.uiSettings.shapeWalks ?? false);
    return (
        <IconButton
            label={
                shown
                    ? "Hide the pathways from the start flag"
                    : "Show the pathways from the start flag"
            }
            pressed={shown}
            onClick={() => {
                const { uiSettings, setUiSettings } =
                    useUiSettingsStore.getState();
                setUiSettings({
                    ...uiSettings,
                    shapeWalks: !(uiSettings.shapeWalks ?? false),
                });
            }}
            testId="shape-editor-pathways"
        >
            <PathIcon size={14} />
        </IconButton>
    );
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
        <Tip label={label}>
            <button
                type="button"
                aria-label={label}
                aria-pressed={pressed}
                // aria-disabled, not disabled: a disabled button gets no pointer, so its tooltip
                // (which says why, as Recalculate's does) wouldn't show
                aria-disabled={disabled || undefined}
                onPointerDown={keepFocus}
                onClick={() => {
                    if (!disabled) onClick();
                }}
                data-testid={testId}
                className={clsx(
                    // At least 24 px to hit (WCAG 2.2 target size; review round r429)
                    "rounded-4 flex min-h-24 min-w-24 items-center justify-center gap-4 p-4",
                    // On: the icon in the accent on a light accent tint, so the state is plain at a
                    // glance without reading as a solid button (owner)
                    pressed ? "bg-accent/15 text-accent" : "hover:text-accent",
                    disabled && "cursor-default opacity-40 hover:text-inherit",
                )}
            >
                {children}
            </button>
        </Tip>
    );
}
