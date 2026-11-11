import { Checkpoint } from "@openmarch/core";
import * as RadixCollapsible from "@radix-ui/react-collapsible";
import { useState } from "react";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { Input, Button, Switch } from "@openmarch/ui";
import { T, useTranslate } from "@tolgee/react";
import FormField from "../../ui/FormField";
import { inputClassname } from "./utils";
import { useCommitInput, type CommitInputProps } from "./useCommitInput";
import {
    filterSignedNumber,
    formatNumber,
    parseNumber,
} from "./fieldEditorValues";

interface CheckpointEditorProps {
    checkpoint: Checkpoint;
    deleteCheckpoint: (checkpoint: Checkpoint) => void;
    updateCheckpoint: (args: {
        oldCheckpoint: Checkpoint;
        newCheckpoint: Checkpoint;
        axis: "x" | "y";
    }) => void;
    axis: "x" | "y";
}

export function CheckpointEditor({
    checkpoint,
    updateCheckpoint,
    deleteCheckpoint,
    axis,
}: CheckpointEditorProps) {
    const { t } = useTranslate();
    const [open, setOpen] = useState(false);

    /** Saves one changed property of the checkpoint. */
    const save = <K extends keyof Checkpoint>(key: K, value: Checkpoint[K]) =>
        updateCheckpoint({
            axis,
            oldCheckpoint: checkpoint,
            newCheckpoint: { ...checkpoint, [key]: value },
        });

    // Each input follows the stored checkpoint (undo, import, another window) and saves only a
    // changed, valid value
    const steps = useCommitInput({
        current: checkpoint.stepsFromCenterFront,
        format: formatNumber,
        parse: (text) => {
            const value = parseNumber(text);
            return value === undefined ? null : { value };
        },
        commit: (value) => save("stepsFromCenterFront", value),
        filter: filterSignedNumber,
    });
    const nonEmpty = (text: string) =>
        text.trim() === "" ? null : { value: text.trim() };
    const name = useCommitInput({
        current: checkpoint.name,
        format: (text) => text,
        parse: nonEmpty,
        commit: (value) => save("name", value),
    });
    const terseName = useCommitInput({
        current: checkpoint.terseName,
        format: (text) => text,
        parse: nonEmpty,
        commit: (value) => save("terseName", value),
    });
    const fieldLabel = useCommitInput({
        current: checkpoint.fieldLabel,
        format: (text) => text ?? "",
        parse: (text) => ({ value: text.length === 0 ? undefined : text }),
        commit: (value) => save("fieldLabel", value),
    });

    const errorInputClassname = `${inputClassname} border-red`;
    /** An input's props from `useCommitInput`, with the red border for an invalid value. */
    const inputProps = ({ valid, ...props }: CommitInputProps) => ({
        ...props,
        className: valid ? inputClassname : errorInputClassname,
    });

    return (
        <RadixCollapsible.Root
            className="CollapsibleRoot"
            open={open}
            onOpenChange={setOpen}
        >
            <RadixCollapsible.Trigger className="border-stroke focus-visible:text-accent rounded-6 bg-fg-2 flex w-full items-center justify-between gap-8 border px-16 py-6 duration-150 ease-out">
                <div className="flex w-full justify-between">
                    <p className="text-text text-body">{checkpoint.name}</p>
                    <p className="text-text/80 text-body">
                        <T
                            keyName="fieldProperties.measurements.steps"
                            params={{ count: checkpoint.stepsFromCenterFront }}
                        />
                    </p>
                </div>
                {open ? <CaretUpIcon size={20} /> : <CaretDownIcon size={20} />}
            </RadixCollapsible.Trigger>
            <RadixCollapsible.Content className="bg-fg-2 border-stroke rounded-6 mt-6 border p-8 pt-16">
                <div className="flex flex-col gap-12">
                    <FormField
                        label={
                            axis === "x"
                                ? t(
                                      "fieldProperties.checkpoint.stepsFromCenter",
                                  )
                                : t("fieldProperties.checkpoint.stepsFromFront")
                        }
                        tooltip={
                            axis === "x"
                                ? t(
                                      "fieldProperties.checkpoint.stepsFromCenterHint",
                                  )
                                : t(
                                      "fieldProperties.checkpoint.stepsFromFrontTooltip",
                                  )
                        }
                    >
                        <Input
                            type="text"
                            inputMode="numeric"
                            pattern="-?[0-9]*\.?[0-9]*"
                            {...inputProps(steps)}
                            required
                            maxLength={10}
                        />
                    </FormField>
                    <FormField
                        label={t("fieldProperties.checkpoint.name")}
                        tooltip={t(
                            "fieldProperties.checkpoint.nameUsageTooltip",
                        )}
                    >
                        <Input
                            type="text"
                            {...inputProps(name)}
                            required
                            maxLength={40}
                        />
                    </FormField>
                    <FormField
                        label={t("fieldProperties.checkpoint.shortName")}
                        tooltip={t(
                            "fieldProperties.checkpoint.shortNameUsageTooltip",
                        )}
                    >
                        <Input
                            type="text"
                            {...inputProps(terseName)}
                            required
                        />
                    </FormField>
                    {axis === "x" && (
                        <FormField
                            label={t("fieldProperties.checkpoint.fieldLabel")}
                            tooltip={t(
                                "fieldProperties.checkpoint.fieldLabelTooltip",
                            )}
                        >
                            <Input type="text" {...inputProps(fieldLabel)} />
                        </FormField>
                    )}
                    <FormField
                        label={t("fieldProperties.checkpoint.visible")}
                        tooltip={t("fieldProperties.checkpoint.visibleTooltip")}
                    >
                        <Switch
                            className={inputClassname}
                            checked={checkpoint.visible}
                            onClick={(e) => {
                                e.preventDefault();
                                updateCheckpoint({
                                    axis,
                                    oldCheckpoint: checkpoint,
                                    newCheckpoint: {
                                        ...checkpoint,
                                        visible: !checkpoint.visible,
                                    },
                                });
                            }}
                        />
                    </FormField>
                    <FormField
                        label={t("fieldProperties.checkpoint.useAsReference")}
                        tooltip={t(
                            "fieldProperties.checkpoint.useAsReferenceTooltip",
                        )}
                    >
                        <Switch
                            className={inputClassname}
                            checked={checkpoint.useAsReference}
                            onClick={(e) => {
                                e.preventDefault();
                                updateCheckpoint({
                                    axis,
                                    oldCheckpoint: checkpoint,
                                    newCheckpoint: {
                                        ...checkpoint,
                                        useAsReference:
                                            !checkpoint.useAsReference,
                                    },
                                });
                            }}
                        />
                    </FormField>
                    <Button
                        variant="red"
                        size="compact"
                        className="mx-12 mt-6 mb-8 self-end"
                        tooltipText={t(
                            "fieldProperties.checkpoint.deleteTooltip",
                        )}
                        tooltipSide="right"
                        type="button"
                        onClick={() => {
                            deleteCheckpoint(checkpoint);
                        }}
                    >
                        <T keyName="fieldProperties.checkpoint.delete" />
                    </Button>
                </div>
            </RadixCollapsible.Content>
        </RadixCollapsible.Root>
    );
}
