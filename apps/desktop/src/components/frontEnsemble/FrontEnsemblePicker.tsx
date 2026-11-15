import { useId, useState } from "react";
import * as RadixCollapsible from "@radix-ui/react-collapsible";
import { CaretDownIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { T, useTranslate } from "@tolgee/react";
import { Input } from "@openmarch/ui";
import { pitThumbnailUrl } from "./pitThumbnails";
import { useItemDrawingStore } from "@/stores/ItemDrawingStore";
import { useSidebarModalStore } from "@/stores/SidebarModalStore";
import {
    PIT_FAMILIES,
    defaultPitVariant,
    pitVariantsOf,
    type PitGroup,
    type PitVariant,
} from "@/view3d/core/pit/catalog";
import { usePitVariantLabel } from "./usePitVariantLabel";

const GROUPS: readonly PitGroup[] = [
    "keyboards",
    "percussion",
    "audio",
    "podiums",
];

const GROUP_HEADING_CLASS =
    "text-sub text-text-subtitle px-8 pt-8 pb-4 font-medium tracking-wide uppercase";

/** Meters, to two decimals at most */
const meters = (value: number) => String(Number(value.toFixed(2)));

/**
 * The front ensemble view's Add equipment (instruments.md §6): every model as a small picture,
 * under its group (keyboards, percussion, audio, podiums), with a search box over them (owner,
 * 2026-11-15: see what each looks like rather than a list of names). Clicking one places it on
 * the field with a click, as a locked equipment item named for its family ("Marimba 2"). It
 * starts open, so adding more is always in reach; the presets are a button in the view's header
 * (`PitPresets`).
 */
export default function FrontEnsemblePicker() {
    const { t } = useTranslate();
    const [open, setOpen] = useState(true);
    const [query, setQuery] = useState("");
    const placeEquipment = useItemDrawingStore((s) => s.placeEquipment);
    const { toggleOpen } = useSidebarModalStore();
    const label = usePitVariantLabel();

    const place = (variant: PitVariant) => {
        placeEquipment({
            variant,
            baseName: t(`pit.family.${variant.family}`),
        });
        // Close the panel to place it on the field, as drawing a prop does
        toggleOpen();
    };

    const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const groups = GROUPS.map((group) => {
        const groupName = t(`frontEnsemble.groups.${group}`);
        const tiles = PIT_FAMILIES.filter((f) => f.group === group).flatMap(
            (family) => {
                const familyName = t(family.labelKey);
                const fallback = defaultPitVariant(family.id);
                return pitVariantsOf(family.id).map((variant) => ({
                    variant,
                    familyName,
                    variantName:
                        variant.label.length > 0 ? label(variant) : null,
                    isDefault:
                        variant === fallback &&
                        pitVariantsOf(family.id).length > 1,
                }));
            },
        );
        const shown = tiles.filter((tile) => {
            const text =
                `${groupName} ${tile.familyName} ${tile.variantName ?? ""}`.toLocaleLowerCase();
            return words.every((word) => text.includes(word));
        });
        return { group, groupName, shown };
    }).filter(({ shown }) => shown.length > 0);

    return (
        <RadixCollapsible.Root asChild open={open} onOpenChange={setOpen}>
            <section
                className="flex flex-col gap-12"
                aria-label={t("frontEnsemble.add.title")}
            >
                <RadixCollapsible.Trigger className="text-text/70 hover:text-text focus-visible:text-accent flex items-center justify-between text-sm font-medium outline-hidden duration-150 ease-out">
                    <span role="heading" aria-level={5}>
                        <T keyName="frontEnsemble.add.title" />
                    </span>
                    <CaretDownIcon
                        size={16}
                        aria-hidden
                        className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                    />
                </RadixCollapsible.Trigger>
                <RadixCollapsible.Content className="flex flex-col gap-12">
                    <div className="relative">
                        <MagnifyingGlassIcon
                            size={16}
                            aria-hidden
                            className="text-text-subtitle pointer-events-none absolute top-1/2 left-12 -translate-y-1/2"
                        />
                        <Input
                            type="search"
                            compact
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t("frontEnsemble.search")}
                            aria-label={t("frontEnsemble.search")}
                            className="w-full pl-36"
                        />
                    </div>
                    {groups.length === 0 ? (
                        <p className="text-sub text-text-subtitle py-8 text-center">
                            <T keyName="frontEnsemble.noMatch" />
                        </p>
                    ) : (
                        groups.map(({ group, groupName, shown }) => (
                            <div
                                key={group}
                                role="group"
                                aria-label={groupName}
                                className="flex flex-col gap-4"
                            >
                                <div
                                    className={GROUP_HEADING_CLASS}
                                    aria-hidden
                                >
                                    {groupName}
                                </div>
                                <div className="grid grid-cols-4 gap-6">
                                    {shown.map((tile) => (
                                        <EquipmentTile
                                            key={tile.variant.fileId}
                                            {...tile}
                                            onPick={() => place(tile.variant)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </RadixCollapsible.Content>
            </section>
        </RadixCollapsible.Root>
    );
}

/**
 * One model in the catalog: its picture on a light card (so dark finishes read in both themes),
 * its family's name and its size and finish. The footprint is in its tooltip and its description.
 */
function EquipmentTile({
    variant,
    familyName,
    variantName,
    isDefault,
    onPick,
}: {
    variant: PitVariant;
    familyName: string;
    variantName: string | null;
    isDefault: boolean;
    onPick: () => void;
}) {
    const { t } = useTranslate();
    const footprintId = useId();
    const url = pitThumbnailUrl(variant.fileId);
    const footprint = t("frontEnsemble.footprint", {
        width: meters(variant.footprint.width),
        depth: meters(variant.footprint.depth),
    });
    const name = variantName ? `${familyName} · ${variantName}` : familyName;
    return (
        <button
            type="button"
            onClick={onPick}
            title={`${name}\n${footprint}`}
            aria-label={
                isDefault ? `${name} ${t("frontEnsemble.default")}` : name
            }
            aria-describedby={footprintId}
            className="rounded-6 hover:border-accent/60 focus-visible:outline-accent group flex min-w-0 flex-col gap-4 border border-transparent p-2 text-left outline-hidden duration-150 ease-out focus-visible:outline-2"
        >
            <span className="rounded-4 relative block aspect-[4/3] overflow-hidden bg-white">
                {url && (
                    <img
                        src={url}
                        alt=""
                        draggable={false}
                        loading="lazy"
                        className="h-full w-full object-contain"
                    />
                )}
                {isDefault && (
                    <span className="bg-accent absolute top-4 right-4 size-6 rounded-full" />
                )}
            </span>
            <span className="text-sub text-text min-w-0 truncate px-2 leading-tight font-medium">
                {familyName}
            </span>
            {variantName && (
                <span className="text-sub text-text-subtitle line-clamp-2 min-w-0 px-2 leading-tight">
                    {variantName}
                </span>
            )}
            <span id={footprintId} className="sr-only">
                {footprint}
            </span>
        </button>
    );
}
