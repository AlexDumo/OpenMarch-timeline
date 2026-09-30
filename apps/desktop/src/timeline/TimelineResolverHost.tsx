import { useEffect } from "react";
import { db } from "@/global/database/db";
import type { DbConnection } from "@/db-functions/types";
import { useTimelineMode } from "@/hooks/queries/useWorkspaceSettings";
import { startTimelineResolver, stopTimelineResolver } from "./timelineStore";

/**
 * Runs the resolver session for `db` while `enabled` is true: starting it subscribes to timeline
 * changes and cold-builds; turning it off, or unmounting, unsubscribes and clears the store.
 */
export function useTimelineResolverSession(
    database: DbConnection,
    enabled: boolean,
): void {
    useEffect(() => {
        if (!enabled) return;
        void startTimelineResolver(database);
        return () => stopTimelineResolver();
    }, [database, enabled]);
}

/**
 * Runs the timeline resolver for the open file while its timeline dev flag (`timelineMode` in
 * `workspace_settings`) is on. With the flag off, nothing subscribes and nothing is built.
 */
export default function TimelineResolverHost() {
    useTimelineResolverSession(db, useTimelineMode());
    return null;
}
