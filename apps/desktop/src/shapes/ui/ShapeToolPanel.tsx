import { useMemo, useState } from "react";
import { T, useTolgee } from "@tolgee/react";
import { ArrowsDownUpIcon } from "@phosphor-icons/react";
import { Button, Input, ToggleGroup, ToggleGroupItem } from "@openmarch/ui";
import { InspectorCollapsible } from "@/components/inspector/InspectorCollapsible";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import ActionButton from "@/shortcuts/ActionButton";
import type { OrderMode } from "../assign";
import { currentCanvas, shapeContextFor } from "../canvas/shapeCanvasContext";
import { SHAPE_KINDS, shapeKind } from "../registry";
import { previewSession, type ShapeSession } from "../session";
import { useShapeToolStore } from "../shapeToolStore";
import { formatIntervals, parseIntervals } from "../spacing";
import type { AnyShapeKind, ParamField, ShapeContext, Spacing } from "../types";
import { SHAPE_KIND_ACTIONS } from "../useShapeToolActions";

/**
 * The shape tool's one home in the inspector. With marchers selected it offers the shape kinds;
 * once a kind is picked it shows that kind's settings, generated from its declared fields, plus
 * the shared Order section and Place / Cancel. Every kind looks and behaves the same here; a new
 * kind adds no UI of its own.
 */
export default function ShapeToolPanel() {
    const session = useShapeToolStore((s) => s.session);
    const selectedCount = useSelectedMarchers()?.selectedMarchers.length ?? 0;
    if (!session && selectedCount === 0) return null;

    return (
        <InspectorCollapsible
            defaultOpen
            translatableTitle={{
                keyName: "inspector.shapeTool.title",
                parameters: {},
            }}
            className="mt-12"
        >
            <div
                className="flex flex-col gap-12"
                data-testid="shape-tool-panel"
            >
                <KindPicker activeKind={session?.kindId ?? null} />
                {session ? (
                    <SessionControls session={session} />
                ) : (
                    <p className="text-sub text-text/60">
                        <T keyName="inspector.shapeTool.hint" />
                    </p>
                )}
            </div>
        </InspectorCollapsible>
    );
}

function kindAction(kind: AnyShapeKind) {
    return SHAPE_KIND_ACTIONS[kind.id as keyof typeof SHAPE_KIND_ACTIONS];
}

function KindPicker({ activeKind }: { activeKind: string | null }) {
    return (
        <div className="flex flex-wrap gap-6" role="group" aria-label="Shape">
            {SHAPE_KINDS.map((kind) => {
                const Icon = kind.icon;
                const active = kind.id === activeKind;
                return (
                    <ActionButton key={kind.id} action={kindAction(kind)}>
                        <Button
                            size="compact"
                            variant={active ? "primary" : "secondary"}
                            aria-pressed={active}
                            data-testid={`shape-kind-${kind.id}`}
                        >
                            <Icon size={18} />
                            <T
                                keyName={`shapes.kinds.${kind.id}`}
                                defaultValue={kind.label}
                            />
                        </Button>
                    </ActionButton>
                );
            })}
        </div>
    );
}

function useShapeContext(): ShapeContext | null {
    const canvas = currentCanvas();
    return canvas ? shapeContextFor(canvas) : null;
}

function SessionControls({ session }: { session: ShapeSession }) {
    const ctx = useShapeContext();
    const kind = shapeKind(session.kindId)!;
    const [showMore, setShowMore] = useState(false);
    const preview = useMemo(
        () => (ctx ? previewSession(session, ctx) : null),
        [session, ctx],
    );
    if (!ctx || !preview) return null;

    const params = session.params as Record<string, unknown>;
    const setField = (key: string, value: unknown) =>
        useShapeToolStore.getState().setParams({ ...params, [key]: value });

    const groups = kind.groups.filter(
        (g) => !g.visibleWhen || g.visibleWhen(params),
    );
    const basic = groups.filter((g) => !g.advanced);
    const advanced = groups.filter((g) => g.advanced);

    return (
        <>
            {basic.map((group) => (
                <FieldGroup key={group.label} label={group.label}>
                    {group.fields.map((field) => (
                        <FieldControl
                            key={field.key}
                            field={field}
                            value={params[field.key]}
                            onChange={(v) => setField(field.key, v)}
                            ctx={ctx}
                        />
                    ))}
                </FieldGroup>
            ))}
            {advanced.length > 0 && (
                <button
                    type="button"
                    className="text-sub text-text/70 self-start underline"
                    onClick={() => setShowMore(!showMore)}
                >
                    <T keyName="inspector.shapeTool.more" />
                </button>
            )}
            {showMore &&
                advanced.map((group) => (
                    <FieldGroup key={group.label} label={group.label}>
                        {group.fields.map((field) => (
                            <FieldControl
                                key={field.key}
                                field={field}
                                value={params[field.key]}
                                onChange={(v) => setField(field.key, v)}
                                ctx={ctx}
                            />
                        ))}
                    </FieldGroup>
                ))}

            <OrderControls session={session} ctx={ctx} />

            <dl className="text-sub text-text/80 grid grid-cols-[auto_1fr] gap-x-12 gap-y-2">
                <dt className="text-text/60">
                    <T keyName="inspector.shapeTool.title" />
                </dt>
                <dd data-testid="shape-tool-count">
                    <T
                        keyName="inspector.shapeTool.marchers"
                        params={{ count: session.marchers.length }}
                    />
                </dd>
                {preview.readouts.map((r) => (
                    <ReadoutRow key={r.label} label={r.label} value={r.value} />
                ))}
            </dl>

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

            <div className="flex gap-8">
                <ActionButton action="applyShape">
                    <Button
                        size="compact"
                        disabled={!preview.canApply}
                        data-testid="shape-tool-apply"
                    >
                        <T keyName="inspector.shapeTool.apply" />
                    </Button>
                </ActionButton>
                <ActionButton action="cancelAlignmentUpdates">
                    <Button
                        size="compact"
                        variant="secondary"
                        data-testid="shape-tool-cancel"
                    >
                        <T keyName="inspector.shapeTool.cancel" />
                    </Button>
                </ActionButton>
            </div>
        </>
    );
}

function ReadoutRow({ label, value }: { label: string; value: string }) {
    return (
        <>
            <dt className="text-text/60">{label}</dt>
            <dd>{value}</dd>
        </>
    );
}

function FieldGroup({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <fieldset className="flex flex-col gap-6">
            <legend className="text-sub text-text/60 mb-4">{label}</legend>
            {children}
        </fieldset>
    );
}

function FieldControl({
    field,
    value,
    onChange,
    ctx,
}: {
    field: ParamField;
    value: unknown;
    onChange: (value: unknown) => void;
    ctx: ShapeContext;
}) {
    switch (field.type) {
        case "spacing":
            return (
                <SpacingControl
                    spacing={value as Spacing}
                    onChange={onChange}
                />
            );
        case "length":
            return (
                <NumberField
                    label={field.label}
                    unit="steps"
                    value={(value as number) / ctx.stepPx}
                    min={field.min}
                    onChange={(steps) => onChange(steps * ctx.stepPx)}
                />
            );
        case "count":
            return (
                <NumberField
                    label={field.label}
                    value={value as number}
                    min={field.min}
                    integer
                    onChange={onChange}
                />
            );
        case "angle":
            return (
                <NumberField
                    label={field.label}
                    unit="°"
                    value={((value as number) * 180) / Math.PI}
                    onChange={(deg) => onChange((deg * Math.PI) / 180)}
                />
            );
        case "enum":
            return (
                <ToggleGroup
                    type="single"
                    aria-label={field.label}
                    value={value as string}
                    onValueChange={(v) => v && onChange(v)}
                >
                    {field.options.map((o) => (
                        <ToggleGroupItem key={o.value} value={o.value}>
                            {o.label}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            );
        case "bool":
            return (
                <label className="text-body flex items-center gap-8">
                    <input
                        type="checkbox"
                        checked={value as boolean}
                        onChange={(e) => onChange(e.target.checked)}
                    />
                    {field.label}
                </label>
            );
    }
}

function NumberField({
    label,
    value,
    unit,
    min,
    integer,
    onChange,
}: {
    label: string;
    value: number;
    unit?: string;
    min?: number;
    integer?: boolean;
    onChange: (value: number) => void;
}) {
    const shown = integer
        ? String(value)
        : String(Math.round(value * 100) / 100);
    return (
        <label className="text-body flex items-center justify-between gap-8">
            <span className="text-text/80">{label}</span>
            <span className="flex items-center gap-4">
                <Input
                    compact
                    className="w-[5rem]"
                    type="number"
                    step={integer ? 1 : 0.5}
                    min={min}
                    value={shown}
                    onChange={(e) => {
                        const n = Number(e.target.value);
                        if (e.target.value === "" || !Number.isFinite(n))
                            return;
                        if (min !== undefined && n < min) return;
                        onChange(integer ? Math.round(n) : n);
                    }}
                />
                {unit && <span className="text-sub text-text/60">{unit}</span>}
            </span>
        </label>
    );
}

/** Fit or Interval; interval takes one value or mixed runs, and an anchor. Shared by path kinds. */
function SpacingControl({
    spacing,
    onChange,
}: {
    spacing: Spacing;
    onChange: (spacing: Spacing) => void;
}) {
    const { t } = useTolgee();
    const runs = spacing.mode === "interval" ? spacing.runs : null;
    const [draft, setDraft] = useState(runs ? formatIntervals(runs) : "2");
    const parsed = parseIntervals(draft);

    const setMode = (mode: string) => {
        if (mode === "fit") onChange({ mode: "fit" });
        else if (mode === "interval") {
            const p = parseIntervals(draft);
            onChange({
                mode: "interval",
                runs: p.ok ? p.runs : [{ steps: 2, count: 0 }],
                anchor: "start",
            });
        }
    };

    return (
        <div className="flex flex-col gap-8">
            <ToggleGroup
                type="single"
                aria-label="Spacing"
                value={spacing.mode}
                onValueChange={setMode}
            >
                <ToggleGroupItem value="fit" data-testid="shape-spacing-fit">
                    <T keyName="inspector.shapeTool.spacingFit" />
                </ToggleGroupItem>
                <ToggleGroupItem
                    value="interval"
                    data-testid="shape-spacing-interval"
                >
                    <T keyName="inspector.shapeTool.spacingInterval" />
                </ToggleGroupItem>
            </ToggleGroup>
            {spacing.mode === "interval" && (
                <>
                    <label className="text-body flex items-center gap-8">
                        <Input
                            compact
                            className="w-[9rem] font-mono"
                            aria-label="Interval in steps"
                            placeholder={t(
                                "inspector.shapeTool.intervalPlaceholder",
                            )}
                            value={draft}
                            data-testid="shape-interval-input"
                            onChange={(e) => {
                                setDraft(e.target.value);
                                const p = parseIntervals(e.target.value);
                                if (p.ok)
                                    onChange({ ...spacing, runs: p.runs });
                            }}
                        />
                        <span className="text-sub text-text/60">steps</span>
                    </label>
                    {!parsed.ok && (
                        <p
                            className="text-sub text-red"
                            data-testid="shape-interval-error"
                        >
                            {parsed.message}
                        </p>
                    )}
                    <div className="flex items-center gap-8">
                        <span className="text-sub text-text/60">
                            <T keyName="inspector.shapeTool.anchor" />
                        </span>
                        <ToggleGroup
                            type="single"
                            aria-label="Lay the interval from"
                            value={spacing.anchor}
                            onValueChange={(anchor) =>
                                anchor &&
                                onChange({
                                    ...spacing,
                                    anchor: anchor as
                                        | "start"
                                        | "center"
                                        | "end",
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
                    </div>
                </>
            )}
        </div>
    );
}

function OrderControls({
    session,
    ctx,
}: {
    session: ShapeSession;
    ctx: ShapeContext;
}) {
    const setOrder = (order: OrderMode, reverse: boolean) =>
        useShapeToolStore.getState().setOrder(order, reverse, ctx);
    return (
        <FieldGroup label="Order">
            <div className="flex flex-wrap items-center gap-6">
                <ToggleGroup
                    type="single"
                    aria-label="Order"
                    value={session.order}
                    onValueChange={(v) =>
                        v && setOrder(v as OrderMode, session.reverse)
                    }
                >
                    <ToggleGroupItem
                        value="keep"
                        data-testid="shape-order-keep"
                    >
                        <T keyName="inspector.shapeTool.orderKeep" />
                    </ToggleGroupItem>
                    <ToggleGroupItem
                        value="nearest"
                        data-testid="shape-order-nearest"
                    >
                        <T keyName="inspector.shapeTool.orderNearest" />
                    </ToggleGroupItem>
                    <ToggleGroupItem
                        value="drill"
                        data-testid="shape-order-drill"
                    >
                        <T keyName="inspector.shapeTool.orderDrill" />
                    </ToggleGroupItem>
                </ToggleGroup>
                {session.order !== "nearest" && (
                    <Button
                        size="compact"
                        variant="secondary"
                        aria-pressed={session.reverse}
                        onClick={() =>
                            setOrder(session.order, !session.reverse)
                        }
                        data-testid="shape-order-reverse"
                    >
                        <ArrowsDownUpIcon size={16} />
                        <T keyName="inspector.shapeTool.reverse" />
                    </Button>
                )}
                <Button
                    size="compact"
                    variant="secondary"
                    onClick={() => useShapeToolStore.getState().reassign(ctx)}
                    data-testid="shape-order-reassign"
                >
                    <T keyName="inspector.shapeTool.reassign" />
                </Button>
            </div>
        </FieldGroup>
    );
}
