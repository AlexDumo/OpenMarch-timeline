import { Slider, Switch } from "@openmarch/ui";
import { XIcon } from "@phosphor-icons/react";
import type { FieldProperties } from "@openmarch/core";
import { FIELD_PRESET_LABELS, resolvedFieldColors } from "../field/fieldStyle";
import type {
    FieldColors,
    FieldStyle,
    FieldStylePreset,
    RgbaColor,
} from "../types";
import { CustomColor, Panel, PanelButton, SectionLabel, Segmented } from "./ui";

const toHex = (c: RgbaColor) =>
    "#" +
    [c.r, c.g, c.b]
        .map((n) => Math.round(n).toString(16).padStart(2, "0"))
        .join("");
const fromHex = (hex: string, a = 1): RgbaColor => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
    a,
});

const COLOR_ROWS: { key: keyof FieldColors; label: string }[] = [
    { key: "background", label: "Field" },
    { key: "lines", label: "Yard lines" },
    { key: "hashes", label: "Hashes" },
    { key: "grid", label: "Grid" },
    { key: "numbers", label: "Numbers" },
];

/** The Field settings panel (UX spec 8.2) */
export function FieldPanel({
    style,
    fieldProperties,
    layoutDiffers,
    onChange,
    onUseCurrentField,
    onClose,
}: {
    style: FieldStyle;
    fieldProperties: FieldProperties;
    /** The host's current field differs from the sketch's snapshot */
    layoutDiffers: boolean;
    onChange: (style: FieldStyle) => void;
    onUseCurrentField?: () => void;
    onClose: () => void;
}) {
    const colors = resolvedFieldColors(fieldProperties, style);
    const set = (patch: Partial<FieldStyle>) =>
        onChange({ ...style, ...patch });
    const toggle = (
        key: "grid" | "halfLines" | "yardNumbers" | "labels",
        label: string,
    ) => (
        <label className="flex items-center justify-between gap-8 py-2">
            <span className="text-body">{label}</span>
            <Switch
                checked={style[key]}
                onCheckedChange={(v: boolean) => set({ [key]: v })}
                aria-label={label}
                data-testid={`field-${key}`}
            />
        </label>
    );
    return (
        <Panel
            label="Field settings"
            testId="sketch-field-panel"
            className="flex max-h-full w-[16.5rem] flex-col gap-14 overflow-y-auto p-14"
        >
            <div className="flex items-center justify-between">
                <span className="text-h5">Field</span>
                <PanelButton label="Close field settings" onClick={onClose}>
                    <XIcon size={16} />
                </PanelButton>
            </div>
            <div>
                <SectionLabel>Layout</SectionLabel>
                <div className="text-body">{fieldProperties.name}</div>
                <div className="text-sub text-text-subtitle">
                    Copied from the show when the sketch was made
                </div>
                {layoutDiffers && onUseCurrentField && (
                    <button
                        type="button"
                        className="text-accent text-sub mt-4 hover:underline"
                        onClick={onUseCurrentField}
                        data-testid="use-current-field"
                    >
                        Use current show field
                    </button>
                )}
            </div>
            <div>
                <SectionLabel>Theme</SectionLabel>
                <Segmented<FieldStylePreset>
                    label="Field theme"
                    testId="field-preset"
                    value={style.preset}
                    onChange={(preset) => set({ preset, colors: {} })}
                    options={(
                        Object.keys(FIELD_PRESET_LABELS) as FieldStylePreset[]
                    ).map((p) => ({
                        value: p,
                        label: p === "show" ? "Show" : FIELD_PRESET_LABELS[p],
                        title: FIELD_PRESET_LABELS[p],
                        testId: `field-preset-${p}`,
                    }))}
                />
            </div>
            <div>
                <SectionLabel>Show</SectionLabel>
                {toggle("grid", "Step grid")}
                {toggle("halfLines", "Half lines")}
                {toggle("yardNumbers", "Yard numbers")}
                {toggle("labels", "Line labels")}
            </div>
            <div>
                <SectionLabel>Colors</SectionLabel>
                <div className="flex flex-col gap-6">
                    {COLOR_ROWS.map(({ key, label }) => (
                        <div
                            key={key}
                            className="flex items-center justify-between"
                        >
                            <span className="text-body">{label}</span>
                            <span className="flex items-center gap-6">
                                <span
                                    className="rounded-4 border-stroke size-20 border"
                                    style={{ background: toHex(colors[key]) }}
                                />
                                <CustomColor
                                    value={toHex(colors[key])}
                                    label={`${label} color`}
                                    onChange={(hex) =>
                                        set({
                                            colors: {
                                                ...style.colors,
                                                [key]: fromHex(
                                                    hex,
                                                    colors[key].a,
                                                ),
                                            },
                                        })
                                    }
                                />
                            </span>
                        </div>
                    ))}
                    {Object.keys(style.colors).length > 0 && (
                        <button
                            type="button"
                            className="text-accent text-sub self-start hover:underline"
                            onClick={() => set({ colors: {} })}
                        >
                            Reset to{" "}
                            {FIELD_PRESET_LABELS[style.preset].toLowerCase()}
                        </button>
                    )}
                </div>
            </div>
            <div>
                <SectionLabel>Field opacity</SectionLabel>
                <div className="flex items-center gap-10">
                    <Slider
                        aria-label="Field opacity"
                        className="w-auto flex-1"
                        min={10}
                        max={100}
                        step={5}
                        value={[Math.round(style.opacity * 100)]}
                        onValueChange={([v]) =>
                            set({ opacity: (v ?? 100) / 100 })
                        }
                    />
                    <span className="text-sub text-text-subtitle w-32 text-right font-mono">
                        {Math.round(style.opacity * 100)}%
                    </span>
                </div>
            </div>
        </Panel>
    );
}
