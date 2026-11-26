import { getTranslatedSectionName } from "@/global/classes/Sections";
import ToolbarSection from "../ToolbarSection";
import { createContext, useContext, useEffect, useState } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { T, useTranslate } from "@tolgee/react";
import { ToggleGroup, ToggleGroupItem } from "@openmarch/ui";
import ActionButton from "@/shortcuts/ActionButton";
import { useIsTouchMode } from "@/stores/InputModeStore";
import * as Popover from "@radix-ui/react-popover";
import { tagDisplayName } from "@/components/tags/tagDisplayName";
import {
    SELECT_BY_OPTIONS,
    selectByLabelKey,
    type SelectByOption,
} from "@/selection/selectBy";
import { useSelectBy, type SelectBy } from "@/selection/useSelectBy";
import ChipSelector from "./ChipSelector";

export default function ViewTab() {
    return (
        <div className="flex w-full flex-wrap gap-8">
            <SelectTabContents />
        </div>
    );
}

/** A toolbar section showing only an "nothing to select" note: no box. */
const EMPTY_SECTION = "border-transparent bg-transparent px-4";

/**
 * Whether choosing a group replaces the selection or adds to it. With a
 * keyboard, Shift adds; in touch mode a Replace / Add switch does the same.
 */
export type SelectTapMode = "replace" | "add";
const SelectTapModeContext = createContext<SelectTapMode>("replace");

/** Whether a chip's pick adds to the selection: Shift (keyboard or on-screen), or the Add switch */
const useAdds = () => {
    const tapMode = useContext(SelectTapModeContext);
    return (options?: { shiftKey?: boolean }) =>
        Boolean(options?.shiftKey) || tapMode === "add";
};

function SelectByPopover({
    selectByOptionState,
}: {
    selectByOptionState: [
        SelectByOption,
        React.Dispatch<React.SetStateAction<SelectByOption>>,
    ];
}) {
    const [selectByOptionStateValue, setSelectByOption] = selectByOptionState;
    const [open, setOpen] = useState(false);

    return (
        <ToolbarSection>
            <Popover.Root open={open} onOpenChange={setOpen}>
                <Popover.Trigger className="hover:text-accent touch:min-h-44 flex items-center gap-6 outline-hidden duration-150 ease-out focus-visible:-translate-y-4 disabled:opacity-50">
                    <T keyName="toolbar.select.selectByText" />
                    <CaretDownIcon size={18} />
                    <span className="text-text-subtitle px-4">
                        <T
                            keyName={selectByLabelKey(selectByOptionStateValue)}
                        />
                    </span>
                </Popover.Trigger>
                <Popover.Portal>
                    <Popover.Content className="bg-modal text-text rounded-6 shadow-modal backdrop-blur-32 border-stroke z-50 m-8 flex flex-col items-start gap-0 border p-8">
                        {SELECT_BY_OPTIONS.map((option) => (
                            <button
                                key={option}
                                className="hover:text-accent touch:min-h-44 flex items-center gap-8 outline-hidden duration-150 ease-out focus-visible:-translate-y-4 disabled:opacity-50"
                                onClick={() => {
                                    setSelectByOption(option);
                                    setOpen(false);
                                }}
                            >
                                <T keyName={selectByLabelKey(option)} />
                            </button>
                        ))}
                    </Popover.Content>
                </Popover.Portal>
            </Popover.Root>
        </ToolbarSection>
    );
}

function SectionSelector({ by }: { by: SelectBy }) {
    const { t } = useTranslate();
    const adds = useAdds();
    const { sections } = by;

    return (
        <ToolbarSection
            aria-label={t("toolbar.select.sectionsLabel")}
            className={sections.length === 0 ? EMPTY_SECTION : undefined}
        >
            <ChipSelector
                items={sections}
                getId={(section) => section.name}
                getLabel={(section) => <T keyName={section.tName} />}
                getSearchText={(section) =>
                    getTranslatedSectionName(section.name, t)
                }
                onSelect={(section, options) =>
                    by.selectSection(section.name, adds(options))
                }
                emptyMessage={
                    <p className="text-sub text-text-subtitle italic">
                        <T keyName="toolbar.select.noSectionsToSelect" />
                    </p>
                }
                ariaLabel={t("toolbar.select.sectionsLabel")}
                recentCategory="section"
            />
        </ToolbarSection>
    );
}

function TagSelector({ by }: { by: SelectBy }) {
    const { t } = useTranslate();
    const adds = useAdds();
    const tagItems = by.tags;
    return (
        <ToolbarSection
            aria-label={t("toolbar.select.tagsLabel")}
            // With nothing to choose, the note is plain text, not a box that looks pressable
            className={tagItems.length === 0 ? EMPTY_SECTION : undefined}
        >
            <ChipSelector
                items={tagItems}
                getId={(tag) => tag.id}
                getLabel={(tag) =>
                    tagDisplayName({ tag_id: tag.id, name: tag.name }, t)
                }
                getSearchText={(tag) =>
                    tagDisplayName({ tag_id: tag.id, name: tag.name }, t)
                }
                onSelect={(tag, options) => {
                    if (!by.selectTag(tag.id, adds(options))) {
                        console.error(
                            `Marcher IDs for tag ${tag.id} not found`,
                        );
                        return false;
                    }
                }}
                emptyMessage={
                    <p className="text-sub text-text-subtitle italic">
                        <T keyName="toolbar.select.noTagsToSelect" />
                    </p>
                }
                ariaLabel={t("toolbar.select.tagsLabel")}
                recentCategory="tag"
            />
        </ToolbarSection>
    );
}

function DrillPrefixSelector({ by }: { by: SelectBy }) {
    const { t } = useTranslate();
    const adds = useAdds();
    const { drillPrefixes } = by;

    return (
        <ToolbarSection
            aria-label={t("toolbar.select.drillPrefixesLabel")}
            className={drillPrefixes.length === 0 ? EMPTY_SECTION : undefined}
        >
            <ChipSelector
                items={drillPrefixes}
                getId={(drillPrefix) => drillPrefix}
                getLabel={(drillPrefix) => drillPrefix}
                getSearchText={(drillPrefix) => drillPrefix}
                onSelect={(drillPrefix, options) =>
                    by.selectDrillPrefix(drillPrefix, adds(options))
                }
                emptyMessage={
                    <p className="text-sub text-text-subtitle italic">
                        <T keyName="toolbar.select.noDrillPrefixesToSelect" />
                    </p>
                }
                ariaLabel={t("toolbar.select.drillPrefixesLabel")}
                recentCategory="drillPrefix"
            />
        </ToolbarSection>
    );
}

function FamilySelector({ by }: { by: SelectBy }) {
    const { t } = useTranslate();
    const adds = useAdds();

    return (
        <ToolbarSection aria-label={t("toolbar.select.familiesLabel")}>
            <ChipSelector
                items={by.families}
                getId={(family) => family.name}
                getLabel={(family) => <T keyName={family.tName} />}
                getSearchText={(family) => t(family.tName)}
                onSelect={(family, options) =>
                    by.selectFamily(family.name, adds(options))
                }
                ariaLabel={t("toolbar.select.familiesLabel")}
            />
        </ToolbarSection>
    );
}

const SELECT_BY_STORAGE_KEY = "openmarch-select-tab-mode";

function SelectTapModeSwitch({
    value,
    onChange,
}: {
    value: SelectTapMode;
    onChange: (mode: SelectTapMode) => void;
}) {
    const { t } = useTranslate();
    return (
        <ToggleGroup
            type="single"
            value={value}
            onValueChange={(mode) => {
                if (mode) onChange(mode as SelectTapMode);
            }}
            aria-label={t("toolbar.select.tapMode.ariaLabel")}
        >
            <ToggleGroupItem value="replace" className="px-12">
                <T keyName="toolbar.select.tapMode.replace" />
            </ToggleGroupItem>
            <ToggleGroupItem value="add" className="px-12">
                <T keyName="toolbar.select.tapMode.add" />
            </ToggleGroupItem>
        </ToggleGroup>
    );
}

function SelectTabContents() {
    const by = useSelectBy();
    const isTouch = useIsTouchMode();
    const [tapModeChoice, setTapModeChoice] =
        useState<SelectTapMode>("replace");
    // The switch only shows in touch mode; with a mouse, Shift adds
    const tapMode: SelectTapMode = isTouch ? tapModeChoice : "replace";
    const [selectByOption, setSelectByOption] = useState<SelectByOption>(() => {
        const stored = localStorage.getItem(SELECT_BY_STORAGE_KEY);
        if (stored && SELECT_BY_OPTIONS.includes(stored as SelectByOption)) {
            return stored as SelectByOption;
        }
        return "section";
    });

    useEffect(() => {
        localStorage.setItem(SELECT_BY_STORAGE_KEY, selectByOption);
    }, [selectByOption]);

    if (!by.loaded) {
        return (
            <div>
                <T keyName="toolbar.select.loading" />
            </div>
        );
    }
    let Selector: React.JSX.Element;
    switch (selectByOption) {
        case "section":
            Selector = <SectionSelector by={by} />;
            break;
        case "tag":
            Selector = <TagSelector by={by} />;
            break;
        case "drillPrefix":
            Selector = <DrillPrefixSelector by={by} />;
            break;
        case "family":
            Selector = <FamilySelector by={by} />;
            break;
        default:
            // Every option has a selector above
            Selector = <></>;
            break;
    }
    return (
        <SelectTapModeContext.Provider value={tapMode}>
            <SelectByPopover
                selectByOptionState={[selectByOption, setSelectByOption]}
            />
            {isTouch && (
                <SelectTapModeSwitch
                    value={tapModeChoice}
                    onChange={setTapModeChoice}
                />
            )}
            {Selector}
            <ToolbarSection>
                <ActionButton
                    action="selectAllMarchers"
                    className="flex items-center"
                >
                    <T keyName="actions.select.selectAll" />
                </ActionButton>
            </ToolbarSection>
        </SelectTapModeContext.Provider>
    );
}
