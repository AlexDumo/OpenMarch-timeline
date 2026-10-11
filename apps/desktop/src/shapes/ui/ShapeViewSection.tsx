import { T, useTolgee } from "@tolgee/react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTriggerCompact,
} from "@openmarch/ui";
import {
    defaultShapePreviewView,
    useUiSettingsStore,
    type ShapePreviewView,
} from "@/stores/UiSettingsStore";
import type { ResolvedShapeView } from "../canvas/previewView";

type Option<K extends keyof ShapePreviewView> = {
    readonly value: ShapePreviewView[K];
    readonly key: string;
};

const PATHS: Option<"paths">[] = [
    { value: "auto", key: "inspector.shapeTool.view.auto" },
    { value: "all", key: "inspector.shapeTool.view.pathsAll" },
    { value: "problems", key: "inspector.shapeTool.view.pathsProblems" },
];
const LABELS: Option<"labels">[] = [
    { value: "auto", key: "inspector.shapeTool.view.auto" },
    { value: "names", key: "inspector.shapeTool.view.labelsNames" },
    { value: "numbers", key: "inspector.shapeTool.view.labelsNumbers" },
    { value: "none", key: "inspector.shapeTool.view.labelsNone" },
];
const OLD_SHAPE: Option<"oldShape">[] = [
    { value: "auto", key: "inspector.shapeTool.view.auto" },
    { value: "show", key: "inspector.shapeTool.view.show" },
    { value: "hide", key: "inspector.shapeTool.view.hide" },
];

/**
 * What the preview draws (sims, round 6: some want every walk, some only the problems; labels
 * crowd at 2 steps; the shape being replaced puzzles some). Each option starts on Auto, which
 * says what it picked; a choice is remembered. The legend names each mark.
 */
export function ShapeViewSection({
    resolved,
}: {
    resolved: ResolvedShapeView;
}) {
    const { t } = useTolgee();
    const stored = useUiSettingsStore((s) => s.uiSettings.shapePreview);
    const view = { ...defaultShapePreviewView, ...stored };
    const set = (change: Partial<ShapePreviewView>) => {
        const settings = useUiSettingsStore.getState();
        settings.setUiSettings({
            ...settings.uiSettings,
            shapePreview: { ...settings.uiSettings.shapePreview, ...change },
        });
    };
    const autoSays = {
        paths: t(
            resolved.paths === "all"
                ? "inspector.shapeTool.view.pathsAll"
                : "inspector.shapeTool.view.pathsProblems",
        ),
        labels: t(
            resolved.labels === "names"
                ? "inspector.shapeTool.view.labelsNames"
                : resolved.labels === "numbers"
                  ? "inspector.shapeTool.view.labelsNumbers"
                  : "inspector.shapeTool.view.labelsNone",
        ),
        oldShape: t(
            resolved.oldShape
                ? "inspector.shapeTool.view.show"
                : "inspector.shapeTool.view.hide",
        ),
    };

    const picker = <K extends keyof ShapePreviewView>(
        key: K,
        options: Option<K>[],
    ) => (
        <Select
            value={view[key]}
            onValueChange={(v) =>
                set({ [key]: v } as Partial<ShapePreviewView>)
            }
        >
            <SelectTriggerCompact
                label={t(`inspector.shapeTool.view.${key}`)}
                data-testid={`shape-view-${key}`}
            />
            <SelectContent>
                {options.map((o) => (
                    <SelectItem
                        key={o.value}
                        value={o.value}
                        data-testid={`shape-view-${key}-${o.value}`}
                    >
                        {o.value === "auto"
                            ? t("inspector.shapeTool.view.autoIs", {
                                  choice: autoSays[key],
                              })
                            : t(o.key)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );

    return (
        <section className="flex flex-col gap-6" data-testid="shape-view">
            <h4 className="text-body text-text/80">
                <T keyName="inspector.shapeTool.view.title" />
            </h4>
            <ViewRow label={t("inspector.shapeTool.view.paths")}>
                {picker("paths", PATHS)}
            </ViewRow>
            <ViewRow label={t("inspector.shapeTool.view.labels")}>
                {picker("labels", LABELS)}
            </ViewRow>
            <ViewRow label={t("inspector.shapeTool.view.oldShape")}>
                {picker("oldShape", OLD_SHAPE)}
            </ViewRow>
            <ul
                className="text-sub text-text/70 flex flex-col gap-2"
                data-testid="shape-view-legend"
            >
                <LegendItem mark={<Dot filled />}>
                    <T keyName="inspector.shapeTool.view.legendNew" />
                </LegendItem>
                <LegendItem mark={<Dot />}>
                    <T keyName="inspector.shapeTool.view.legendStart" />
                </LegendItem>
                {resolved.oldShape && (
                    <LegendItem mark={<Dot small />}>
                        <T keyName="inspector.shapeTool.view.legendOld" />
                    </LegendItem>
                )}
                <LegendItem mark={<Walk />}>
                    <T
                        keyName={
                            resolved.paths === "all"
                                ? "inspector.shapeTool.view.legendWalks"
                                : "inspector.shapeTool.view.legendProblemWalks"
                        }
                    />
                </LegendItem>
            </ul>
        </section>
    );
}

function ViewRow({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="text-body flex min-h-[1.625rem] items-center justify-between gap-8">
            <span className="text-text/70 shrink-0">{label}</span>
            {children}
        </div>
    );
}

function LegendItem({
    mark,
    children,
}: {
    mark: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <li className="flex items-center gap-8">
            <span className="flex w-16 shrink-0 justify-center">{mark}</span>
            <span>{children}</span>
        </li>
    );
}

function Dot({ filled, small }: { filled?: boolean; small?: boolean }) {
    return (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            {small ? (
                <circle cx="6" cy="6" r="2.5" className="fill-text/40" />
            ) : (
                <circle
                    cx="6"
                    cy="6"
                    r="4.5"
                    strokeWidth="1.5"
                    className={
                        filled
                            ? "fill-red stroke-text"
                            : "stroke-accent fill-none"
                    }
                />
            )}
        </svg>
    );
}

function Walk() {
    return (
        <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden>
            <line
                x1="1"
                y1="10"
                x2="15"
                y2="2"
                strokeWidth="1.5"
                className="stroke-accent"
            />
        </svg>
    );
}
