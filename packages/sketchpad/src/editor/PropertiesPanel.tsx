import { useMemo, useState, type ReactNode } from "react";
import { RoughGenerator } from "roughjs/bin/generator";
import {
    ArrowLineDownIcon,
    ArrowLineUpIcon,
    ArrowDownIcon,
    ArrowUpIcon,
    CopyIcon,
    DotsNineIcon,
    FlipHorizontalIcon,
    LockSimpleIcon,
    TrashIcon,
} from "@phosphor-icons/react";
import { Slider } from "@openmarch/ui";
import clsx from "clsx";
import { DEFAULT_EVEN_COUNT, type DotSize } from "../fills/omFills";
import { formatSteps } from "../drill/position";
import { STICKY_COLORS, type StickyColor } from "./scene";
import {
    FILL_SWATCHES,
    FONT_SIZES,
    FONTS,
    STROKE_SWATCHES,
    type Arrowhead,
    type FillPattern,
    type StyleView,
} from "./style";
import {
    CustomColor,
    Panel,
    PanelButton,
    SectionLabel,
    Segmented,
    Swatch,
} from "./ui";

export interface PropertiesActions {
    strokeColor(color: string): void;
    backgroundColor(color: string): void;
    pattern(pattern: FillPattern): void;
    dotInterval(steps: number): void;
    dotSize(size: DotSize): void;
    dotCount(count: number): void;
    strokeWidth(width: number): void;
    strokeStyle(style: StyleView["strokeStyle"]): void;
    roughness(roughness: number): void;
    roundness(round: "round" | "sharp"): void;
    opacity(opacity: number): void;
    fontSize(size: number): void;
    fontFamily(family: number): void;
    textAlign(align: StyleView["textAlign"]): void;
    arrowhead(end: "start" | "end", head: Arrowhead): void;
    stickyColor(color: StickyColor): void;
    duplicate(): void;
    remove(): void;
    lock(): void;
    mirror(): void;
    layer(to: "back" | "backward" | "forward" | "front"): void;
}

const PATTERN_LABELS: Record<FillPattern, string> = {
    none: "None",
    solid: "Solid",
    hachure: "Lines",
    "cross-hatch": "Cross lines",
    "om-dots": "Dots",
    "om-staggered": "Staggered dots",
    "om-even": "Evenly distributed dots",
};

/** Small drawings of each fill, so they read in grayscale too (UX spec 11) */
function PatternIcon({ pattern }: { pattern: FillPattern }) {
    const dots = (pts: [number, number][]) =>
        pts.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={1.3} fill="currentColor" />
        ));
    const grid: [number, number][] = [];
    const stag: [number, number][] = [];
    for (let j = 0; j < 3; j++)
        for (let i = 0; i < 3; i++) {
            grid.push([6 + i * 6, 6 + j * 6]);
            stag.push([j % 2 ? 9 + i * 6 : 6 + i * 6, 6 + j * 6]);
        }
    const even: [number, number][] = [
        [7, 7],
        [12, 6],
        [17, 7],
        [6, 12],
        [12, 12],
        [18, 12],
        [8, 17],
        [16, 17],
    ];
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden>
            <rect
                x="2.5"
                y="2.5"
                width="19"
                height="19"
                rx="2"
                fill={pattern === "solid" ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="1.3"
            />
            {pattern === "none" && (
                <line
                    x1="4"
                    y1="20"
                    x2="20"
                    y2="4"
                    stroke="currentColor"
                    strokeWidth="1.3"
                />
            )}
            {(pattern === "hachure" || pattern === "cross-hatch") &&
                [0, 1, 2, 3, 4].map((i) => (
                    <line
                        key={i}
                        x1={3 + i * 5}
                        y1="21"
                        x2={-2 + i * 5 + 8}
                        y2="3"
                        stroke="currentColor"
                        strokeWidth="1"
                        transform="translate(-3 0)"
                    />
                ))}
            {pattern === "cross-hatch" &&
                [0, 1, 2, 3, 4].map((i) => (
                    <line
                        key={i}
                        x1={3 + i * 5}
                        y1="3"
                        x2={-2 + i * 5 + 8}
                        y2="21"
                        stroke="currentColor"
                        strokeWidth="1"
                        transform="translate(-3 0)"
                    />
                ))}
            {pattern === "om-dots" && dots(grid)}
            {pattern === "om-staggered" && dots(stag.filter(([x]) => x < 20))}
            {pattern === "om-even" && dots(even)}
        </svg>
    );
}

const generator = new RoughGenerator();

/** A short stroke drawn as each Sloppiness option draws it (owner decision Q8) */
function SampleStroke({ roughness }: { roughness: number }) {
    const paths = useMemo(() => {
        const drawable = generator.curve(
            [
                [4, 14],
                [18, 6],
                [34, 15],
                [50, 7],
                [66, 13],
            ],
            {
                roughness,
                seed: 7,
                stroke: "currentColor",
                strokeWidth: 1.6,
                bowing: 1,
            },
        );
        return generator.toPaths(drawable).map((p) => p.d);
    }, [roughness]);
    return (
        <svg viewBox="0 0 70 20" width={70} height={20} aria-hidden>
            {paths.map((d, i) => (
                <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                />
            ))}
        </svg>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col">
            <SectionLabel>{title}</SectionLabel>
            {children}
        </section>
    );
}

function NumberField({
    value,
    onCommit,
    min,
    max,
    step,
    suffix,
    label,
    testId,
}: {
    value: number;
    onCommit: (value: number) => void;
    min: number;
    max: number;
    step: number;
    suffix: string;
    label: string;
    testId?: string;
}) {
    const [draft, setDraft] = useState<string | null>(null);
    const commit = () => {
        if (draft === null) return;
        const n = Number(draft);
        if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
        setDraft(null);
    };
    return (
        <label className="border-stroke bg-fg-1 rounded-6 focus-within:border-accent flex h-32 items-center gap-6 border px-8">
            <input
                aria-label={label}
                data-testid={testId}
                type="number"
                min={min}
                max={max}
                step={step}
                value={draft ?? String(value)}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === "Enter") commit();
                    e.stopPropagation();
                }}
                className="text-body text-text w-full min-w-0 bg-transparent outline-none"
            />
            <span className="text-sub text-text-subtitle">{suffix}</span>
        </label>
    );
}

export function PropertiesPanel({
    view,
    actions,
    pixelsPerStep,
}: {
    view: StyleView;
    actions: PropertiesActions;
    pixelsPerStep: number;
}) {
    const [opacity, setOpacity] = useState<number | null>(null);
    const om = view.omFill;
    const intervalSteps = om?.spacing ? om.spacing / pixelsPerStep : 2;
    const sel = view.selectionCount > 0;
    return (
        <Panel
            label="Properties"
            testId="sketch-properties"
            className="flex max-h-full min-h-0 w-[16.5rem] flex-col gap-14 overflow-y-auto p-14"
        >
            {view.has.stroke && view.sticky === null && (
                <Section title="Stroke">
                    <div className="flex items-center gap-6">
                        {STROKE_SWATCHES.map((c) => (
                            <Swatch
                                key={c}
                                color={c}
                                label={`Stroke ${c}`}
                                selected={view.strokeColor === c}
                                onClick={() => actions.strokeColor(c)}
                                testId={`stroke-${c}`}
                            />
                        ))}
                        <span className="bg-stroke mx-2 h-16 w-px" />
                        <CustomColor
                            value={view.strokeColor}
                            onChange={actions.strokeColor}
                            label="Custom stroke color"
                        />
                    </div>
                </Section>
            )}
            {view.sticky !== null && (
                <Section title="Sticky color">
                    <div className="flex items-center gap-6">
                        {(Object.keys(STICKY_COLORS) as StickyColor[]).map(
                            (c) => (
                                <Swatch
                                    key={c}
                                    color={STICKY_COLORS[c].fill}
                                    label={`Sticky ${c}`}
                                    selected={view.sticky === c}
                                    onClick={() => actions.stickyColor(c)}
                                />
                            ),
                        )}
                    </div>
                </Section>
            )}
            {view.has.fill && view.sticky === null && (
                <>
                    <Section title="Fill color">
                        <div className="flex items-center gap-6">
                            {FILL_SWATCHES.map((c) => (
                                <Swatch
                                    key={c}
                                    color={c}
                                    label={
                                        c === "transparent"
                                            ? "No fill"
                                            : `Fill ${c}`
                                    }
                                    selected={view.backgroundColor === c}
                                    onClick={() => actions.backgroundColor(c)}
                                    testId={`fill-color-${c}`}
                                />
                            ))}
                            <span className="bg-stroke mx-2 h-16 w-px" />
                            <CustomColor
                                value={view.backgroundColor}
                                onChange={actions.backgroundColor}
                                label="Custom fill color"
                            />
                        </div>
                    </Section>
                    <Section title="Fill pattern">
                        <div
                            className="grid grid-cols-7 gap-2"
                            role="radiogroup"
                            aria-label="Fill pattern"
                            data-testid="fill-patterns"
                        >
                            {(Object.keys(PATTERN_LABELS) as FillPattern[]).map(
                                (p) => (
                                    <button
                                        key={p}
                                        type="button"
                                        role="radio"
                                        aria-checked={view.pattern === p}
                                        aria-label={PATTERN_LABELS[p]}
                                        title={PATTERN_LABELS[p]}
                                        data-testid={`pattern-${p}`}
                                        onClick={() => actions.pattern(p)}
                                        className={clsx(
                                            "rounded-4 flex h-30 items-center justify-center border",
                                            view.pattern === p
                                                ? "border-accent bg-accent/20 text-accent"
                                                : "border-stroke text-text-subtitle hover:text-text hover:bg-text/10",
                                        )}
                                    >
                                        <PatternIcon pattern={p} />
                                    </button>
                                ),
                            )}
                        </div>
                        <div className="text-sub text-text-subtitle mt-6">
                            {PATTERN_LABELS[view.pattern]}
                            {om &&
                                om.kind !== "even" &&
                                ` · on a ${formatSteps(intervalSteps)}-step interval`}
                        </div>
                        {om && (
                            <div className="mt-10 flex flex-col gap-10">
                                <div className="grid grid-cols-2 gap-8">
                                    {om.kind === "even" ? (
                                        <div className="flex flex-col gap-4">
                                            <span className="text-sub text-text-subtitle">
                                                Count
                                            </span>
                                            <NumberField
                                                value={
                                                    om.count ??
                                                    DEFAULT_EVEN_COUNT
                                                }
                                                min={1}
                                                max={2000}
                                                step={1}
                                                suffix="dots"
                                                label="Dot count"
                                                testId="dot-count-input"
                                                onCommit={(n) =>
                                                    actions.dotCount(
                                                        Math.round(n),
                                                    )
                                                }
                                            />
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-4">
                                            <span className="text-sub text-text-subtitle">
                                                Interval
                                            </span>
                                            <NumberField
                                                value={Number(
                                                    formatSteps(intervalSteps),
                                                )}
                                                min={0.5}
                                                max={32}
                                                step={0.5}
                                                suffix="steps"
                                                label="Dot interval in steps"
                                                testId="dot-interval"
                                                onCommit={actions.dotInterval}
                                            />
                                        </div>
                                    )}
                                    <div className="flex flex-col gap-4">
                                        <span className="text-sub text-text-subtitle">
                                            Dot size
                                        </span>
                                        <Segmented<DotSize>
                                            label="Dot size"
                                            value={om.size}
                                            onChange={actions.dotSize}
                                            options={[
                                                {
                                                    value: "s",
                                                    label: "S",
                                                    title: "Small dots",
                                                },
                                                {
                                                    value: "m",
                                                    label: "M",
                                                    title: "Medium dots",
                                                },
                                                {
                                                    value: "l",
                                                    label: "L",
                                                    title: "Large dots",
                                                },
                                            ]}
                                        />
                                    </div>
                                </div>
                                {view.dots !== null && (
                                    <div
                                        className="bg-accent/15 text-accent rounded-6 flex items-center gap-8 px-10 py-8"
                                        data-testid="dot-count"
                                        aria-live="polite"
                                    >
                                        <DotsNineIcon size={16} />
                                        <span className="text-body font-medium">
                                            {view.dots}{" "}
                                            {view.dots === 1 ? "dot" : "dots"}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                    </Section>
                </>
            )}
            {view.has.stroke && view.sticky === null && (
                <>
                    <Section title="Stroke width">
                        <Segmented<string>
                            label="Stroke width"
                            value={String(view.strokeWidth)}
                            onChange={(v) => actions.strokeWidth(Number(v))}
                            options={[
                                { value: "1", label: "Thin", title: "Thin" },
                                { value: "2", label: "Bold", title: "Bold" },
                                {
                                    value: "4",
                                    label: "Extra",
                                    title: "Extra bold",
                                },
                            ]}
                        />
                    </Section>
                    <Section title="Stroke style">
                        <Segmented<StyleView["strokeStyle"]>
                            label="Stroke style"
                            value={view.strokeStyle}
                            onChange={actions.strokeStyle}
                            options={[
                                { value: "solid", label: "—", title: "Solid" },
                                {
                                    value: "dashed",
                                    label: "- -",
                                    title: "Dashed",
                                },
                                {
                                    value: "dotted",
                                    label: "···",
                                    title: "Dotted",
                                },
                            ]}
                        />
                    </Section>
                    <Section title="Sloppiness">
                        <Segmented<string>
                            label="Sloppiness"
                            testId="sloppiness"
                            value={view.roughness === 0 ? "0" : "1"}
                            onChange={(v) => actions.roughness(Number(v))}
                            itemClassName="h-44! flex-col gap-0"
                            options={[
                                {
                                    value: "0",
                                    title: "Clean",
                                    testId: "sloppiness-clean",
                                    label: (
                                        <>
                                            <SampleStroke roughness={0} />
                                            <span className="text-sub">
                                                Clean
                                            </span>
                                        </>
                                    ),
                                },
                                {
                                    value: "1",
                                    title: "Sketchy",
                                    testId: "sloppiness-sketchy",
                                    label: (
                                        <>
                                            <SampleStroke roughness={1.6} />
                                            <span className="text-sub">
                                                Sketchy
                                            </span>
                                        </>
                                    ),
                                },
                            ]}
                        />
                    </Section>
                </>
            )}
            {view.has.roundness && view.sticky === null && (
                <Section title="Edges">
                    <Segmented<"sharp" | "round">
                        label="Edges"
                        value={view.roundness}
                        onChange={actions.roundness}
                        options={[
                            { value: "sharp", label: "Sharp", title: "Sharp" },
                            { value: "round", label: "Round", title: "Round" },
                        ]}
                    />
                </Section>
            )}
            {view.has.arrow && (
                <Section title="Arrowheads">
                    {(["start", "end"] as const).map((end) => (
                        <div key={end} className="mb-4 flex items-center gap-6">
                            <span className="text-sub text-text-subtitle w-32 capitalize">
                                {end}
                            </span>
                            <Segmented<Arrowhead>
                                label={`${end} arrowhead`}
                                className="flex-1"
                                value={
                                    end === "start"
                                        ? view.startArrowhead
                                        : view.endArrowhead
                                }
                                onChange={(h) => actions.arrowhead(end, h)}
                                options={[
                                    {
                                        value: "none",
                                        label: "—",
                                        title: "None",
                                    },
                                    {
                                        value: "arrow",
                                        label: "›",
                                        title: "Arrow",
                                    },
                                    {
                                        value: "triangle",
                                        label: "▸",
                                        title: "Triangle",
                                    },
                                    { value: "bar", label: "|", title: "Bar" },
                                    {
                                        value: "circle",
                                        label: "•",
                                        title: "Dot",
                                    },
                                ]}
                            />
                        </div>
                    ))}
                </Section>
            )}
            {view.has.text && (
                <Section title="Text">
                    <div className="flex flex-col gap-6">
                        <Segmented<string>
                            label="Font size"
                            value={String(view.fontSize)}
                            onChange={(v) => actions.fontSize(Number(v))}
                            options={(
                                Object.keys(
                                    FONT_SIZES,
                                ) as (keyof typeof FONT_SIZES)[]
                            ).map((k) => ({
                                value: String(FONT_SIZES[k]),
                                label: k.toUpperCase(),
                                title: `Font size ${k.toUpperCase()}`,
                            }))}
                        />
                        <Segmented<string>
                            label="Font"
                            value={String(view.fontFamily)}
                            onChange={(v) => actions.fontFamily(Number(v))}
                            options={[
                                {
                                    value: String(FONTS.hand),
                                    label: "Hand",
                                    title: "Handwritten",
                                },
                                {
                                    value: String(FONTS.sans),
                                    label: "Sans",
                                    title: "Sans",
                                },
                                {
                                    value: String(FONTS.mono),
                                    label: "Mono",
                                    title: "Mono",
                                },
                            ]}
                        />
                        <Segmented<StyleView["textAlign"]>
                            label="Text alignment"
                            value={view.textAlign}
                            onChange={actions.textAlign}
                            options={[
                                {
                                    value: "left",
                                    label: "Left",
                                    title: "Align left",
                                },
                                {
                                    value: "center",
                                    label: "Center",
                                    title: "Align center",
                                },
                                {
                                    value: "right",
                                    label: "Right",
                                    title: "Align right",
                                },
                            ]}
                        />
                    </div>
                </Section>
            )}
            <Section title="Opacity">
                <div className="flex items-center gap-10">
                    <Slider
                        aria-label="Opacity"
                        className="w-auto flex-1"
                        min={0}
                        max={100}
                        step={5}
                        value={[opacity ?? view.opacity]}
                        onValueChange={([v]) => setOpacity(v ?? 100)}
                        onValueCommit={([v]) => {
                            actions.opacity(v ?? 100);
                            setOpacity(null);
                        }}
                    />
                    <span className="text-sub text-text-subtitle w-24 text-right font-mono">
                        {opacity ?? view.opacity}
                    </span>
                </div>
            </Section>
            {sel && (
                <Section title="Actions">
                    <div className="flex flex-wrap gap-4">
                        <PanelButton
                            label="Duplicate"
                            title="Duplicate (Ctrl+D)"
                            onClick={actions.duplicate}
                        >
                            <CopyIcon size={16} />
                        </PanelButton>
                        <PanelButton
                            label="Delete"
                            title="Delete (Delete)"
                            onClick={actions.remove}
                        >
                            <TrashIcon size={16} />
                        </PanelButton>
                        <PanelButton
                            label="Lock"
                            title="Lock (Ctrl+Shift+L)"
                            pressed={view.locked}
                            onClick={actions.lock}
                        >
                            <LockSimpleIcon size={16} />
                        </PanelButton>
                        <PanelButton
                            label="Mirror across the 50"
                            title="Mirror a copy across the 50 (Ctrl+Shift+M)"
                            onClick={actions.mirror}
                            testId="mirror-50"
                        >
                            <FlipHorizontalIcon size={16} />
                            <span className="text-sub">50</span>
                        </PanelButton>
                    </div>
                    <div className="mt-6 flex gap-4">
                        <PanelButton
                            label="Send to back"
                            onClick={() => actions.layer("back")}
                        >
                            <ArrowLineDownIcon size={16} />
                        </PanelButton>
                        <PanelButton
                            label="Send backward"
                            onClick={() => actions.layer("backward")}
                        >
                            <ArrowDownIcon size={16} />
                        </PanelButton>
                        <PanelButton
                            label="Bring forward"
                            onClick={() => actions.layer("forward")}
                        >
                            <ArrowUpIcon size={16} />
                        </PanelButton>
                        <PanelButton
                            label="Bring to front"
                            onClick={() => actions.layer("front")}
                        >
                            <ArrowLineUpIcon size={16} />
                        </PanelButton>
                    </div>
                </Section>
            )}
        </Panel>
    );
}
