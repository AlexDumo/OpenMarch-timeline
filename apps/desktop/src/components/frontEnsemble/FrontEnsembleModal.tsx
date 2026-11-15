import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PianoKeysIcon } from "@phosphor-icons/react";
import { T, useTranslate } from "@tolgee/react";
import { SidebarModalLauncher } from "@/components/sidebar/SidebarModal";
import ItemPanelHeader from "@/components/items/ItemPanelHeader";
import { ItemEditor } from "@/components/items/ItemEditor";
import {
    ItemRow,
    ShowNamesSwitch,
    type ItemWithMarcher,
} from "@/components/items/ItemRows";
import { useSidebarModalStore } from "@/stores/SidebarModalStore";
import { allItemsQueryOptions } from "@/hooks/queries/useItems";
import { isPodiumFamily, pitVariant } from "@/view3d/core/pit/catalog";
import FrontEnsemblePicker from "./FrontEnsemblePicker";
import { usePitVariantLabel } from "./usePitVariantLabel";

/** The sidebar panel's id, for its launcher and the views it switches between */
export const FRONT_ENSEMBLE_PANEL_ID = "front-ensemble";

/** Whether an item is a podium from the catalog: listed apart from the pit equipment */
const isPodiumItem = (item: ItemWithMarcher) => {
    const variant = pitVariant(item.model);
    return variant !== null && isPodiumFamily(variant.family);
};

/** The front ensemble's items, split into the pit equipment and the podiums */
export function splitFrontEnsemble(
    items: readonly ItemWithMarcher[] | undefined,
): { equipment: ItemWithMarcher[]; podiums: ItemWithMarcher[] } {
    const placed = (items ?? []).filter((item) => item.kind === "equipment");
    return {
        equipment: placed.filter((item) => !isPodiumItem(item)),
        podiums: placed.filter(isPodiumItem),
    };
}

/**
 * The front ensemble (instruments.md §6): its presets, the catalog to place one piece from, and
 * the equipment and podiums in the show, each with its edit view. They're stored as items like
 * props, but have their own panel: they don't move and aren't part of the staging.
 */
export default function FrontEnsembleModal() {
    const { t } = useTranslate();
    return (
        <SidebarModalLauncher
            name={t("sidebar.frontEnsemble")}
            contents={<FrontEnsembleContents />}
            newContentId={FRONT_ENSEMBLE_PANEL_ID}
            buttonLabel={<PianoKeysIcon size={24} />}
        />
    );
}

export function FrontEnsembleContents() {
    const { setContent } = useSidebarModalStore();
    const { data: items } = useQuery(allItemsQueryOptions());
    const { equipment, podiums } = useMemo(
        () => splitFrontEnsemble(items),
        [items],
    );
    const onEdit = (item: ItemWithMarcher) =>
        setContent(
            <FrontEnsembleEditContents itemId={item.id} />,
            FRONT_ENSEMBLE_PANEL_ID,
        );
    return (
        <div className="animate-scale-in text-text flex h-full w-fit flex-col gap-16">
            <ItemPanelHeader title={<T keyName="frontEnsemble.title" />} />
            <div className="flex w-[28rem] grow flex-col gap-16 overflow-y-auto">
                <FrontEnsemblePicker
                    hasEquipment={equipment.length + podiums.length > 0}
                />
                <div className="border-stroke border-t pt-12">
                    {equipment.length + podiums.length === 0 ? (
                        <p className="text-text/50 py-16 text-center">
                            <T keyName="frontEnsemble.empty" />
                        </p>
                    ) : (
                        <div className="flex flex-col gap-16">
                            <ShowNamesSwitch
                                items={[...equipment, ...podiums]}
                            />
                            <EquipmentGroup
                                titleKey="frontEnsemble.list.equipment"
                                items={equipment}
                                onEdit={onEdit}
                            />
                            <EquipmentGroup
                                titleKey="frontEnsemble.list.podiums"
                                items={podiums}
                                onEdit={onEdit}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/** One group of the panel's list, under its heading; nothing when it's empty */
function EquipmentGroup({
    titleKey,
    items,
    onEdit,
}: {
    titleKey: "frontEnsemble.list.equipment" | "frontEnsemble.list.podiums";
    items: readonly ItemWithMarcher[];
    onEdit: (item: ItemWithMarcher) => void;
}) {
    const { t } = useTranslate();
    const variantLabel = usePitVariantLabel();
    if (items.length === 0) return null;
    const podium = titleKey === "frontEnsemble.list.podiums";
    const subtitle = (item: ItemWithMarcher) => {
        const variant = pitVariant(item.model);
        if (!variant) return t("frontEnsemble.equipment.block");
        const family = t(`pit.family.${variant.family}`);
        return variant.label.length > 0
            ? `${family} · ${variantLabel(variant)}`
            : family;
    };
    return (
        <section className="flex flex-col gap-8" aria-label={t(titleKey)}>
            <h5 className="text-sub text-text-subtitle px-4 font-medium tracking-wide uppercase">
                {t(titleKey)}
            </h5>
            {items.map((item) => (
                <ItemRow
                    key={item.id}
                    item={item}
                    subtitle={subtitle(item)}
                    editLabel={t(
                        podium
                            ? "frontEnsemble.podium.edit"
                            : "frontEnsemble.equipment.edit",
                    )}
                    deleteLabel={t(
                        podium
                            ? "frontEnsemble.podium.delete"
                            : "frontEnsemble.equipment.delete",
                    )}
                    onEdit={onEdit}
                />
            ))}
        </section>
    );
}

/** A piece of equipment's or a podium's edit view: its name, model, lock and Outline */
export function FrontEnsembleEditContents({ itemId }: { itemId: number }) {
    const { setContent } = useSidebarModalStore();
    const { data: items } = useQuery(allItemsQueryOptions());
    const item = items?.find((i) => i.id === itemId);
    return (
        <div className="animate-scale-in text-text flex h-full w-fit flex-col gap-16">
            <ItemPanelHeader
                title={
                    item && isPodiumItem(item) ? (
                        <T keyName="frontEnsemble.podium.editTitle" />
                    ) : (
                        <T keyName="frontEnsemble.equipment.editTitle" />
                    )
                }
                onBack={() =>
                    setContent(
                        <FrontEnsembleContents />,
                        FRONT_ENSEMBLE_PANEL_ID,
                    )
                }
            />
            <div className="flex w-[28rem] grow flex-col gap-16 overflow-y-auto">
                <ItemEditor itemId={itemId} />
            </div>
        </div>
    );
}
