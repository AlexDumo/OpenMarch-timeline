import { useState } from "react";
import * as RadixCollapsible from "@radix-ui/react-collapsible";
import {
    BellSimpleIcon,
    CaretDownIcon,
    CaretLeftIcon,
    CaretRightIcon,
    CylinderIcon,
    DiscIcon,
    FadersIcon,
    LadderIcon,
    LadderSimpleIcon,
    PianoKeysIcon,
    RowsIcon,
    SpeakerHifiIcon,
    SquaresFourIcon,
    StairsIcon,
    StepsIcon,
} from "@phosphor-icons/react";
import { T, useTranslate } from "@tolgee/react";
import { MENU_BUTTON_CLASS } from "@/components/ui/popupClasses";
import { useItemDrawingStore } from "@/stores/ItemDrawingStore";
import { useSidebarModalStore } from "@/stores/SidebarModalStore";
import PitPresets from "./PitPresets";
import {
    PIT_FAMILIES,
    defaultPitVariant,
    pitVariantsOf,
    type PitFamily,
    type PitFamilyId,
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

const FAMILY_ICONS: Record<PitFamilyId, React.ReactNode> = {
    marimba: <PianoKeysIcon size={16} />,
    vibraphone: <PianoKeysIcon size={16} />,
    xylophone: <PianoKeysIcon size={16} />,
    glockenspiel: <PianoKeysIcon size={16} />,
    synth: <PianoKeysIcon size={16} />,
    drumSet: <CylinderIcon size={16} />,
    auxRack: <RowsIcon size={16} />,
    timpani: <CylinderIcon size={16} />,
    chimes: <BellSimpleIcon size={16} />,
    gong: <DiscIcon size={16} />,
    congas: <CylinderIcon size={16} />,
    bongos: <CylinderIcon size={16} />,
    concertBassDrum: <CylinderIcon size={16} />,
    trapTable: <SquaresFourIcon size={16} />,
    speaker: <SpeakerHifiIcon size={16} />,
    mixer: <FadersIcon size={16} />,
    podium: <StairsIcon size={16} />,
    podiumStand: <StepsIcon size={16} />,
    podiumTower: <StairsIcon size={16} />,
    rollingPodium: <StairsIcon size={16} />,
    stepladder: <LadderSimpleIcon size={16} />,
    scaffold: <LadderIcon size={16} />,
};

const GROUP_HEADING_CLASS =
    "text-sub text-text-subtitle px-8 pt-8 pb-4 font-medium tracking-wide uppercase";

/** Meters, to two decimals at most */
const meters = (value: number) => String(Number(value.toFixed(2)));

/**
 * The Front ensemble panel's Add equipment (instruments.md §6): pick a family, then a variant,
 * and place it on the field with a click, as a locked equipment item named for its family
 * ("Marimba 2"). A family with one model is placed straight from the list. The families are
 * grouped, the podiums on their own. The Small, Medium and Large presets (`PitPresets`) sit above
 * the families. It starts open until the show has equipment, then folded, so the list of
 * equipment below stays in view.
 */
export default function FrontEnsemblePicker({
    hasEquipment,
}: {
    hasEquipment: boolean;
}) {
    const { t } = useTranslate();
    const [family, setFamily] = useState<PitFamily | null>(null);
    const [openChoice, setOpenChoice] = useState<boolean | null>(null);
    const open = openChoice ?? !hasEquipment;
    const placeEquipment = useItemDrawingStore((s) => s.placeEquipment);
    const { toggleOpen } = useSidebarModalStore();

    const place = (variant: PitVariant) => {
        placeEquipment({
            variant,
            baseName: t(`pit.family.${variant.family}`),
        });
        setFamily(null);
        // Close the panel to place it on the field, as drawing a prop does
        toggleOpen();
    };

    return (
        <RadixCollapsible.Root asChild open={open} onOpenChange={setOpenChoice}>
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
                    <PitPresets />
                    {family ? (
                        <VariantList
                            family={family}
                            onBack={() => setFamily(null)}
                            onPick={place}
                        />
                    ) : (
                        <FamilyList
                            onPick={(picked) => {
                                const variants = pitVariantsOf(picked.id);
                                if (variants.length === 1) place(variants[0]);
                                else setFamily(picked);
                            }}
                        />
                    )}
                </RadixCollapsible.Content>
            </section>
        </RadixCollapsible.Root>
    );
}

function FamilyList({ onPick }: { onPick: (family: PitFamily) => void }) {
    const { t } = useTranslate();
    return (
        <div className="border-stroke bg-fg-2 rounded-6 flex flex-col border p-4">
            {GROUPS.map((group) => (
                <div
                    key={group}
                    role="group"
                    aria-label={t(`frontEnsemble.groups.${group}`)}
                >
                    <div className={GROUP_HEADING_CLASS} aria-hidden>
                        {t(`frontEnsemble.groups.${group}`)}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {PIT_FAMILIES.filter((f) => f.group === group).map(
                            (family) => {
                                const many =
                                    pitVariantsOf(family.id).length > 1;
                                return (
                                    <button
                                        key={family.id}
                                        type="button"
                                        className={`${MENU_BUTTON_CLASS} text-text min-w-0`}
                                        onClick={() => onPick(family)}
                                    >
                                        <span className="text-text-subtitle flex shrink-0">
                                            {FAMILY_ICONS[family.id]}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate">
                                            {t(family.labelKey)}
                                        </span>
                                        {many && (
                                            <CaretRightIcon
                                                size={12}
                                                className="text-text-subtitle shrink-0"
                                                aria-hidden
                                            />
                                        )}
                                    </button>
                                );
                            },
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

function VariantList({
    family,
    onBack,
    onPick,
}: {
    family: PitFamily;
    onBack: () => void;
    onPick: (variant: PitVariant) => void;
}) {
    const { t } = useTranslate();
    const label = usePitVariantLabel();
    const fallback = defaultPitVariant(family.id);
    return (
        <div className="border-stroke bg-fg-2 rounded-6 flex flex-col border p-4">
            <button
                type="button"
                onClick={onBack}
                className={`${MENU_BUTTON_CLASS} text-text-subtitle hover:text-text`}
                aria-label={t("frontEnsemble.allFamilies")}
            >
                <CaretLeftIcon size={12} aria-hidden />
                <span className="text-sub font-medium tracking-wide uppercase">
                    {t(family.labelKey)}
                </span>
            </button>
            {pitVariantsOf(family.id).map((variant) => (
                <button
                    key={variant.fileId}
                    type="button"
                    className={`${MENU_BUTTON_CLASS} text-text`}
                    onClick={() => onPick(variant)}
                >
                    <span className="min-w-0 flex-1 truncate">
                        {label(variant)}
                    </span>
                    {variant === fallback && (
                        <span className="text-sub text-accent shrink-0">
                            <T keyName="frontEnsemble.default" />
                        </span>
                    )}
                    <span className="text-sub text-text-subtitle shrink-0 tabular-nums">
                        <T
                            keyName="frontEnsemble.footprint"
                            params={{
                                width: meters(variant.footprint.width),
                                depth: meters(variant.footprint.depth),
                            }}
                        />
                    </span>
                </button>
            ))}
        </div>
    );
}
