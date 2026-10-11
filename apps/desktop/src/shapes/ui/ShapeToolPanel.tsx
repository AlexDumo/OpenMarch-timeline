import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { T, useTolgee } from "@tolgee/react";
import {
    ArrowClockwiseIcon,
    ArrowsLeftRightIcon,
    LockSimpleIcon,
    LockSimpleOpenIcon,
} from "@phosphor-icons/react";
import {
    Button,
    Input,
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTriggerCompact,
    ToggleGroup,
    ToggleGroupItem,
} from "@openmarch/ui";
import { InspectorCollapsible } from "@/components/inspector/InspectorCollapsible";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import ActionButton from "@/shortcuts/ActionButton";
import { runAction } from "@/shortcuts/registry";
import type { OrderMode } from "../assign";
import {
    currentCanvas,
    marchersOnCanvas,
    shapeContextFor,
} from "../canvas/shapeCanvasContext";
import { SHAPE_KINDS, shapeKind } from "../registry";
import { previewSession, type ShapeSession } from "../session";
import { useShapeToolStore } from "../shapeToolStore";
import { describeGaps, formatIntervals, parseIntervals } from "../spacing";
import {
    followsInterval,
    lockInterval,
    setSizeLock,
    sizeIsLocked,
    unlockInterval,
    type AnyShapeKind,
    type IntervalRun,
    type Measure,
    type ParamField,
    type ShapeContext,
    type Spacing,
} from "../types";
import { measuresOf } from "../follow";
import { SHAPE_KIND_ACTIONS } from "../useShapeToolActions";
import { useRecipeForSelection } from "../useRecipeForSelection";
import type { StoredShapeRecipe } from "@/db-functions/shapeRecipes";

const FAMILIES: { family: AnyShapeKind["family"]; label: string }[] = [
    { family: "path", label: "Paths" },
    { family: "fill", label: "Fills" },
];

/**
 * The shape tool's one home in the inspector. With marchers selected it offers the shape kinds;
 * once a kind is picked it shows that kind's sizes and settings, generated from what the kind
 * declares, then the shared Order row and Place / Cancel. Every kind looks and behaves the same
 * here; a new kind adds no UI of its own.
 */
export default function ShapeToolPanel() {
    const session = useShapeToolStore((s) => s.session);
    const selectedCount = useSelectedMarchers()?.selectedMarchers.length ?? 0;
    const recipe = useRecipeForSelection();
    const ref = useRef<HTMLDivElement>(null);
    const isOpen = session !== null;

    // Opening the tool brings its panel into view, wherever the inspector was scrolled
    useEffect(() => {
        if (isOpen) ref.current?.scrollIntoView({ block: "nearest" });
    }, [isOpen]);

    if (!session && selectedCount === 0) return null;

    return (
        <InspectorCollapsible
            defaultOpen
            translatableTitle={{
                keyName: "inspector.shapeTool.title",
                parameters: {},
            }}
        >
            <div
                ref={ref}
                className="flex flex-col gap-12"
                data-testid="shape-tool-panel"
                onKeyDown={(e) => {
                    // Enter places the shape from a closed menu in the panel too (Tab out of a
                    // field lands on one), instead of opening it
                    const target = e.target as HTMLElement;
                    if (
                        session &&
                        e.key === "Enter" &&
                        target.getAttribute("role") === "combobox" &&
                        target.getAttribute("aria-expanded") !== "true"
                    ) {
                        e.preventDefault();
                        e.stopPropagation();
                        runAction("applyShape");
                    }
                }}
            >
                {session ? (
                    <SessionControls session={session} />
                ) : (
                    <>
                        {recipe && <EditRecipe recipe={recipe} />}
                        <KindPicker activeKind={null} />
                        <p className="text-sub text-text/60">
                            <T
                                keyName={
                                    recipe
                                        ? "inspector.shapeTool.hintPlaced"
                                        : "inspector.shapeTool.hint"
                                }
                            />
                        </p>
                    </>
                )}
            </div>
        </InspectorCollapsible>
    );
}

/**
 * The selection is one placed shape: offer to reopen it, saying how many of its marchers have
 * been moved by hand since (they keep their offsets unless the designer resets them).
 */
function EditRecipe({ recipe }: { recipe: StoredShapeRecipe }) {
    const kind = shapeKind(recipe.kind)!;
    const Icon = kind.icon;
    const open = () => {
        const canvas = currentCanvas();
        if (!canvas) return;
        useShapeToolStore.getState().openRecipe(
            recipe,
            marchersOnCanvas(
                canvas,
                recipe.members.map((m) => m.marcherId),
            ),
        );
    };
    return (
        <Button
            size="compact"
            variant="secondary"
            className="justify-start gap-6"
            onClick={open}
            data-testid="shape-edit-recipe"
        >
            <Icon size={16} />
            <T
                keyName="inspector.shapeTool.editPlaced"
                params={{ kind: kind.label }}
            />
        </Button>
    );
}

function KindPicker({ activeKind }: { activeKind: string | null }) {
    const { t } = useTolgee();
    return (
        <Select
            value={activeKind ?? ""}
            onValueChange={(kind) =>
                runAction(
                    SHAPE_KIND_ACTIONS[kind as keyof typeof SHAPE_KIND_ACTIONS],
                )
            }
        >
            <SelectTriggerCompact
                label={t("inspector.shapeTool.pick")}
                className="min-w-[8rem] justify-start gap-6"
                data-testid="shape-kind-picker"
            />
            <SelectContent>
                {FAMILIES.map(({ family, label }) => {
                    const kinds = SHAPE_KINDS.filter(
                        (k) => k.family === family,
                    );
                    if (kinds.length === 0) return null;
                    return (
                        <SelectGroup key={family}>
                            <SelectLabel>{label}</SelectLabel>
                            {kinds.map((kind) => {
                                const Icon = kind.icon;
                                return (
                                    <SelectItem
                                        key={kind.id}
                                        value={kind.id}
                                        data-testid={`shape-kind-${kind.id}`}
                                    >
                                        <span className="flex items-center gap-6">
                                            <Icon size={16} />
                                            <T
                                                keyName={`shapes.kinds.${kind.id}`}
                                                defaultValue={kind.label}
                                            />
                                        </span>
                                    </SelectItem>
                                );
                            })}
                        </SelectGroup>
                    );
                })}
            </SelectContent>
        </Select>
    );
}

function useShapeContext(): ShapeContext | null {
    const canvas = currentCanvas();
    return canvas ? shapeContextFor(canvas) : null;
}

function SessionControls({ session }: { session: ShapeSession }) {
    const ctx = useShapeContext();
    const kind = shapeKind(session.kindId)!;
    const inputError = useShapeToolStore((s) => s.inputError);
    const [showMore, setShowMore] = useState(false);
    const preview = useMemo(
        () => (ctx ? previewSession(session, ctx) : null),
        [session, ctx],
    );
    if (!ctx || !preview) return null;

    const n = session.marchers.length;
    const overrideCount = Object.keys(session.overrides ?? {}).length;
    const params = session.params as Record<string, unknown>;
    const setField = (key: string, value: unknown) =>
        useShapeToolStore
            .getState()
            .setParams({ ...params, [key]: value }, ctx);
    // The interval the shape gives in Fit, shown gray beside the Interval lock: straight between
    // neighbors, as drill measures it
    const [first, second] = preview.slots;
    const derivedInterval =
        kind.path && first && second
            ? Math.hypot(second.x - first.x, second.y - first.y)
            : undefined;

    const measures = measuresOf(kind).filter(
        (m) => !m.visibleWhen || m.visibleWhen(session.params),
    );
    const groups = kind.groups.filter(
        (g) => !g.visibleWhen || g.visibleWhen(params),
    );
    const basic = groups.filter((g) => !g.advanced);
    const advanced = groups.filter((g) => g.advanced);
    const summary = [
        `${n} ${n === 1 ? "marcher" : "marchers"}`,
        ...preview.readouts.map((r) => `${r.label.toLowerCase()} ${r.value}`),
    ].join(" · ");

    const renderGroup = (group: (typeof groups)[number]) => (
        <Section key={group.label} label={group.label}>
            {group.fields.map((field) => (
                <FieldControl
                    key={field.key}
                    field={field}
                    value={params[field.key]}
                    onChange={(v) => setField(field.key, v)}
                    n={n}
                    ctx={ctx}
                    derivedInterval={derivedInterval}
                    closed={kind.path?.(session.params).closed === true}
                />
            ))}
        </Section>
    );

    return (
        <>
            <div className="flex flex-col gap-4">
                <KindPicker activeKind={session.kindId} />
                <p
                    className="text-sub text-text/70"
                    data-testid="shape-tool-summary"
                >
                    {summary}
                </p>
            </div>

            {basic.map(renderGroup)}
            {measures.length > 0 && (
                <Section label="Size">
                    {measures.map((measure) => (
                        <MeasureField
                            key={measure.key}
                            measure={measure}
                            session={session}
                            ctx={ctx}
                            keepsPath={kind.keepsPath === true}
                        />
                    ))}
                </Section>
            )}

            {advanced.length > 0 && (
                <button
                    type="button"
                    className="text-sub text-text/70 self-start underline"
                    onClick={() => setShowMore(!showMore)}
                >
                    <T keyName="inspector.shapeTool.more" />
                </button>
            )}
            {showMore && advanced.map(renderGroup)}

            <OrderRow session={session} ctx={ctx} />

            {overrideCount > 0 && (
                <Row
                    label={
                        <T
                            keyName="inspector.shapeTool.movedByHand"
                            params={{ count: overrideCount }}
                        />
                    }
                >
                    <ToggleGroup
                        type="single"
                        aria-label="Moved by hand"
                        className="h-[1.625rem]"
                        value={
                            session.keepOverrides === false ? "reset" : "keep"
                        }
                        onValueChange={(v) =>
                            v &&
                            useShapeToolStore
                                .getState()
                                .setKeepOverrides(v === "keep")
                        }
                    >
                        <ToggleGroupItem
                            value="keep"
                            data-testid="shape-overrides-keep"
                        >
                            <T keyName="inspector.shapeTool.overridesKeep" />
                        </ToggleGroupItem>
                        <ToggleGroupItem
                            value="reset"
                            data-testid="shape-overrides-reset"
                        >
                            <T keyName="inspector.shapeTool.overridesReset" />
                        </ToggleGroupItem>
                    </ToggleGroup>
                </Row>
            )}

            <div className="flex gap-8">
                <ActionButton action="applyShape">
                    <Button
                        size="compact"
                        disabled={!preview.canApply || inputError !== null}
                        data-testid="shape-tool-apply"
                    >
                        <T keyName="inspector.shapeTool.apply" />
                        <Kbd>Enter</Kbd>
                    </Button>
                </ActionButton>
                <ActionButton action="cancelAlignmentUpdates">
                    <Button
                        size="compact"
                        variant="secondary"
                        data-testid="shape-tool-cancel"
                    >
                        <T keyName="inspector.shapeTool.cancel" />
                        <Kbd>Esc</Kbd>
                    </Button>
                </ActionButton>
            </div>

            {/* Below Place, so a warning appearing doesn't move the button */}
            {preview.issues.length > 0 && (
                <ul
                    className="text-sub flex flex-col gap-2"
                    data-testid="shape-tool-issues"
                >
                    {preview.issues.map((issue) => (
                        <li
                            key={issue.message}
                            className={
                                issue.level === "error"
                                    ? "text-red"
                                    : issue.level === "warning"
                                      ? "text-yellow"
                                      : "text-text/60"
                            }
                        >
                            {issue.message}
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}

function Kbd({ children }: { children: ReactNode }) {
    return <kbd className="text-sub ml-6 font-mono opacity-70">{children}</kbd>;
}

/** A titled group of label-left, control-right rows, like the rest of the inspector */
function Section({ label, children }: { label: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-6">
            <h4 className="text-body text-text/80">{label}</h4>
            {children}
        </section>
    );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
    return (
        <div className="text-body flex min-h-[1.625rem] items-center justify-between gap-8">
            <span className="text-text/70 shrink-0">{label}</span>
            <span className="flex min-w-0 items-center justify-end gap-4">
                {children}
            </span>
        </div>
    );
}

const RAD_TO_DEG = 180 / Math.PI;

function MeasureField<P>({
    measure,
    session,
    ctx,
    keepsPath,
}: {
    measure: Measure<P>;
    session: ShapeSession;
    ctx: ShapeContext;
    keepsPath: boolean;
}) {
    const n = session.marchers.length;
    const raw = measure.get(session.params as P, n, ctx);
    const isLength = measure.unit === "length";
    const shown = isLength ? raw / ctx.stepPx : raw * RAD_TO_DEG;
    // The size lock, shown whenever the shape has spacing. Open with the interval locked, the
    // size follows the interval (worked out, gray); closed, the run is laid on the shape as
    // sized. In Fit it decides what locking the interval will do. A shape that keeps its drawn
    // path has it closed for good.
    const spacing = (session.params as { spacing?: Spacing }).spacing;
    // A shape that keeps its drawn path has no size lock: its size is always yours
    const hasLock =
        measure.size === true && spacing !== undefined && !keepsPath;
    const sizeLocked =
        keepsPath || (spacing !== undefined && sizeIsLocked(spacing));
    const derived =
        hasLock && spacing !== undefined && followsInterval(spacing);
    return (
        <Row label={measure.label}>
            <NumberInput
                value={shown}
                step={isLength ? 0.25 : 1}
                min={measure.min}
                derived={derived}
                testId={`shape-measure-${measure.key}`}
                onCommit={(v) =>
                    useShapeToolStore
                        .getState()
                        .setMeasure(
                            measure.key,
                            isLength ? v * ctx.stepPx : v / RAD_TO_DEG,
                            ctx,
                        )
                }
            />
            <span className="text-sub text-text/60 w-[2.5rem]">
                {isLength ? "steps" : "°"}
            </span>
            {hasLock && spacing && (
                <LockButton
                    locked={sizeLocked}
                    disabled={keepsPath}
                    testId={`shape-lock-${measure.key}`}
                    lockedHelp={
                        keepsPath
                            ? "inspector.shapeTool.sizeKeepsPath"
                            : "inspector.shapeTool.sizeLocked"
                    }
                    unlockedHelp="inspector.shapeTool.sizeFollows"
                    onToggle={() =>
                        useShapeToolStore.getState().setParams(
                            {
                                ...(session.params as object),
                                spacing: setSizeLock(spacing, !sizeLocked),
                            },
                            ctx,
                        )
                    }
                />
            )}
        </Row>
    );
}

/** A padlock: closed when the value is set by you, open when the tool works it out */
function LockButton({
    locked,
    disabled,
    testId,
    lockedHelp,
    unlockedHelp,
    onToggle,
}: {
    locked: boolean;
    disabled?: boolean;
    testId: string;
    lockedHelp: string;
    unlockedHelp: string;
    onToggle: () => void;
}) {
    const { t } = useTolgee();
    const help = t(locked ? lockedHelp : unlockedHelp);
    return (
        <Button
            size="compact"
            variant={locked ? "primary" : "secondary"}
            content="icon"
            aria-pressed={locked}
            aria-label={help}
            title={help}
            disabled={disabled}
            onClick={onToggle}
            data-testid={testId}
        >
            {locked ? (
                <LockSimpleIcon size={14} />
            ) : (
                <LockSimpleOpenIcon size={14} />
            )}
        </Button>
    );
}

/**
 * A number typed freely and taken on Enter or when focus leaves, so typing "17" doesn't reshape
 * the field at "1". Shows the value rounded to the input's step while not being edited.
 */
function NumberInput({
    value,
    step,
    min,
    integer,
    derived,
    testId,
    onCommit,
}: {
    value: number;
    step: number;
    min?: number;
    integer?: boolean;
    /** Worked out by the tool: gray, with "=", until you type over it */
    derived?: boolean;
    testId?: string;
    onCommit: (value: number) => void;
}) {
    // A worked-out value shows its true size (to the hundredth), not one rounded to the step
    // The true value to the hundredth, not rounded to the input's step (2.61, not 2.5)
    const rounded = integer ? Math.round(value) : Math.round(value * 100) / 100;
    const text = String(Number(rounded.toFixed(4)));
    const [draft, setDraft] = useState<string | null>(null);
    const commit = () => {
        // Focusing a value and leaving it as it was changes nothing (so it doesn't round it)
        if (draft === null || draft === text) {
            setDraft(null);
            return;
        }
        const v = Number(draft);
        setDraft(null);
        if (draft.trim() === "" || !Number.isFinite(v)) return;
        if (min !== undefined && v < min) return;
        onCommit(integer ? Math.round(v) : v);
    };
    return (
        <Input
            compact
            className={`w-[5rem] text-right ${derived && draft === null ? "text-text/50" : ""}`}
            inputMode="decimal"
            value={draft ?? (derived ? `= ${text}` : text)}
            data-testid={testId}
            onFocus={(e) => {
                if (derived) setDraft(text);
                e.currentTarget.select();
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                // Enter takes the value and Escape drops the edit, without also placing the
                // shape or closing the tool (the app's Enter and Escape shortcuts)
                if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                    e.currentTarget.blur();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    setDraft(null);
                    e.currentTarget.blur();
                }
            }}
        />
    );
}

function FieldControl({
    field,
    value,
    onChange,
    n,
    ctx,
    derivedInterval,
    closed,
}: {
    field: ParamField;
    value: unknown;
    onChange: (value: unknown) => void;
    n: number;
    ctx: ShapeContext;
    /** Field units; the interval the drawn shape gives in Fit */
    derivedInterval?: number;
    closed?: boolean;
}) {
    switch (field.type) {
        case "spacing":
            return (
                <SpacingControl
                    spacing={value as Spacing}
                    onChange={onChange}
                    n={n}
                    ctx={ctx}
                    derivedInterval={derivedInterval}
                    closed={closed}
                />
            );
        case "length":
            return (
                <Row label={field.label}>
                    <NumberInput
                        value={(value as number) / ctx.stepPx}
                        step={0.25}
                        min={field.min}
                        onCommit={(steps) => onChange(steps * ctx.stepPx)}
                    />
                    <span className="text-sub text-text/60 w-[2.5rem]">
                        steps
                    </span>
                </Row>
            );
        case "count":
            return (
                <Row label={field.label}>
                    <NumberInput
                        value={value as number}
                        step={1}
                        integer
                        min={field.min}
                        onCommit={onChange}
                    />
                    <span className="w-[2.5rem]" />
                </Row>
            );
        case "angle":
            return (
                <Row label={field.label}>
                    <NumberInput
                        value={(value as number) * RAD_TO_DEG}
                        step={1}
                        onCommit={(deg) => onChange(deg / RAD_TO_DEG)}
                    />
                    <span className="text-sub text-text/60 w-[2.5rem]">°</span>
                </Row>
            );
        case "enum":
            return (
                <Row label={field.label}>
                    <ToggleGroup
                        type="single"
                        aria-label={field.label}
                        className="h-[1.625rem]"
                        value={value as string}
                        onValueChange={(v) => v && onChange(v)}
                    >
                        {field.options.map((o) => (
                            <ToggleGroupItem key={o.value} value={o.value}>
                                {o.label}
                            </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                </Row>
            );
        case "lock":
            return (
                <Row label={field.label}>
                    <LockButton
                        locked={value === true}
                        testId={`shape-lock-${field.key}`}
                        lockedHelp={field.lockedHelp}
                        unlockedHelp={field.unlockedHelp}
                        onToggle={() => onChange(value !== true)}
                    />
                </Row>
            );
        case "bool":
            return (
                <Row label={field.label}>
                    <input
                        type="checkbox"
                        checked={value as boolean}
                        onChange={(e) => onChange(e.target.checked)}
                    />
                </Row>
            );
    }
}

/**
 * Spacing, shared by every path kind: the Interval and its lock.
 *
 * - Unlocked (Fit): the marchers spread over the shape as drawn; the interval shows gray, worked
 *   out from the shape.
 * - Locked: the typed interval (one value, a list of gaps or `steps x gaps` runs) is kept. The
 *   shape's size follows it unless the size is locked too (its lock is in the Size section), in
 *   which case the run is laid on the shape from Start, Center or End.
 *
 * Typing an interval locks it, as in Pyware.
 */
function SpacingControl({
    spacing,
    onChange,
    n,
    ctx,
    derivedInterval,
    closed,
}: {
    spacing: Spacing;
    onChange: (spacing: Spacing) => void;
    n: number;
    ctx: ShapeContext;
    derivedInterval?: number;
    /** A closed shape (a circle) keeps its center when it resizes, so "Keep fixed" has no say */
    closed?: boolean;
}) {
    const { t } = useTolgee();
    const locked = spacing.mode === "interval";
    const [draft, setDraft] = useState<string | null>(null);
    const lockedText = locked ? formatIntervals(spacing.runs) : "";
    const derivedSteps =
        derivedInterval !== undefined
            ? Math.round((derivedInterval / ctx.stepPx) * 100) / 100
            : 2;
    const text = draft ?? (locked ? lockedText : `= ${derivedSteps}`);
    const parsed = draft !== null ? parseIntervals(draft) : null;
    const setInputError = useShapeToolStore((s) => s.setInputError);

    // Place waits while the typed interval doesn't parse
    const error = parsed && !parsed.ok ? parsed.message : null;
    useEffect(() => {
        setInputError(error);
        return () => setInputError(null);
    }, [error, setInputError]);

    const lockAt = (runs: readonly IntervalRun[]) =>
        onChange(lockInterval(spacing, runs));
    const note = locked ? describeGaps(spacing.runs, n) : undefined;
    const follows = followsInterval(spacing);

    return (
        <>
            <Row label={<T keyName="inspector.shapeTool.gaps" />}>
                <Input
                    compact
                    className={`w-[8rem] font-mono ${locked || draft !== null ? "" : "text-text/50"}`}
                    aria-label="Interval in steps"
                    title={t("inspector.shapeTool.intervalHelp")}
                    placeholder={t("inspector.shapeTool.intervalPlaceholder")}
                    value={text}
                    data-testid="shape-interval-input"
                    onFocus={(e) => {
                        if (!locked) setDraft(String(derivedSteps));
                        e.currentTarget.select();
                    }}
                    onChange={(e) => {
                        setDraft(e.target.value);
                        const p = parseIntervals(e.target.value);
                        if (p.ok) lockAt(p.runs);
                    }}
                    onBlur={() => setDraft(null)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "Escape") {
                            e.preventDefault();
                            e.currentTarget.blur();
                        }
                    }}
                />
                <span className="text-sub text-text/60 w-[2.5rem]">steps</span>
                <LockButton
                    locked={locked}
                    testId="shape-lock-interval"
                    lockedHelp="inspector.shapeTool.intervalLocked"
                    unlockedHelp="inspector.shapeTool.intervalFits"
                    onToggle={() => {
                        setDraft(null);
                        if (locked) onChange(unlockInterval(spacing));
                        else lockAt([{ steps: derivedSteps, count: 0 }]);
                    }}
                />
            </Row>
            <p
                className="text-sub text-text/60"
                data-testid="shape-spacing-state"
            >
                <T
                    keyName={
                        !locked
                            ? "inspector.shapeTool.stateFit"
                            : follows
                              ? "inspector.shapeTool.stateFollow"
                              : "inspector.shapeTool.stateKeep"
                    }
                />
            </p>
            {error && (
                <p
                    className="text-sub text-red"
                    data-testid="shape-interval-error"
                >
                    {error}
                </p>
            )}
            {note && (
                <p
                    className="text-sub text-yellow"
                    data-testid="shape-interval-note"
                >
                    {note}
                </p>
            )}
            {locked && !(follows && closed) && (
                <Row
                    label={
                        <T
                            keyName={
                                follows
                                    ? "inspector.shapeTool.anchorKeep"
                                    : "inspector.shapeTool.anchor"
                            }
                        />
                    }
                >
                    <ToggleGroup
                        type="single"
                        aria-label="Anchor"
                        className="h-[1.625rem]"
                        value={spacing.anchor}
                        onValueChange={(anchor) =>
                            anchor &&
                            onChange({
                                ...spacing,
                                anchor: anchor as "start" | "center" | "end",
                            })
                        }
                    >
                        <ToggleGroupItem value="start">
                            <T keyName="inspector.shapeTool.anchorStart" />
                        </ToggleGroupItem>
                        <ToggleGroupItem value="center">
                            <T keyName="inspector.shapeTool.anchorCenter" />
                        </ToggleGroupItem>
                        <ToggleGroupItem value="end">
                            <T keyName="inspector.shapeTool.anchorEnd" />
                        </ToggleGroupItem>
                    </ToggleGroup>
                </Row>
            )}
        </>
    );
}

const ORDERS: { value: OrderMode; key: string; help: string }[] = [
    {
        value: "keep",
        key: "inspector.shapeTool.orderKeep",
        help: "inspector.shapeTool.orderKeepHelp",
    },
    {
        value: "nearest",
        key: "inspector.shapeTool.orderNearest",
        help: "inspector.shapeTool.orderNearestHelp",
    },
    {
        value: "drill",
        key: "inspector.shapeTool.orderDrill",
        help: "inspector.shapeTool.orderDrillHelp",
    },
];

function OrderRow({
    session,
    ctx,
}: {
    session: ShapeSession;
    ctx: ShapeContext;
}) {
    const { t } = useTolgee();
    const setOrder = (order: OrderMode, reverse: boolean) =>
        useShapeToolStore.getState().setOrder(order, reverse, ctx);
    const current = ORDERS.find((o) => o.value === session.order)!;
    return (
        <>
            <Row label={<T keyName="inspector.shapeTool.order" />}>
                <Select
                    value={session.order}
                    onValueChange={(v) =>
                        setOrder(v as OrderMode, session.reverse)
                    }
                >
                    <SelectTriggerCompact
                        label={t("inspector.shapeTool.order")}
                        data-testid="shape-order"
                    />
                    <SelectContent>
                        {ORDERS.map((o) => (
                            <SelectItem
                                key={o.value}
                                value={o.value}
                                data-testid={`shape-order-${o.value}`}
                            >
                                {t(o.key)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {session.order !== "nearest" && (
                    <Button
                        size="compact"
                        variant={session.reverse ? "primary" : "secondary"}
                        content="icon"
                        aria-pressed={session.reverse}
                        aria-label={t("inspector.shapeTool.reverse")}
                        title={t("inspector.shapeTool.reverse")}
                        onClick={() =>
                            setOrder(session.order, !session.reverse)
                        }
                        data-testid="shape-order-reverse"
                    >
                        <ArrowsLeftRightIcon size={16} />
                    </Button>
                )}
                <Button
                    size="compact"
                    variant="secondary"
                    content="icon"
                    aria-label={t("inspector.shapeTool.reassign")}
                    title={t("inspector.shapeTool.reassignHelp")}
                    onClick={() => useShapeToolStore.getState().reassign(ctx)}
                    data-testid="shape-order-reassign"
                >
                    <ArrowClockwiseIcon size={16} />
                </Button>
            </Row>
            <p className="text-sub text-text/60">{t(current.help)}</p>
        </>
    );
}
