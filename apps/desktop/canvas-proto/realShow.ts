/**
 * PROTOTYPE. Opens a .dots file in the browser (sql.js, via the 3D preview's
 * host) and turns it into a ShowSource: the same timeline resolver, beats and
 * pages the editor uses, so positions match the real canvas.
 */
import type { UseQueryResult } from "@tanstack/react-query";
import { queryClient } from "@/App";
import { db } from "@/global/database/db";
import { getMarchers } from "@/db-functions/marcher";
import { fieldPropertiesQueryOptions } from "@/hooks/queries/useFieldProperties";
import {
    allDatabaseBeatsQueryOptions,
    allDatabaseMeasuresQueryOptions,
    allDatabasePagesQueryOptions,
    getUtilityQueryOptions,
} from "@/hooks/queries";
import { workspaceSettingsQueryOptions } from "@/hooks/queries/useWorkspaceSettings";
import { _combineTimingObjects } from "@/hooks/useTimingObjects";
import { acquireExportResolver } from "@/timeline/timelineExport";
import { beatAtTime } from "@/timeline/timeMap";
import { host } from "../view3d-web/host";
import type { ShowSource } from "./source";

const ok = <T>(data: T) => ({ data, isLoading: false, isError: false }) as UseQueryResult<T>;

export async function loadDotsShow(
    bytes: Uint8Array,
    name: string,
): Promise<ShowSource> {
    window.view3d = host.api;
    await host.open(bytes, name);
    queryClient.clear();

    const [field, pages, measures, beats, utility, settings, resolver, marchers] =
        await Promise.all([
            queryClient.fetchQuery(fieldPropertiesQueryOptions()),
            queryClient.fetchQuery(allDatabasePagesQueryOptions(true)),
            queryClient.fetchQuery(allDatabaseMeasuresQueryOptions(true)),
            queryClient.fetchQuery(allDatabaseBeatsQueryOptions(true)),
            queryClient.fetchQuery(getUtilityQueryOptions(true)),
            queryClient.fetchQuery(workspaceSettingsQueryOptions(true)),
            acquireExportResolver(db),
            getMarchers({ db }),
        ]);
    const timing = _combineTimingObjects([
        ok(pages),
        ok(measures),
        ok(beats),
        ok(utility),
        ok(settings),
    ] as any);

    const ids = resolver.marcherIds();
    const byId = new Map(marchers.map((m) => [m.id, m]));
    const labels = ids.map((id) => {
        const m = byId.get(id);
        return m ? `${m.drill_prefix}${m.drill_order}` : `?${id}`;
    });
    const sections = ids.map((id) => byId.get(id)?.section ?? "");
    const showPages = [...timing.pages]
        .sort((a, b) => a.order - b.order)
        .map((p) => ({
            name: p.name,
            // A page's positions are where its movement ends.
            timeMs: (p.timestamp + p.duration) * 1000,
        }));
    const beatTimings = timing.beats;
    const durationMs = showPages.length
        ? showPages[showPages.length - 1].timeMs
        : 0;

    return {
        name,
        field,
        count: ids.length,
        labels,
        sections,
        pages: showPages,
        durationMs,
        positionsAt(ms, out) {
            resolver.positionsAt(beatAtTime(beatTimings, ms / 1000), out);
        },
    };
}

export async function fetchDemo(file: string): Promise<Uint8Array> {
    const response = await fetch(file);
    if (!response.ok) throw new Error(`${file}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
}
