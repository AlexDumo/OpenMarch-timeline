import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    allMarchersQueryOptions,
    allMarcherRowsQueryOptions,
    allTagsQueryOptions,
    marcherIdsForAllTagIdsQueryOptions,
} from "@/hooks/queries";
import { useUnlockedOnly } from "@/items/lockedItems";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import {
    allFamilies,
    drillPrefixesOf,
    idsInFamily,
    idsInSameSections,
    idsInSections,
    idsWithDrillPrefix,
    sectionsOf,
    selectionWith,
} from "./selectBy";

/**
 * The groups a selection can be picked by, and picking one: what the Select tab's "Select by"
 * and the field menu's Select submenu both list and run. Sections, tags and drill prefixes take
 * props too (props epic, fork #1239), never a locked item; families are the performers'.
 * `add` adds the group to the selection instead of replacing it (Shift, or Add on a tablet).
 */
export function useSelectBy() {
    const { data: marchers, isSuccess: loaded } = useQuery(
        allMarchersQueryOptions(),
    );
    const { data: rows } = useQuery(allMarcherRowsQueryOptions());
    const unlocked = useUnlockedOnly(rows ?? marchers);
    const { data: tagList, isSuccess: tagsLoaded } = useQuery(
        allTagsQueryOptions(),
    );
    const { data: tagMembers, isSuccess: tagMembersLoaded } = useQuery(
        marcherIdsForAllTagIdsQueryOptions(),
    );
    const selection = useSelectedMarchers();

    const selectIds = useCallback(
        (ids: readonly number[], add: boolean) => {
            if (!selection) return;
            selection.setSelectedMarchers(
                selectionWith(
                    rows ?? marchers ?? [],
                    selection.selectedMarchers,
                    ids,
                    add,
                ),
            );
        },
        [marchers, rows, selection],
    );

    return useMemo(() => {
        const performers = marchers ?? [];
        return {
            loaded,
            /** Who can be selected by section, tag or prefix (unlocked rows, props included) */
            unlocked,
            sections: sectionsOf(unlocked),
            families: allFamilies(),
            tags: tagsLoaded && tagMembersLoaded ? (tagList ?? []) : [],
            drillPrefixes: drillPrefixesOf(unlocked),
            selectIds,
            selectSection: (name: string, add: boolean) =>
                selectIds(idsInSections(unlocked, new Set([name])), add),
            selectFamily: (family: string, add: boolean) =>
                selectIds(idsInFamily(performers, family), add),
            /** False when the tag's performers aren't known yet */
            selectTag: (tagId: number, add: boolean) => {
                const ids = tagMembersLoaded
                    ? tagMembers.get(tagId)
                    : undefined;
                if (ids == null) return false;
                selectIds(ids, add);
                return true;
            },
            selectDrillPrefix: (prefix: string, add: boolean) =>
                selectIds(idsWithDrillPrefix(unlocked, prefix), add),
            /** Everyone in the selected performers' sections (Select same section) */
            sameSectionIds: () =>
                idsInSameSections(
                    unlocked,
                    (selection?.selectedMarchers ?? []).map((m) => m.id),
                ),
        };
    }, [
        loaded,
        marchers,
        unlocked,
        tagList,
        tagsLoaded,
        tagMembers,
        tagMembersLoaded,
        selectIds,
        selection,
    ]);
}

export type SelectBy = ReturnType<typeof useSelectBy>;
