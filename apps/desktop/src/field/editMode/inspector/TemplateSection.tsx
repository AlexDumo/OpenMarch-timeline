import { useMemo, useState } from "react";
import type { FieldProperties } from "@openmarch/core";
import { useTranslate } from "@tolgee/react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogTitle,
    Button,
    Checkbox,
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTriggerButton,
} from "@openmarch/ui";
import FootballTemplates from "@/global/classes/fieldTemplates/Football";
import GridFieldTemplates from "@/global/classes/fieldTemplates/GridFields";
import FieldIoButtons from "@/components/field/FieldIoButtons";
import { siteUrl } from "@/global/siteUrl";
import {
    applyTemplate,
    FIELD_TEMPLATE_IDS,
    type FieldTemplateId,
} from "@/field/edits";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import { baseTemplateOf } from "../fieldEditPlans";
import { fieldSizeSteps } from "../lines";
import { useApplyFieldEdits } from "../useApplyFieldEdits";

const idOfName = (name: string): FieldTemplateId | undefined =>
    FIELD_TEMPLATE_IDS.find(
        (id) => (FieldPropertiesTemplates[id] as FieldProperties).name === name,
    );

/**
 * The field's template and files (#824): switch to another template through a sheet that says
 * what changes (lines, size) and keeps the look by default (B11), import and export a .fieldots
 * file, and the guide.
 */
export function TemplateSection({ fp }: { fp: FieldProperties }) {
    const { t } = useTranslate();
    const apply = useApplyFieldEdits();
    const base = baseTemplateOf(fp);
    const [picked, setPicked] = useState<FieldTemplateId | null>(null);
    const [keepLook, setKeepLook] = useState(true);
    const preview = useMemo(
        () =>
            picked
                ? applyTemplate(fp, {
                      template: picked,
                      keep: keepLook ? "look" : "none",
                  })
                : null,
        [fp, picked, keepLook],
    );
    const diff = preview?.diff;
    const before = fieldSizeSteps(fp);
    const after = preview ? fieldSizeSteps(preview.next) : before;

    return (
        <div className="flex flex-col gap-12">
            <label className="flex flex-col gap-4">
                <span className="text-sub text-text/60">
                    {t("fieldProperties.fieldTemplate.label")}
                </span>
                <Select
                    value={base?.template.name ?? ""}
                    onValueChange={(name) => {
                        const id = idOfName(name);
                        if (id) {
                            setKeepLook(true);
                            setPicked(id);
                        }
                    }}
                >
                    <SelectTriggerButton
                        className="h-26 w-full px-8"
                        label={
                            base?.template.name ??
                            t("fieldProperties.customFieldName")
                        }
                        data-testid="field-template-select"
                    />
                    <SelectContent>
                        <SelectGroup>
                            <SelectLabel>
                                {t("fieldProperties.fieldTemplate.football")}
                            </SelectLabel>
                            {Object.values(FootballTemplates).map((tpl) => (
                                <SelectItem key={tpl.name} value={tpl.name}>
                                    {tpl.name}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                        <SelectSeparator />
                        <SelectGroup>
                            <SelectLabel>
                                {t("fieldProperties.fieldTemplate.grid")}
                            </SelectLabel>
                            {Object.values(GridFieldTemplates).map((tpl) => (
                                <SelectItem key={tpl.name} value={tpl.name}>
                                    {tpl.name}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </label>
            <FieldIoButtons />
            <a
                className="text-sub text-accent w-fit hover:underline"
                href={siteUrl("/guides/editing-the-grid")}
                target="_blank"
                rel="noreferrer"
            >
                {t("fieldProperties.customFieldDocs")}
            </a>

            <AlertDialog
                open={picked !== null}
                onOpenChange={(open) => {
                    if (!open) setPicked(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogTitle>
                        {t("fieldEditMode.template.title", {
                            template: picked
                                ? (
                                      FieldPropertiesTemplates[
                                          picked
                                      ] as FieldProperties
                                  ).name
                                : "",
                        })}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="flex flex-col gap-8">
                        {diff && (
                            <ul
                                className="text-body flex list-disc flex-col gap-4 pl-20"
                                data-testid="field-template-diff"
                            >
                                <li>
                                    {t("fieldEditMode.template.lines", {
                                        added: diff.checkpoints.added.length,
                                        removed:
                                            diff.checkpoints.removed.length,
                                        renamed:
                                            diff.checkpoints.renamed.length +
                                            diff.checkpoints.changed.length,
                                    })}
                                </li>
                                <li>
                                    {t("fieldEditMode.template.size", {
                                        before: `${before.width} × ${before.depth}`,
                                        after: `${after.width} × ${after.depth}`,
                                    })}
                                </li>
                                {(diff.geometry.sizeChanged ||
                                    diff.geometry.centerChanged ||
                                    diff.geometry.stepSizeChanged) && (
                                    <li className="text-yellow">
                                        {t(
                                            "fieldProperties.applyFieldTypeWarning",
                                        )}
                                    </li>
                                )}
                            </ul>
                        )}
                        <label className="text-body flex items-center gap-8">
                            <Checkbox
                                checked={keepLook}
                                onCheckedChange={(on) =>
                                    setKeepLook(on === true)
                                }
                                data-testid="field-template-keep-look"
                            />
                            {t("fieldEditMode.template.keepLook")}
                        </label>
                        <p className="text-sub text-text/60">
                            {t("fieldEditMode.template.undoNote")}
                        </p>
                    </AlertDialogDescription>
                    <div className="flex justify-end gap-8">
                        <AlertDialogCancel>
                            <Button variant="secondary" size="compact">
                                {t("fieldEditMode.template.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction>
                            <Button
                                size="compact"
                                data-testid="field-template-apply"
                                onClick={() => {
                                    if (picked)
                                        void apply({
                                            edit: "applyTemplate",
                                            args: {
                                                template: picked,
                                                keep: keepLook
                                                    ? "look"
                                                    : "none",
                                            },
                                        });
                                }}
                            >
                                {t("fieldEditMode.template.apply")}
                            </Button>
                        </AlertDialogAction>
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
