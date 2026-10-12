import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { T, useTolgee } from "@tolgee/react";
import {
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
import { useIsPlaying } from "@/context/IsPlayingContext";
import ActionButton from "@/shortcuts/ActionButton";
import { runAction } from "@/shortcuts/registry";
import type { OrderMode } from "../assign";
import {
    currentCanvas,
    marchersOnCanvas,
    shapeContextFor,
} from "../canvas/shapeCanvasContext";
import { LISTED_SHAPE_KINDS, pickerKindOf, shapeKind } from "../registry";
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
import { resolveShapeView, tightSpacing } from "../canvas/previewView";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import { blurSoon, ShapeViewSection } from "./ShapeViewSection";
import { GESTURES } from "../draw/gestures";
import { SHAPE_KIND_ACTIONS } from "../useShapeToolActions";
import { useRecipeForSelection } from "../useRecipeForSelection";
import type { StoredShapeRecipe } from "@/db-functions/shapeRecipes";
import type OpenMarchCanvas from "@/global/classes/canvasObjects/OpenMarchCanvas";
import type { FillParams } from "../kinds/fill";
import type { CircleParams } from "../kinds/circle";
import type { BlockParams } from "../kinds/block";
import {
    blockToFill,
    circleToFill,
    fillToBlock,
    fillToCircle,
} from "../draw/convert";

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
    const isPlaying = useIsPlaying()?.isPlaying ?? false;

    // Opening the tool brings its panel into view, wherever the inspector was scrolled
    useEffect(() => {
        if (isOpen) ref.current?.scrollIntoView({ block: "nearest" });
    }, [isOpen]);

    // Playback closes the tool, and the selection's shape is about where playback started
    if (isPlaying || (!session && selectedCount === 0)) return null;

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
                data-shape-ui
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
                        {/* The picker first, so it stays put when a placed shape adds Edit
                            (sims, round 12: clicks meant for the picker hit Edit) */}
                        <KindPicker activeKind={null} />
                        {recipe && <EditRecipe recipe={recipe} />}
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
            onValueChange={(kind) => {
                runAction(
                    SHAPE_KIND_ACTIONS[kind as keyof typeof SHAPE_KIND_ACTIONS],
                );
                blurSoon();
            }}
        >
            <SelectTriggerCompact
                label={t("inspector.shapeTool.pick")}
                className="min-w-[8rem] justify-start gap-6"
                data-testid="shape-kind-picker"
            />
            <SelectContent>
                {FAMILIES.map(({ family, label }) => {
                    const kinds = LISTED_SHAPE_KINDS.filter(
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
    const placeAsked = useShapeToolStore((s) => s.placeAsked);
    const shapeUi = useUiSettingsStore((s) => s.uiSettings.shapeUi ?? "draw");
    const edited = useShapeToolStore((s) => s.past.length > 0);
    const storedView = useUiSettingsStore((s) => s.uiSettings.shapePreview);
    const fieldLabels = useUiSettingsStore((s) => s.uiSettings.marcherLabels);
    const fieldLabelSize = useUiSettingsStore(
        (s) => s.uiSettings.marcherLabelSize,
    );
    const fieldLabelPosition = useUiSettingsStore(
        (s) => s.uiSettings.marcherLabelPosition,
    );
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

    const groups = kind.groups.filter(
        (g) => !g.visibleWhen || g.visibleWhen(params),
    );
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
                <KindPicker
                    activeKind={pickerKindOf(session.kindId, session.params)}
                />
                <div className="flex items-center gap-8">
                    <p
                        className="text-sub text-text/70 min-w-0 flex-1 truncate"
                        title={summary}
                        data-testid="shape-tool-summary"
                    >
                        {summary}
                    </p>
                    {/* The legend and view options sit low in the panel; a way there from the top
                        (sims, round 13: "I only found the legend by scrolling") */}
                    <button
                        type="button"
                        className="text-sub text-accent shrink-0 underline"
                        data-testid="shape-tool-to-legend"
                        onClick={() =>
                            document
                                .getElementById("shape-view")
                                ?.scrollIntoView({ block: "start" })
                        }
                    >
                        <T keyName="inspector.shapeTool.view.toLegend" />
                    </button>
                </div>
            </div>

            {shapeUi === "draw" && (
                <p
                    className="text-sub text-text/60"
                    data-testid="shape-tool-draw-hint"
                >
                    <T
                        keyName={
                            GESTURES[session.kindId] === "clicks"
                                ? "inspector.shapeTool.draw.hintClicks"
                                : "inspector.shapeTool.draw.hint"
                        }
                        params={{ kind: kind.label.toLowerCase() }}
                    />
                </p>
            )}

            {/* In the draw tool, Place and the size fields sit in the box beside the shape */}
            {shapeUi !== "draw" && (
                // Stays in view while the panel scrolls (sims, round 10: scrolled to the legend
                // and back, the click missed Place)
                <div className="bg-bg-1 sticky top-0 z-10 py-4">
                    <PlaceButtons
                        session={session}
                        canApply={preview.canApply}
                    />
                </div>
            )}

            {/* Place sits under the summary, above everything that grows or shrinks (sims, round 8:
                locking the interval moved it under the cursor); warnings below it */}
            {placeAsked === session && (
                <p
                    className="text-sub text-red"
                    data-testid="shape-tool-place-asked"
                >
                    <T keyName="inspector.shapeTool.placeAnyway" />
                </p>
            )}
            {preview.issues.length > 0 && (
                <ul
                    className="text-sub flex flex-col gap-2"
                    data-testid="shape-tool-issues"
                >
                    {preview.issues.map((issue) => (
                        // Pointing at a warning draws only its marchers' walks (sims, round 8:
                        // "4 pairs pass closer" among 31 other red walks)
                        <li
                            key={issue.message}
                            onMouseEnter={() =>
                                useShapeToolStore
                                    .getState()
                                    .setHighlight(issue.slots ?? null)
                            }
                            onMouseLeave={() =>
                                useShapeToolStore.getState().setHighlight(null)
                            }
                            className={
                                issue.level === "error"
                                    ? "text-red"
                                    : issue.level === "warning"
                                      ? "text-yellow"
                                      : "text-text/60"
                            }
                        >
                            {issue.message}
                            {/* The fix the warning names, as a button (sims, round 9) */}
                            {issue.mark === "collision" &&
                                session.order !== "nearest" && (
                                    <Button
                                        size="compact"
                                        variant="secondary"
                                        className="ml-6"
                                        data-testid="shape-tool-use-nearest"
                                        onClick={() =>
                                            useShapeToolStore
                                                .getState()
                                                .setOrder("nearest", false, ctx)
                                        }
                                    >
                                        <T keyName="inspector.shapeTool.useNearest" />
                                    </Button>
                                )}
                        </li>
                    ))}
                </ul>
            )}

            {shapeUi === "draw" ? (
                <p className="text-sub text-text/60">
                    <T keyName="inspector.shapeTool.draw.sizeInBox" />
                </p>
            ) : (
                <ShapeSizeFields session={session} ctx={ctx} />
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

            <ShapeViewSection
                resolved={resolveShapeView(storedView, {
                    count: n,
                    tight: tightSpacing(preview, ctx.stepPx),
                    edited,
                    fieldLabels,
                    fieldLabelSize,
                    fieldLabelPosition,
                })}
            />
        </>
    );
}

/** Place and Cancel, with the keys that do the same */
function PlaceButtons({
    session,
    canApply,
}: {
    session: ShapeSession;
    canApply: boolean;
}) {
    const inputError = useShapeToolStore((s) => s.inputError);
    const placeAsked = useShapeToolStore((s) => s.placeAsked);
    return (
        <div className="flex gap-8">
            <ActionButton action="applyShape">
                <Button
                    size="compact"
                    variant={placeAsked === session ? "red" : "primary"}
                    disabled={!canApply || inputError !== null}
                    data-testid="shape-tool-apply"
                >
                    <T
                        keyName={
                            placeAsked === session
                                ? "inspector.shapeTool.placeAnywayButton"
                                : "inspector.shapeTool.apply"
                        }
                    />
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
    );
}

/**
 * Outline or Filled for a circle; Grid, Staggered or Natural for a box (owner decisions,
 * 2026-10-11). Each switch keeps where the shape is and its size.
 */
function FillSwitch({
    session,
    ctx,
}: {
    session: ShapeSession;
    ctx: ShapeContext;
}) {
    const { t } = useTolgee();
    const n = session.marchers.length;
    const convert = (kindId: string, params: unknown) => {
        useShapeToolStore.getState().convert(kindId, params, ctx);
        blurSoon();
    };
    const fill =
        session.kindId === "fill" ? (session.params as FillParams) : null;
    const isCircle = session.kindId === "circle" || fill?.outline === "circle";
    const isBox = session.kindId === "block" || fill?.outline === "box";
    if (isCircle) {
        const value = fill ? "filled" : "outline";
        return (
            <Row label={<T keyName="inspector.shapeTool.fill.circle" />}>
                <ToggleGroup
                    type="single"
                    aria-label={t("inspector.shapeTool.fill.circle")}
                    className="h-[1.625rem]"
                    value={value}
                    onValueChange={(v) => {
                        if (!v || v === value) return;
                        if (v === "filled")
                            convert(
                                "fill",
                                circleToFill(session.params as CircleParams),
                            );
                        else convert("circle", fillToCircle(fill!));
                    }}
                >
                    <ToggleGroupItem
                        value="outline"
                        data-testid="shape-fill-outline"
                    >
                        <T keyName="inspector.shapeTool.fill.outline" />
                    </ToggleGroupItem>
                    <ToggleGroupItem
                        value="filled"
                        data-testid="shape-fill-filled"
                    >
                        <T keyName="inspector.shapeTool.fill.filled" />
                    </ToggleGroupItem>
                </ToggleGroup>
            </Row>
        );
    }
    if (isBox) {
        const block = fill ? null : (session.params as BlockParams);
        const value = fill
            ? "natural"
            : block!.pattern === "offset"
              ? "staggered"
              : "grid";
        return (
            <Row label={<T keyName="inspector.shapeTool.fill.box" />}>
                <ToggleGroup
                    type="single"
                    aria-label={t("inspector.shapeTool.fill.box")}
                    className="h-[1.625rem]"
                    value={value}
                    onValueChange={(v) => {
                        if (!v || v === value) return;
                        if (v === "natural")
                            convert("fill", blockToFill(block!, n, ctx.stepPx));
                        else {
                            const pattern =
                                v === "staggered" ? "offset" : "grid";
                            convert(
                                "block",
                                block
                                    ? { ...block, pattern }
                                    : fillToBlock(fill!, n, pattern),
                            );
                        }
                    }}
                >
                    <ToggleGroupItem value="grid" data-testid="shape-fill-grid">
                        <T keyName="inspector.shapeTool.fill.grid" />
                    </ToggleGroupItem>
                    <ToggleGroupItem
                        value="staggered"
                        data-testid="shape-fill-staggered"
                    >
                        <T keyName="inspector.shapeTool.fill.staggered" />
                    </ToggleGroupItem>
                    <ToggleGroupItem
                        value="natural"
                        data-testid="shape-fill-natural"
                    >
                        <T keyName="inspector.shapeTool.fill.natural" />
                    </ToggleGroupItem>
                </ToggleGroup>
            </Row>
        );
    }
    return null;
}

/** The kind's everyday settings (spacing, its basic fields) and its sizes */
function ShapeSizeFields({
    session,
    ctx,
}: {
    session: ShapeSession;
    ctx: ShapeContext;
}) {
    const kind = shapeKind(session.kindId)!;
    const preview = useMemo(() => previewSession(session, ctx), [session, ctx]);
    const n = session.marchers.length;
    const params = session.params as Record<string, unknown>;
    const setField = (key: string, value: unknown) =>
        useShapeToolStore
            .getState()
            .setParams({ ...params, [key]: value }, ctx);
    const [first, second] = preview.slots;
    const derivedInterval =
        kind.path && first && second
            ? Math.hypot(second.x - first.x, second.y - first.y)
            : undefined;
    const measures = measuresOf(kind).filter(
        (m) => !m.visibleWhen || m.visibleWhen(session.params),
    );
    const basic = kind.groups.filter(
        (g) => !g.advanced && (!g.visibleWhen || g.visibleWhen(params)),
    );
    return (
        <>
            <FillSwitch session={session} ctx={ctx} />
            {basic.map((group) => (
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
            ))}
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
        </>
    );
}

/**
 * The draw tool's box beside the shape (owner decisions, 2026-10-11): the everyday numbers and
 * Place, where your eyes are. The side panel keeps order, view options and the legend.
 */
export function ShapeFineTuneBox({
    canvas,
    isPlaying,
}: {
    canvas: OpenMarchCanvas | null;
    isPlaying: boolean;
}) {
    const session = useShapeToolStore((s) => s.session);
    // Out of the way while a stroke is drawn or points are clicked in
    const drawing = useShapeToolStore(
        (s) => s.drawing !== null || s.clicked !== null,
    );
    const shapeUi = useUiSettingsStore((s) => s.uiSettings.shapeUi ?? "draw");
    const ctx = useMemo(
        () => (canvas ? shapeContextFor(canvas) : null),
        // A new context when the session changes picks up zoom and snapping changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [canvas, session],
    );
    const preview = useMemo(
        () => (session && ctx ? previewSession(session, ctx) : null),
        [session, ctx],
    );
    // Placed again when the shape opens, changes kind or is drawn anew; not while it's tuned
    const strokes = useShapeToolStore((s) => s.strokes.length);
    const anchor = session
        ? `${session.kindId}|${strokes}|${session.marchers.map((m) => m.id).join(",")}`
        : "";
    const spot = useBoxSpot(canvas, preview?.slots ?? null, anchor);
    if (
        shapeUi !== "draw" ||
        isPlaying ||
        !session ||
        !ctx ||
        !preview ||
        !spot ||
        // Out of the way while a stroke is being drawn
        drawing
    )
        return null;
    const kind = shapeKind(session.kindId)!;
    const Icon = kind.icon;
    const warnings = preview.issues.filter((i) => i.level !== "info").length;
    return (
        <div
            className="rounded-6 border-stroke bg-modal shadow-modal backdrop-blur-32 text-body absolute z-20 flex w-[17rem] flex-col gap-8 border p-10"
            style={{ left: spot.left, top: spot.top }}
            data-testid="shape-fine-tune"
            data-shape-ui
            onPointerDown={(e) => e.stopPropagation()}
        >
            <div className="flex items-center gap-6">
                <Icon size={16} />
                <span className="text-text/80">{kind.label}</span>
                {warnings > 0 && (
                    <span
                        className="text-sub text-yellow ml-auto"
                        title={preview.issues.map((i) => i.message).join("\n")}
                    >
                        <T
                            keyName="inspector.shapeTool.draw.warnings"
                            params={{ count: warnings }}
                        />
                    </span>
                )}
            </div>
            <ShapeSizeFields session={session} ctx={ctx} />
            <PlaceButtons session={session} canApply={preview.canApply} />
        </div>
    );
}

/**
 * Where the box sits: beside the shape's spots, on whichever side has room. It's placed when the
 * shape opens or a stroke ends, then stays put while the shape is tuned, so it never slides under
 * the pointer (sims, draw round 1: a moving box took a click as Place).
 */
function useBoxSpot(
    canvas: OpenMarchCanvas | null,
    slots: readonly { x: number; y: number }[] | null,
    anchor: string,
): { left: number; top: number } | null {
    const [spot, setSpot] = useState<{ left: number; top: number } | null>(
        null,
    );
    const slotsRef = useRef(slots);
    slotsRef.current = slots;
    const hasSlots = slots !== null && slots.length > 0;
    useEffect(() => {
        const current = slotsRef.current;
        if (!canvas || !current || current.length === 0) {
            setSpot(null);
            return;
        }
        const v = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
        const xs = current.map((p) => p.x * v[0]! + v[4]!);
        const ys = current.map((p) => p.y * v[3]! + v[5]!);
        const right = Math.max(...xs);
        const left = Math.min(...xs);
        const width = canvas.getWidth();
        const height = canvas.getHeight();
        const boxLeft =
            right + BOX_GAP_PX + BOX_WIDTH_PX <= width
                ? right + BOX_GAP_PX
                : Math.max(8, left - BOX_GAP_PX - BOX_WIDTH_PX);
        const boxTop = Math.min(
            Math.max(8, Math.min(...ys) - 20),
            Math.max(8, height - BOX_HEIGHT_PX),
        );
        setSpot({ left: Math.round(boxLeft), top: Math.round(boxTop) });
    }, [canvas, anchor, hasSlots]);
    return spot;
}

/** The box's size and distance from the shape, in screen pixels, for placing it */
const BOX_WIDTH_PX = 272;
const BOX_HEIGHT_PX = 320;
const BOX_GAP_PX = 32;

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
                // Enter takes a typed value and Escape drops the edit, without also placing the
                // shape or closing the tool. Enter with nothing typed places, as it does
                // elsewhere (sims, round 12: Tab into a field, Enter, nothing happened)
                if (e.key === "Enter") {
                    e.preventDefault();
                    const typed = draft !== null && draft !== text;
                    commit();
                    e.currentTarget.blur();
                    if (!typed) runAction("applyShape");
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
                            const typed = draft !== null;
                            e.currentTarget.blur();
                            // Enter with nothing typed places (see NumberInput)
                            if (e.key === "Enter" && !typed)
                                runAction("applyShape");
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
            {/* Two lines for each state, so Place doesn't move when the interval locks */}
            <p
                className="text-sub text-text/60 min-h-[2lh]"
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
                    onValueChange={(v) => {
                        setOrder(v as OrderMode, session.reverse);
                        blurSoon();
                    }}
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
            </Row>
            {/* Two lines kept for every order's help, so Place doesn't move (sims, round 6) */}
            <p className="text-sub text-text/60 min-h-[2lh]">
                {t(current.help)}
            </p>
        </>
    );
}
