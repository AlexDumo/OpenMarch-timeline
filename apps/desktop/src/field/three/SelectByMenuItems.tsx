import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useTranslate } from "@tolgee/react";
import { tagDisplayName } from "@/components/tags/tagDisplayName";
import { MENU_ITEM_CLASS } from "@/components/ui/popupClasses";
import { useSelectBy } from "@/selection/useSelectBy";
import { isShiftHeld } from "@/stores/TouchModifierStore";

/**
 * Whether the pick that chose a Select entry adds to the selection, as in the Select tab: Shift
 * on the click or on Enter, or Add latched on the touch pill. Radix runs an entry's `onSelect`
 * after its own click (a key's pick clicks it too), so the modifiers are noted on the way.
 */
const pick = { key: false, click: false };
export const addPickProps = {
    onKeyDown: (event: React.KeyboardEvent) => {
        pick.key =
            event.shiftKey && (event.key === "Enter" || event.key === " ");
    },
    onClick: (event: React.MouseEvent) => {
        pick.click = isShiftHeld(event);
    },
};
/** Whether the last pick adds (`addPickProps`); reads it once */
export const pickAdds = (): boolean => {
    const add = pick.key || pick.click || isShiftHeld();
    pick.key = false;
    pick.click = false;
    return add;
};

/**
 * One list of the field menu's Select submenu: the Select tab's "Select by" groups (sections,
 * families or tags), each picked as the tab picks it (`useSelectBy`). Mounted only while its
 * submenu is open.
 */
export default function SelectByMenuItems({
    by,
}: {
    by: "section" | "family" | "tag";
}) {
    const { t } = useTranslate();
    const select = useSelectBy();
    const testId = (id: string | number) => `field-menu-select-${by}-${id}`;
    const note = (key: string) => (
        <div
            data-testid={`field-menu-select-${by}-none`}
            className="text-sub text-text-subtitle px-8 py-4 italic"
        >
            {t(key)}
        </div>
    );
    const item = (id: string | number, label: string, run: () => void) => (
        <DropdownMenu.Item
            key={id}
            data-testid={testId(id)}
            {...addPickProps}
            onSelect={run}
            className={MENU_ITEM_CLASS}
        >
            {label}
        </DropdownMenu.Item>
    );

    if (by === "section")
        return select.sections.length === 0
            ? note("toolbar.select.noSectionsToSelect")
            : select.sections.map((section) =>
                  item(section.name, t(section.tName), () =>
                      select.selectSection(section.name, pickAdds()),
                  ),
              );
    if (by === "family")
        return select.families.map((family) =>
            item(family.name, t(family.tName), () =>
                select.selectFamily(family.name, pickAdds()),
            ),
        );
    return select.tags.length === 0
        ? note("toolbar.select.noTagsToSelect")
        : select.tags.map((tag) =>
              item(
                  tag.id,
                  tagDisplayName({ tag_id: tag.id, name: tag.name }, t),
                  () => select.selectTag(tag.id, pickAdds()),
              ),
          );
}
