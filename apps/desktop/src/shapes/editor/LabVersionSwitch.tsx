import { SegmentedTextSwitch } from "@openmarch/ui";
import { useLabVariant, useLabVariantStore } from "@/lab/labVariant";

/**
 * TEMPORARY, the lab test box-layouts (#387): the versions of the size number's − and + to try,
 * switched without reloading. Shown only when the lab link names one (`?variant=`), so the app
 * looks as usual everywhere else. Goes when the owner picks.
 */
export const SIZE_VERSIONS = [
    { value: "center", label: "Center" },
    { value: "front", label: "Front" },
    { value: "glide", label: "Glide" },
    { value: "front-glide", label: "Front + glide" },
] as const;

export function LabVersionSwitch() {
    const variant = useLabVariant();
    if (variant === null) return null;
    return (
        <div className="flex flex-col gap-4" data-testid="lab-version">
            <span className="text-sub text-text/60">
                Lab: how − and + resize the box
            </span>
            <SegmentedTextSwitch
                ariaLabel="Version to try"
                testId="lab-version-switch"
                className="self-start"
                options={SIZE_VERSIONS.map((v) => ({
                    value: v.value,
                    label: v.label,
                    testId: `lab-version-${v.value}`,
                }))}
                selected={variant}
                setSelected={(value) =>
                    useLabVariantStore.getState().setVariant(value)
                }
            />
        </div>
    );
}
