import { useMemo } from "react";
import type { FieldProperties } from "@openmarch/core";
import type { MinMaxStepSizes, StepSize } from "@/global/classes/StepSize";
import { useTimelineResolverStore } from "./timelineStore";
import {
    timelineMinMaxStepSizes,
    timelineStepSize,
    type PathPage,
} from "./timelinePaths";

/**
 * The inspector's step sizes in timeline mode (docs/timeline/phases/07-page-parity.md P7.10),
 * from the resolver between the previous page's end beat and the selected page's: one marcher's
 * step size when one is selected, the smallest and largest when several are. Both are undefined
 * when `enabled` is false, so page mode keeps its own values, and where page mode has none (the
 * first page, or no resolver yet).
 */
export function useTimelineStepSizes({
    enabled,
    marcherIds,
    page,
    previousPage,
    fieldProperties,
}: {
    enabled: boolean;
    marcherIds: readonly number[];
    page: PathPage | null | undefined;
    previousPage: PathPage | null | undefined;
    fieldProperties: FieldProperties | undefined;
}): { stepSize: StepSize | undefined; minMax: MinMaxStepSizes | undefined } {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);

    return useMemo(() => {
        if (!enabled || !resolver || !page || !fieldProperties)
            return { stepSize: undefined, minMax: undefined };
        if (marcherIds.length === 1)
            return {
                stepSize: timelineStepSize({
                    resolver,
                    marcherId: marcherIds[0]!,
                    page,
                    previousPage,
                    fieldProperties,
                }),
                minMax: undefined,
            };
        if (marcherIds.length > 1 && previousPage)
            return {
                stepSize: undefined,
                minMax: timelineMinMaxStepSizes({
                    resolver,
                    marcherIds,
                    page,
                    previousPage,
                    fieldProperties,
                }),
            };
        return { stepSize: undefined, minMax: undefined };
        // `version` changes whenever the resolver's answers may have
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        enabled,
        resolver,
        version,
        marcherIds,
        page,
        previousPage,
        fieldProperties,
    ]);
}
