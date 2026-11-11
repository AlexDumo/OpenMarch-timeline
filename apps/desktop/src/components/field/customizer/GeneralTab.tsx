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
import FormField from "@/components/ui/FormField";
import { inputClassname } from "./utils";
import { useCommitInput, type CommitInputProps } from "./useCommitInput";
import {
    filterSignedNumber,
    filterUnsignedNumber,
    parseNumber,
    parseStepSize,
} from "./fieldEditorValues";

interface GeneralTabProps {
    currentFieldProperties: FieldProperties;
    updateFieldProperties: (props: FieldProperties) => void;
}

const errorInputClassname = clsx(inputClassname, "border-red");

/** A number, or nothing for an empty input. */
const parseOptionalNumber = (text: string) => {
    if (text.trim() === "") return { value: undefined };
    const value = parseNumber(text);
    return value === undefined ? null : { value };
};

/** Any text. */
const parseText = (text: string) => ({ value: text });

/** The props a text input takes from `useCommitInput`. */
const inputProps = ({ valid: _valid, ...props }: CommitInputProps) => props;

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

    // Every input follows the stored field (undo, import, another window) and saves only a
    // changed, valid value; see useCommitInput
    const name = useCommitInput({
        stored: field.name,
        current: field.name,
        parse: parseText,
        commit: (value) => save({ name: value }),
    });
    const stepSize = useCommitInput({
        stored: String(field.stepSizeInUnits),
        current: field.stepSizeInUnits,
        // A step has a length: 0 would make a field with no size
        parse: (text) => {
            const value = parseStepSize(text);
            return value === undefined ? null : { value };
        },
        commit: (value) => save({ stepSizeInches: toInches(value) }),
        filter: filterUnsignedNumber,
    });
    const threshold = useCommitInput({
        stored: String(field.stepSizeWarningThresholdInUnits),
        current: field.stepSizeWarningThresholdInUnits,
        // 0 turns the warning off
        parse: (text) => {
            const value = parseNumber(text);
            return value === undefined ? null : { value };
        },
        commit: (value) =>
            save({ stepSizeWarningThresholdInches: toInches(value) }),
        filter: filterUnsignedNumber,
    });
    const halfLineX = useCommitInput({
        stored: String(field.halfLineXInterval ?? ""),
        current: field.halfLineXInterval,
        parse: parseOptionalNumber,
        commit: (value) => save({ halfLineXInterval: value }),
        filter: filterUnsignedNumber,
    });
    const halfLineY = useCommitInput({
        stored: String(field.halfLineYInterval ?? ""),
        current: field.halfLineYInterval,
        parse: parseOptionalNumber,
        commit: (value) => save({ halfLineYInterval: value }),
        filter: filterUnsignedNumber,
    });
    const sideInput = (key: keyof SideDescriptions) => ({
        stored: field.sideDescriptions[key],
        current: field.sideDescriptions[key],
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
        stored: String(field.yardNumberCoordinates[key] ?? ""),
        current: field.yardNumberCoordinates[key],
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
                    <Input
                        type="text"
                        className={inputClassname}
                        {...inputProps(name)}
                        required
                    />
                </FormField>
                <FormField
                    label={t("fieldProperties.labels.stepSize")}
                    tooltip={t("fieldProperties.tooltips.stepSize")}
                >
                    <UnitInput
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*\.?[0-9]*"
                        containerClassName={
                            stepSize.valid
                                ? inputClassname
                                : errorInputClassname
                        }
                        aria-invalid={!stepSize.valid}
                        unit={unit}
                        {...inputProps(stepSize)}
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
                        containerClassName={inputClassname}
                        unit={unit}
                        {...inputProps(threshold)}
                        required
                    />
                </FormField>
                <FormField
                    label={t("fieldProperties.labels.measurementSystem")}
                    tooltip={t("fieldProperties.tooltips.measurementSystem")}
                >
                    <Select
                        onValueChange={(e) =>
                            save({ measurementSystem: e as MeasurementSystem })
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
                        className={inputClassname}
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
                        className={inputClassname}
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
                    <Input
                        type="text"
                        className={inputClassname}
                        {...inputProps(verboseLeft)}
                        required
                    />
                </FormField>
                <FormField
                    label={t("fieldProperties.labels.leftAbbreviation")}
                    tooltip={t("fieldProperties.tooltips.leftAbbreviation")}
                >
                    <Input
                        type="text"
                        className={inputClassname}
                        {...inputProps(terseLeft)}
                        required
                    />
                </FormField>

                <FormField
                    label={t("fieldProperties.labels.directorsRight")}
                    tooltip={t("fieldProperties.tooltips.directorsRight")}
                >
                    <Input
                        type="text"
                        className={inputClassname}
                        {...inputProps(verboseRight)}
                        required
                    />
                </FormField>
                <FormField
                    label={t("fieldProperties.labels.rightAbbreviation")}
                    tooltip={t("fieldProperties.tooltips.rightAbbreviation")}
                >
                    <Input
                        type="text"
                        className={inputClassname}
                        {...inputProps(terseRight)}
                        required
                    />
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
                        className={inputClassname}
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
                        className={inputClassname}
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
                        className={inputClassname}
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
                        className={inputClassname}
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
                                updateFieldProperties(
                                    new FieldProperties({
                                        ...currentFieldProperties,
                                        leftLabelsVisible:
                                            !currentFieldProperties.leftLabelsVisible,
                                    }),
                                );
                            }}
                        />
                    </FormField>
                    <FormField label={t("fieldProperties.labels.right")}>
                        <Switch
                            className={clsx(inputClassname, "col-span-2")}
                            checked={currentFieldProperties.rightLabelsVisible}
                            onClick={(e) => {
                                e.preventDefault();
                                updateFieldProperties(
                                    new FieldProperties({
                                        ...currentFieldProperties,
                                        rightLabelsVisible:
                                            !currentFieldProperties.rightLabelsVisible,
                                    }),
                                );
                            }}
                        />
                    </FormField>
                    <FormField label={t("fieldProperties.labels.bottom")}>
                        <Switch
                            className={inputClassname}
                            checked={currentFieldProperties.bottomLabelsVisible}
                            onClick={(e) => {
                                e.preventDefault();
                                updateFieldProperties(
                                    new FieldProperties({
                                        ...currentFieldProperties,
                                        bottomLabelsVisible:
                                            !currentFieldProperties.bottomLabelsVisible,
                                    }),
                                );
                            }}
                        />
                    </FormField>
                    <FormField label={t("fieldProperties.labels.top")}>
                        <Switch
                            className={inputClassname}
                            checked={currentFieldProperties.topLabelsVisible}
                            onClick={(e) => {
                                e.preventDefault();
                                updateFieldProperties(
                                    new FieldProperties({
                                        ...currentFieldProperties,
                                        topLabelsVisible:
                                            !currentFieldProperties.topLabelsVisible,
                                    }),
                                );
                            }}
                        />
                    </FormField>
                </div>
            </div>
        </TabContent>
    );
}
