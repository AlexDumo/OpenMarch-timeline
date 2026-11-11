import {
    FieldProperties,
    DEFAULT_FIELD_THEME,
    ShapeType,
    FieldTheme,
} from "@openmarch/core";
import { TabContent, Button } from "@openmarch/ui";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTriggerButton,
} from "@openmarch/ui";
import { RgbaColor } from "@uiw/react-color";
import { T, useTranslate } from "@tolgee/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateFieldPropertiesMutationOptions } from "@/hooks/queries";
import ColorPicker from "../../ui/ColorPicker";
import { StaticFormField } from "../../ui/FormField";
import { inputClassname, shapeOptions, shapeIcons } from "./utils";
import { ArrowUUpLeftIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { isRgbaColor, sameColor } from "./fieldEditorValues";

interface ThemeTabProps {
    currentFieldProperties: FieldProperties;
}

/** The theme's single colors (not the marcher colors or the shape type). */
type ThemeColorKey = {
    [K in keyof FieldTheme]: FieldTheme[K] extends RgbaColor ? K : never;
}[keyof FieldTheme];

export function ThemeTab({ currentFieldProperties }: ThemeTabProps) {
    const { t } = useTranslate();
    const queryClient = useQueryClient();
    const { mutate: updateFieldProperties, isPending } = useMutation(
        updateFieldPropertiesMutationOptions(queryClient),
    );
    const theme = currentFieldProperties.theme;

    /** Saves a picked color, after checking it: nothing when it's invalid or unchanged. */
    const pickColor = (
        color: RgbaColor,
        current: RgbaColor,
        themeWith: (color: RgbaColor) => FieldTheme,
    ) => {
        if (!isRgbaColor(color)) {
            toast.error(t("fieldProperties.errors.invalidColor"));
            return;
        }
        if (sameColor(color, current)) return;
        updateFieldProperties(
            new FieldProperties({
                ...currentFieldProperties,
                theme: themeWith(color),
            }),
        );
    };
    const setColor = (key: ThemeColorKey) => (color: RgbaColor) =>
        pickColor(color, theme[key], (picked) => ({
            ...theme,
            [key]: picked,
        }));
    const setMarcherColor =
        (key: keyof FieldTheme["defaultMarcher"]) => (color: RgbaColor) =>
            pickColor(color, theme.defaultMarcher[key], (picked) => ({
                ...theme,
                defaultMarcher: { ...theme.defaultMarcher, [key]: picked },
            }));

    return (
        <TabContent value="theme" className="flex flex-col gap-32">
            {/* -------------------------------------------- THEME -------------------------------------------- */}
            <div className="flex flex-col gap-12">
                <h4 className="text-h4 mb-8">
                    <T keyName="fieldProperties.sections.theme" />
                </h4>

                <h5 className="text-h5 mb-8">
                    <T keyName="fieldProperties.themeSubsections.grid" />
                </h5>
                <ColorPicker
                    label={t("fieldProperties.labels.background")}
                    initialColor={currentFieldProperties.theme.background}
                    defaultColor={DEFAULT_FIELD_THEME.background as RgbaColor}
                    onBlur={setColor("background")}
                />
                <ColorPicker
                    label={t("fieldProperties.labels.primaryLines")}
                    initialColor={currentFieldProperties.theme.primaryStroke}
                    defaultColor={
                        DEFAULT_FIELD_THEME.primaryStroke as RgbaColor
                    }
                    onBlur={setColor("primaryStroke")}
                />
                <ColorPicker
                    label={t("fieldProperties.labels.secondaryLines")}
                    initialColor={currentFieldProperties.theme.secondaryStroke}
                    defaultColor={
                        DEFAULT_FIELD_THEME.secondaryStroke as RgbaColor
                    }
                    onBlur={setColor("secondaryStroke")}
                />
                <ColorPicker
                    label={t("fieldProperties.labels.gridLines")}
                    initialColor={currentFieldProperties.theme.tertiaryStroke}
                    defaultColor={
                        DEFAULT_FIELD_THEME.tertiaryStroke as RgbaColor
                    }
                    onBlur={setColor("tertiaryStroke")}
                />
                <h5 className="text-h5 mb-8">
                    <T keyName="fieldProperties.themeSubsections.labels" />
                </h5>
                <ColorPicker
                    label={t("fieldProperties.labels.fieldLabels")}
                    initialColor={currentFieldProperties.theme.fieldLabel}
                    defaultColor={DEFAULT_FIELD_THEME.fieldLabel as RgbaColor}
                    onBlur={setColor("fieldLabel")}
                />
                <ColorPicker
                    label={t("fieldProperties.labels.externalLabels")}
                    initialColor={currentFieldProperties.theme.externalLabel}
                    defaultColor={
                        DEFAULT_FIELD_THEME.externalLabel as RgbaColor
                    }
                    onBlur={setColor("externalLabel")}
                />
                <h5 className="text-h5 mb-8">
                    <T keyName="fieldProperties.themeSubsections.pathways" />
                </h5>
                <ColorPicker
                    label={t("fieldProperties.labels.previousPath")}
                    initialColor={currentFieldProperties.theme.previousPath}
                    defaultColor={DEFAULT_FIELD_THEME.previousPath as RgbaColor}
                    onBlur={setColor("previousPath")}
                />
                <ColorPicker
                    label={t("fieldProperties.labels.nextPath")}
                    initialColor={currentFieldProperties.theme.nextPath}
                    defaultColor={DEFAULT_FIELD_THEME.nextPath as RgbaColor}
                    onBlur={setColor("nextPath")}
                />
                <ColorPicker
                    label={t("fieldProperties.labels.temporaryPath")}
                    initialColor={currentFieldProperties.theme.tempPath}
                    defaultColor={DEFAULT_FIELD_THEME.tempPath as RgbaColor}
                    onBlur={setColor("tempPath")}
                />
                <h5 className="text-h5 mb-8">
                    <T keyName="fieldProperties.themeSubsections.marchers" />
                </h5>
                <ColorPicker
                    label={t("fieldProperties.labels.marcherFill")}
                    initialColor={
                        currentFieldProperties.theme.defaultMarcher.fill
                    }
                    defaultColor={DEFAULT_FIELD_THEME.defaultMarcher.fill}
                    onBlur={setMarcherColor("fill")}
                />
                <ColorPicker
                    label={t("fieldProperties.labels.marcherOutline")}
                    initialColor={
                        currentFieldProperties.theme.defaultMarcher.outline
                    }
                    defaultColor={DEFAULT_FIELD_THEME.defaultMarcher.outline}
                    onBlur={setMarcherColor("outline")}
                />
                <ColorPicker
                    label={t("fieldProperties.labels.marcherText")}
                    initialColor={
                        currentFieldProperties.theme.defaultMarcher.label
                    }
                    defaultColor={DEFAULT_FIELD_THEME.defaultMarcher.label}
                    onBlur={setMarcherColor("label")}
                />
                <ColorPicker
                    label={t("fieldProperties.labels.shapes")}
                    initialColor={currentFieldProperties.theme.shape}
                    defaultColor={DEFAULT_FIELD_THEME.shape as RgbaColor}
                    onBlur={setColor("shape")}
                />
                <StaticFormField label={t("fieldProperties.labels.shapeType")}>
                    <div className="flex items-center gap-8">
                        <Select
                            value={
                                currentFieldProperties.theme.shapeType ??
                                "__none__"
                            }
                            onValueChange={(value) => {
                                const shapeType: ShapeType =
                                    value === "__none__"
                                        ? null
                                        : (value as ShapeType);
                                updateFieldProperties(
                                    new FieldProperties({
                                        ...currentFieldProperties,
                                        theme: {
                                            ...currentFieldProperties.theme,
                                            shapeType,
                                        },
                                    }),
                                );
                            }}
                        >
                            <SelectTriggerButton
                                className={inputClassname}
                                label={t("fieldProperties.labels.shapeType")}
                            >
                                {currentFieldProperties.theme.shapeType
                                    ? shapeIcons[
                                          currentFieldProperties.theme
                                              .shapeType as (typeof shapeOptions)[number]
                                      ]
                                    : shapeIcons["circle"]}
                            </SelectTriggerButton>
                            <SelectContent>
                                <SelectGroup>
                                    {shapeOptions.map((shape) => (
                                        <SelectItem key={shape} value={shape}>
                                            {shapeIcons[shape]}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        <Button
                            aria-label={t(
                                "fieldProperties.tooltips.resetToDefault",
                            )}
                            tooltipSide="right"
                            size="compact"
                            tooltipText={t(
                                "fieldProperties.tooltips.resetToDefault",
                            )}
                            variant="secondary"
                            onClick={() => {
                                updateFieldProperties(
                                    new FieldProperties({
                                        ...currentFieldProperties,
                                        theme: {
                                            ...currentFieldProperties.theme,
                                            shapeType: "circle",
                                        },
                                    }),
                                );
                            }}
                            className="rounded-6 h-full"
                            content="icon"
                        >
                            <ArrowUUpLeftIcon size={20} />
                        </Button>
                    </div>
                </StaticFormField>

                <Button
                    onClick={() =>
                        updateFieldProperties(
                            new FieldProperties({
                                ...currentFieldProperties,
                                theme: DEFAULT_FIELD_THEME,
                            }),
                        )
                    }
                    disabled={isPending}
                    variant="secondary"
                    size="compact"
                    className="w-full px-16"
                    tooltipSide="right"
                    tooltipText={t("fieldProperties.tooltips.resetTheme")}
                >
                    <T keyName="fieldProperties.buttons.resetTheme" />
                </Button>
            </div>
        </TabContent>
    );
}
