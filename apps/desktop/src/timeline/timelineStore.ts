import { useMemo } from "react";
import { create } from "zustand";
import type {
    Beat,
    Diagnostic,
    Explanation,
    Resolver,
    XY,
} from "@openmarch/core";
import { withTimelineWriteLock } from "@/db-functions/history";
import {
    subscribeTimelineChanges,
    type TimelineChangeEvent,
} from "@/db-functions/timelineChanges";
import type { DbConnection } from "@/db-functions/types";
import {
    applyTimelineBatch,
    createTimelineHost,
    type TimelineHost,
} from "./timelineHost";
import { readTimelineTables } from "./timelineRows";

/**
 * The resolver store for the open file (docs/timeline/phases/05-rendering.md P5.3, ADR 0001 §4
 * and §5).
 *
 * While started, it cold-builds the resolver from the tables, applies each committed batch from
 * `subscribeTimelineChanges` (mirror first, then `resolver.notify`), and cold-builds again on
 * `reset` or when applying a batch fails. It runs only while the file's timeline dev flag is on;
 * see `TimelineResolverHost`.
 */

export type TimelineResolverStatus = "off" | "loading" | "ready" | "error";

export interface TimelineResolverState {
    status: TimelineResolverStatus;
    /** The current resolver, or null before the first cold build finishes */
    resolver: Resolver | null;
    /** Increments whenever the resolver's answers may have changed */
    version: number;
    /** Why the last cold build failed, when `status` is "error" */
    error: unknown;
}

const initialState: TimelineResolverState = {
    status: "off",
    resolver: null,
    version: 0,
    error: null,
};

export const useTimelineResolverStore = create<TimelineResolverState>(
    () => initialState,
);

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

interface Session {
    db: DbConnection;
    unsubscribe: () => void;
    /** Null while a cold build is pending; batches until then are part of its read */
    host: TimelineHost | null;
    /** The most recently requested cold build; an older one that finishes late is dropped */
    build: number;
    /** Settles when the most recently requested cold build has finished */
    pending: Promise<void>;
}

let session: Session | null = null;

/** The host of the running session, for tests and debug checks. */
export function getTimelineHost(): TimelineHost | null {
    return session?.host ?? null;
}

/**
 * Starts the resolver for `db`: subscribes to timeline changes, then cold-builds. Starting again
 * replaces the running session.
 *
 * @returns a promise that settles when the first cold build has finished (or failed)
 */
export function startTimelineResolver(db: DbConnection): Promise<void> {
    stopTimelineResolver();
    const s: Session = {
        db,
        unsubscribe: () => {},
        host: null,
        build: 0,
        pending: Promise.resolve(),
    };
    session = s;
    s.unsubscribe = subscribeTimelineChanges((event) => onChange(s, event));
    useTimelineResolverStore.setState({ ...initialState, status: "loading" });
    return coldBuild(s);
}

/** Stops the resolver and clears the store. Does nothing when it isn't running. */
export function stopTimelineResolver(): void {
    if (!session) return;
    session.unsubscribe();
    session = null;
    useTimelineResolverStore.setState(initialState);
}

/** Whether a resolver session is running. */
export function isTimelineResolverRunning(): boolean {
    return session !== null;
}

/** Settles once no cold build is pending, including ones requested while waiting. */
export async function timelineResolverSettled(): Promise<void> {
    let seen: Promise<void> | undefined;
    while (session && session.pending !== seen) {
        seen = session.pending;
        await seen;
    }
}

function onChange(s: Session, event: TimelineChangeEvent): void {
    if (session !== s) return;
    if (event.kind === "reset") {
        void coldBuild(s);
        return;
    }
    // No host yet: the pending cold build reads under the write lock, which this batch's write
    // held when it was delivered, so the build's read already includes it.
    if (!s.host) return;
    try {
        applyTimelineBatch(s.host, event.batch);
    } catch (error) {
        // The host treats its own failure as a reset (ADR 0001 §5)
        console.error("The timeline resolver failed to apply a batch", error);
        void coldBuild(s);
        return;
    }
    bumpVersion();
}

function bumpVersion(): void {
    useTimelineResolverStore.setState((state) => ({
        version: state.version + 1,
    }));
}

/**
 * Discards the host and builds a new one from the tables. The read runs under the write lock, so
 * it holds every batch delivered before it and none after (the batches after it are applied).
 */
function coldBuild(s: Session): Promise<void> {
    const build = ++s.build;
    s.pending = runColdBuild(s, build);
    return s.pending;
}

async function runColdBuild(s: Session, build: number): Promise<void> {
    s.host = null;
    try {
        const host = await withTimelineWriteLock(async () => {
            const tables = await readTimelineTables(s.db);
            if (session !== s || build !== s.build) return null;
            const built = createTimelineHost(tables);
            // Installed before the lock is released, so no batch falls between the read and
            // the host that must apply it
            s.host = built;
            return built;
        });
        // A newer build or a stop since the read: that one decides what the store shows
        if (!host || session !== s || build !== s.build) return;
        useTimelineResolverStore.setState((state) => ({
            status: "ready",
            resolver: host.resolver,
            version: state.version + 1,
            error: null,
        }));
    } catch (error) {
        if (session !== s || build !== s.build) return;
        console.error("The timeline resolver failed to build", error);
        useTimelineResolverStore.setState((state) => ({
            status: "error",
            resolver: null,
            version: state.version + 1,
            error,
        }));
    }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Whether `marcherId` is one of the resolver's marchers (`marcherIds()` is sorted). */
function hasMarcher(resolver: Resolver, marcherId: number): boolean {
    const ids = resolver.marcherIds();
    let lo = 0;
    let hi = ids.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const id = ids[mid]!;
        if (id === marcherId) return true;
        if (id < marcherId) lo = mid + 1;
        else hi = mid - 1;
    }
    return false;
}

/**
 * For the render loop: fills `out` with every marcher's position at `beat`, as x, y pairs in
 * `timelineMarcherIds()` order, without allocating.
 *
 * @returns false, leaving `out` untouched, when no resolver is ready
 */
export function positionsAt(beat: Beat, out: Float64Array): boolean {
    const { resolver } = useTimelineResolverStore.getState();
    if (!resolver) return false;
    resolver.positionsAt(beat, out);
    return true;
}

/** The marcher order of `positionsAt`: ids ascending. Empty when no resolver is ready. */
export function timelineMarcherIds(): readonly number[] {
    return useTimelineResolverStore.getState().resolver?.marcherIds() ?? [];
}

/** A marcher's position at a beat, or null when there's no resolver or no such marcher. */
export function usePositionAt(marcherId: number, beat: Beat): XY | null {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);
    return useMemo(() => {
        void version; // a new version means new answers
        if (!resolver || !hasMarcher(resolver, marcherId)) return null;
        return resolver.positionAt(marcherId, beat);
    }, [resolver, version, marcherId, beat]);
}

/** Why a marcher is where it is at a beat, or null when there's no resolver or no such marcher. */
export function useExplain(marcherId: number, beat: Beat): Explanation | null {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);
    return useMemo(() => {
        void version;
        if (!resolver || !hasMarcher(resolver, marcherId)) return null;
        return resolver.explain(marcherId, beat);
    }, [resolver, version, marcherId, beat]);
}

const noDiagnostics: Diagnostic[] = [];

/** The show's current diagnostics; empty when no resolver is ready. */
export function useDiagnostics(): Diagnostic[] {
    const resolver = useTimelineResolverStore((s) => s.resolver);
    const version = useTimelineResolverStore((s) => s.version);
    return useMemo(() => {
        void version;
        return resolver ? resolver.diagnostics() : noDiagnostics;
    }, [resolver, version]);
}
