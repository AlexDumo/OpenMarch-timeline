/**
 * Visuals mode's toolbar (performer-behavior.md section 7.1): one tab per
 * behavior channel, each with its cue count. The Horn/Equipment tab names
 * itself by who is focused: Horn for winds, Equipment for guard and
 * percussion.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { T } from "@tolgee/react";
import { Tabs, TabItem, TabsList } from "@openmarch/ui";
import { allCuesQueryOptions } from "@/hooks/queries/useCues";
import { allMarchersQueryOptions } from "@/hooks/queries/useMarchers";
import { useVisualsStore } from "@/stores/VisualsStore";
import {
    VISUALS_CHANNELS,
    cueCountsByChannel,
    hornEquipmentLabel,
    type VisualsChannel,
} from "./visualsWho";

const HORN_EQUIPMENT_KEYS = {
    horn: "visuals.channels.horn",
    equipment: "visuals.channels.equipment",
    both: "visuals.channels.hornEquipment",
} as const;

const CHANNEL_KEYS: Record<
    Exclude<VisualsChannel, "horn_equipment">,
    string
> = {
    feet: "visuals.channels.feet",
    facing: "visuals.channels.facing",
    body: "visuals.channels.body",
};

export default function VisualsToolbar() {
    const channel = useVisualsStore((s) => s.channel);
    const setChannel = useVisualsStore((s) => s.setChannel);
    const focusIds = useVisualsStore((s) => s.focusMarcherIds);
    const { data: cues } = useQuery(allCuesQueryOptions());
    const { data: marchers } = useQuery(allMarchersQueryOptions());

    const counts = useMemo(() => cueCountsByChannel(cues ?? []), [cues]);
    const hornKey = useMemo(() => {
        const focused = (marchers ?? []).filter(
            (m) => !focusIds || focusIds.has(m.id),
        );
        return HORN_EQUIPMENT_KEYS[
            hornEquipmentLabel(focused.map((m) => m.section))
        ];
    }, [marchers, focusIds]);

    return (
        <Tabs
            value={channel}
            onValueChange={(v) => setChannel(v as VisualsChannel)}
            className="flex flex-col gap-0"
        >
            <TabsList className="gap-0 border-none" data-testid="visuals-tabs">
                {VISUALS_CHANNELS.map((c) => (
                    <TabItem key={c} value={c} data-testid={`visuals-tab-${c}`}>
                        <span className="flex items-center gap-6">
                            <T
                                keyName={
                                    c === "horn_equipment"
                                        ? hornKey
                                        : CHANNEL_KEYS[c]
                                }
                            />
                            <span className="text-sub text-text-subtitle tabular-nums">
                                {counts[c]}
                            </span>
                        </span>
                    </TabItem>
                ))}
            </TabsList>
        </Tabs>
    );
}
