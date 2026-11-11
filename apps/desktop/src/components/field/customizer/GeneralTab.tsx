import {
    FieldProperties,
    MeasurementSystem,
    SideDescriptions,
    YardNumberCoordinates,
} from "@openmarch/core";
import { Input, UnitInput, TabContent, Switch } from "@openmarch/ui";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTriggerButton,
} from "@openmarch/ui";
import { T, useTranslate } from "@tolgee/react";
import clsx from "clsx";
import { toast } from "sonner";
import FormField from "@/components/ui/FormField";
import { inputClassname } from "./utils";
import { useCommitInput, type CommitInputProps } from "./useCommitInput";
import {
    filterSignedNumber,
    filterUnsignedNumber,
    formatNumber,
    parseNumber,
    parseStepSize,
} from "./fieldEditorValues";

interface GeneralTabProps {
    currentFieldProperties: FieldProperties;
    /** Saves the field. A rejected promise puts the edited input back and shows an error. */
    updateFieldProperties: (props: FieldProperties) => void | Promise<unknown>;
}

const errorInputClassname = clsx(inputClassname, "border-red");

/** A number, or null when the text isn't one. */
const parseRequiredNumber = (text: string) => {
    const value = parseNumber(text);
    return value === undefined ? null : { value };
};

/** A number, or nothing for an empty input. */
const parseOptionalNumber = (text: string) =>
    text.trim() === "" ? { value: undefined } : parseRequiredNumber(text);

/** An optional number as an input shows it: empty for nothing. */
const formatOptionalNumber = (value: number | undefined) =>
    value === undefined ? "" : formatNumber(value);

/** Any text. */
const parseText = (text: string) => ({ value: text });
const formatText = (text: string) => text;

/**
 * The props a text input takes from `useCommitInput`, with the red border for an invalid value.
 * `className` goes on a plain input; a `UnitInput` takes it as `containerClassName`.
 */
const inputProps = ({ valid, ...props }: CommitInputProps) => ({
    ...props,
    className: valid ? inputClassname : errorInputClassname,
});
const unitInputProps = (commitInput: CommitInputProps) => {
    const { className, ...props } = inputProps(commitInput);
    return { ...props, containerClassName: className };
};

export function GeneralTab({
    currentFieldProperties,
    updateFieldProperties,
}: GeneralTabProps) {
    const { t } = useTranslate();
    const field = currentFieldProperties;
    const imperial = field.measurementSystem === "imperial";
    const toInches = (units: number) =>
        imperial ? units : FieldProperties.centimetersToInches(units);
    const save = (changes: Partial<FieldProperties>) =>
        updateFieldProperties(new FieldProperties({ ...field, ...changes }));
    /** Saves a switch or select. It follows the stored field, so a failed save only shows an error. */
    const toggle = (changes: Partial<FieldProperties>) => {
        Promise.resolve(save(changes)).catch((error: unknown) => {
            console.error("Couldn't save the field", error);
            toast.error(t("fieldProperties.errors.saveFailed"));
        });
    };

    // Every input follows the stored field (undo, import, another window) and saves only a
    // changed, valid value; see useCommitInput
    const name = useCommitInput({
        current: field.name,
        format: formatText,
        parse: parseText,
        commit: (value) => save({ name: value }),
    });
    const stepSize = useCommitInput({
        current: field.stepSizeInUnits,
        format: formatNumber,
        // A step has a length: 0 would make a field with no size
        parse: (text) => {
            const value = parseStepSize(text);
            return value === undefined ? null : { value };
        },
        commit: (value) => save({ stepSizeInches: toInches(value) }),
        filter: filterUnsignedNumber,
    });
    const threshold = useCommitInput({
        current: field.stepSizeWarningThresholdInUnits,
        format: formatNumber,
        // 0 turns the warning off
        parse: parseRequiredNumber,
        commit: (value) =>
            save({ stepSizeWarningThresholdInches: toInches(value) }),
        filter: filterUnsignedNumber,
    });
    const halfLineX = useCommitInput({
        current: field.halfLineXInterval ?? 0,
        format: formatNumber,
        // The field stores no interval as 0 (no half lines), so an empty input means 0
        parse: (text) =>
            text.trim() === "" ? { value: 0 } : parseRequiredNumber(text),
        commit: (value) => save({ halfLineXInterval: value }),
        filter: filterUnsignedNumber,
    });
    const halfLineY = useCommitInput({
        current: field.halfLineYInterval ?? 0,
        format: formatNumber,
        // The field stores no interval as 0 (no half lines), so an empty input means 0
        parse: (text) =>
            text.trim() === "" ? { value: 0 } : parseRequiredNumber(text),
        commit: (value) => save({ halfLineYInterval: value }),
        filter: filterUnsignedNumber,
    });
    const sideInput = (key: keyof SideDescriptions) => ({
        current: field.sideDescriptions[key],
        format: formatText,
        parse: parseText,
        commit: (value: string) =>
            save({
                sideDescriptions: { ...field.sideDescriptions, [key]: value },
            }),
    });
    const verboseLeft = useCommitInput(sideInput("verboseLeft"));
    const terseLeft = useCommitInput(sideInput("terseLeft"));
    const verboseRight = useCommitInput(sideInput("verboseRight"));
    const terseRight = useCommitInput(sideInput("terseRight"));
    const yardNumberInput = (key: keyof YardNumberCoordinates) => ({
        current: field.yardNumberCoordinates[key],
        format: formatOptionalNumber,
        parse: parseOptionalNumber,
        commit: (value: number | undefined) =>
            save({
                yardNumberCoordinates: {
                    ...field.yardNumberCoordinates,
                    [key]: value,
                },
            }),
        filter: filterSignedNumber,
    });
    const homeOutside = useCommitInput(
        yardNumberInput("homeStepsFromFrontToOutside"),
    );
    const homeInside = useCommitInput(
        yardNumberInput("homeStepsFromFrontToInside"),
    );
    const awayInside = useCommitInput(
        yardNumberInput("awayStepsFromFrontToInside"),
    );
    const awayOutside = useCommitInput(
        yardNumberInput("awayStepsFromFrontToOutside"),
    );

    const unit = imperial
        ? t("fieldProperties.units.inches")
        : t("fieldProperties.units.centimeters");

    return (
        <TabContent value="general" className="flex flex-col gap-32">
            {/* -------------------------------------------- GENERAL -------------------------------------------- */}
            <div className="flex flex-col gap-12">
                <h4 className="text-h4 mb-8">
                    <T keyName="fieldProperties.sections.general" />
                </h4>
                <FormField
                    label={t("fieldProperties.labels.fieldName")}
                    tooltip={t("fieldProperties.tooltips.fieldName")}
                >
                    <Input type="text" {...inputProps(name)} required />
                </FormField>
                <FormField
                    label={t("fieldProperties.labels.stepSize")}
                    tooltip={t("fieldProperties.tooltips.stepSize")}
                >
                    <UnitInput
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*\.?[0-9]*"
                        unit={unit}
                        {...unitInputProps(stepSize)}
                        required
                    />
                </FormField>
                <FormField
                    // Also as drill writers say it, "4 to 5", as the shape tool's warning does
                    label={
                        field.stepSizeWarningThresholdInches > 0
                            ? t(
                                  "fieldProperties.labels.stepSizeWarningRatio",
                                  "Step Size Warning Threshold ({steps} to 5)",
                                  {
                                      steps:
                                          Math.round(
                                              (180 /
                                                  field.stepSizeWarningThresholdInches) *
                                                  10,
                                          ) / 10,
                                  },
                              )
                            : t(
                                  "fieldProperties.labels.stepSizeWarningThreshold",
                              )
                    }
                    tooltip={t(
                        "fieldProperties.tooltips.stepSizeWarningThreshold",
                    )}
                >
                    <UnitInput
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*\.?[0-9]*"
                        unit={unit}
                        {...unitInputProps(threshold)}
                        required
                    />
                </FormField>
                <FormField
                    label={t("fieldProperties.labels.measurementSystem")}
                    tooltip={t("fieldProperties.tooltips.measurementSystem")}
                >
                    <Select
                        onValueChange={(e) =>
                            toggle({
                                measurementSystem: e as MeasurementSystem,
                            })
                        }
                        value={field.measurementSystem}
                    >
                        <SelectTriggerButton
                            className={inputClassname}
                            label={t(
                                "fieldProperties.labels.measurementSystem",
                            )}
                        />
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="imperial">
                                    <T keyName="fieldProperties.options.imperial" />
                                </SelectItem>
                                <SelectItem value="metric">
                                    <T keyName="fieldProperties.options.metric" />
                                </SelectItem>
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </FormField>

                <FormField
                    label={t("fieldProperties.labels.halfLineXInterval")}
                    tooltip={t("fieldProperties.tooltips.halfLineXInterval")}
                >
                    <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*\.?[0-9]*"
                        {...inputProps(halfLineX)}
                    />
                </FormField>
                <FormField
                    label={t("fieldProperties.labels.halfLineYInterval")}
                    tooltip={t("fieldProperties.tooltips.halfLineYInterval")}
                >
                    <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*\.?[0-9]*"
                        {...inputProps(halfLineY)}
                    />
                </FormField>
            </div>

            <div className="flex flex-col gap-12">
                <h4 className="text-h4 mb-8">
                    <T keyName="fieldProperties.sections.sideDescriptions" />
                </h4>
                <FormField
                    label={t("fieldProperties.labels.directorsLeft")}
                    tooltip={t("fieldProperties.tooltips.directorsLeft")}
                >
                    <Input type="text" {...inputProps(verboseLeft)} required />
                </FormField>
                <FormField
                    label={t("fieldProperties.labels.leftAbbreviation")}
                    tooltip={t("fieldProperties.tooltips.leftAbbreviation")}
                >
                    <Input type="text" {...inputProps(terseLeft)} required />
                </FormField>

                <FormField
                    label={t("fieldProperties.labels.directorsRight")}
                    tooltip={t("fieldProperties.tooltips.directorsRight")}
                >
                    <Input type="text" {...inputProps(verboseRight)} required />
                </FormField>
                <FormField
                    label={t("fieldProperties.labels.rightAbbreviation")}
                    tooltip={t("fieldProperties.tooltips.rightAbbreviation")}
                >
                    <Input type="text" {...inputProps(terseRight)} required />
                </FormField>
            </div>
            {/* The yard number placement isn't editable yet; the inputs show the stored values */}
            <div className="flex flex-col gap-12">
                <h4 className="text-h4 mb-8">
                    <T keyName="fieldProperties.sections.fieldLabels" />
                </h4>
                <FormField
                    label={t(
                        "fieldProperties.labels.stepsFromFrontToHomeLabel",
                    )}
                    tooltip={t(
                        "fieldProperties.tooltips.stepsFromFrontToHomeLabel",
                    )}
                >
                    <Input
                        type="text"
                        inputMode="numeric"
                        pattern="-?[0-9]*\.?[0-9]*"
                        {...inputProps(homeOutside)}
                        disabled
                    />
                </FormField>
                <FormField
                    label={t(
                        "fieldProperties.labels.stepsFromFrontToHomeLabelTop",
                    )}
                    tooltip={t(
                        "fieldProperties.tooltips.stepsFromFrontToHomeLabelTop",
                    )}
                >
                    <Input
                        type="text"
                        inputMode="numeric"
                        pattern="-?[0-9]*\.?[0-9]*"
                        {...inputProps(homeInside)}
                        disabled
                    />
                </FormField>
                <FormField
                    label={t(
                        "fieldProperties.labels.stepsFromFrontToAwayLabelTop",
                    )}
                    tooltip={t(
                        "fieldProperties.tooltips.stepsFromFrontToAwayLabelTop",
                    )}
                >
                    <Input
                        type="text"
                        inputMode="numeric"
                        pattern="-?[0-9]*\.?[0-9]*"
                        {...inputProps(awayInside)}
                        disabled
                    />
                </FormField>
                <FormField
                    label={t(
                        "fieldProperties.labels.stepsFromFrontToAwayLabelBottom",
                    )}
                    tooltip={t(
                        "fieldProperties.tooltips.stepsFromFrontToAwayLabelBottom",
                    )}
                >
                    <Input
                        type="text"
                        inputMode="numeric"
                        pattern="-?[0-9]*\.?[0-9]*"
                        {...inputProps(awayOutside)}
                        disabled
                    />
                </FormField>
            </div>
            <div className="flex flex-col gap-12">
                <h4 className="text-h4 mb-8">
                    <T keyName="fieldProperties.sections.externalLabels" />
                </h4>
                <div className="grid grid-cols-4">
                    <FormField label={t("fieldProperties.labels.left")}>
                        <Switch
                            className={clsx(inputClassname, "col-span-2")}
                            checked={currentFieldProperties.leftLabelsVisible}
                            onClick={(e) => {
                                e.preventDefault();
                                toggle({
                                    leftLabelsVisible: !field.leftLabelsVisible,
                                });
                            }}
                        />
                    </FormField>
                    <FormField label={t("fieldProperties.labels.right")}>
                        <Switch
                            className={clsx(inputClassname, "col-span-2")}
                            checked={currentFieldProperties.rightLabelsVisible}
                            onClick={(e) => {
                                e.preventDefault();
                                toggle({
                                    rightLabelsVisible:
                                        !field.rightLabelsVisible,
                                });
                            }}
                        />
                    </FormField>
                    <FormField label={t("fieldProperties.labels.bottom")}>
                        <Switch
                            className={inputClassname}
                            checked={currentFieldProperties.bottomLabelsVisible}
                            onClick={(e) => {
                                e.preventDefault();
                                toggle({
                                    bottomLabelsVisible:
                                        !field.bottomLabelsVisible,
                                });
                            }}
                        />
                    </FormField>
                    <FormField label={t("fieldProperties.labels.top")}>
                        <Switch
                            className={inputClassname}
                            checked={currentFieldProperties.topLabelsVisible}
                            onClick={(e) => {
                                e.preventDefault();
                                toggle({
                                    topLabelsVisible: !field.topLabelsVisible,
                                });
                            }}
                        />
                    </FormField>
                </div>
            </div>
        </TabContent>
    );
}
