/**
 * Presence in a collaboration session (REPORT.md, "No claims in v1. Presence plus conflict
 * feedback"; a port of the prototype's `sendPresence`, `fieldOverlays` and `timelineOverlays`):
 *
 * - `usePublishPresence` reads this window's marcher selection, playhead and loop (read-only
 *   subscriptions to the stores the app already has) and publishes them, throttled;
 * - `SyncPeopleList` lists everyone else with their page, count and selection, and a "Go to";
 * - `SyncFieldPresence` rings other people's selected marchers on the field (SVG, over the
 *   WebGL field, from the field's drawn positions);
 * - `SyncTimelinePresence` draws other people's playhead lines on the timeline.
 *
 * Presence is relayed by the server and never stored.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useSelectedMarchers } from "@/context/SelectedMarchersContext";
import { useTimelineSelectionStore } from "@/stores/TimelineSelectionStore";
import { useTimingObjects } from "@/hooks/useTimingObjects";
import { pageAtPlayhead } from "@/timeline/timelinePlayhead";
import { createTimelineBeatAxis } from "@/timeline/timelineViewModel";
import { beatToX } from "@/components/timeline/TimelineGeometry";
import type { FieldMarchers } from "@/field/three/fieldMarchers";
import { fieldToElement, useFieldViewStore } from "@/field/three/fieldView";
import { ringReach } from "@/field/three/selectionRing";
import { setSyncPresence, useSyncStore } from "./connection";
import type { SyncUser } from "./types";

/** What one window tells the others. Spec beats. */
export interface SyncPresence {
    selection: number[];
    playhead: number;
    loop: { start: number; end: number } | null;
}

const MAX_SELECTION = 500;

/** Publishes this window's selection, playhead and loop while in a session. */
export function usePublishPresence(): void {
    const state = useSyncStore((s) => s.state);
    const selected = useSelectedMarchers()?.selectedMarchers;
    const playhead = useTimelineSelectionStore((s) => s.playheadBeat);
    const loop = useTimelineSelectionStore((s) => s.loop);
    useEffect(() => {
        if (state !== "live") return;
        const presence: SyncPresence = {
            selection: (selected ?? [])
                .map((m) => m.id)
                .slice(0, MAX_SELECTION),
            playhead,
            loop: loop ? { start: loop.start, end: loop.end } : null,
        };
        setSyncPresence(presence);
    }, [state, selected, playhead, loop]);
}

interface Peer {
    user: SyncUser;
    presence: SyncPresence | null;
}

const asPresence = (value: unknown): SyncPresence | null => {
    const p = value as Partial<SyncPresence> | null;
    if (!p || typeof p.playhead !== "number") return null;
    return {
        selection: Array.isArray(p.selection) ? p.selection : [],
        playhead: p.playhead,
        loop: p.loop ?? null,
    };
};

/** Everyone in the session but me. */
export function useOthers(): Peer[] {
    const people = useSyncStore((s) => s.people);
    const me = useSyncStore((s) => s.userId);
    return useMemo(
        () =>
            people
                .filter((p) => p.user.id !== me)
                .map((p) => ({
                    user: p.user,
                    presence: asPresence(p.presence),
                })),
        [people, me],
    );
}

/** Moves my playhead to theirs (and my loop to theirs, if they have one). */
export function goToPeer(peer: Peer): void {
    const presence = peer.presence;
    if (!presence) return;
    const store = useTimelineSelectionStore.getState();
    store.seek(presence.playhead);
    if (presence.loop) store.setLoop(presence.loop);
}

/** The people list, for the status chip's popover. */
export function SyncPeopleList() {
    const others = useOthers();
    const { pages } = useTimingObjects();
    if (others.length === 0)
        return (
            <p className="text-sub text-text-subtitle">Nobody else is here</p>
        );
    return (
        <ul className="flex flex-col gap-6" data-testid="sync-people">
            {others.map((peer) => {
                const p = peer.presence;
                const page = p ? pageAtPlayhead(pages ?? [], p.playhead) : null;
                const bits = p
                    ? [
                          `${page?.name ? `page ${page.name}` : "no page"}`,
                          `count ${Math.round(p.playhead)}`,
                          `${p.selection.length} selected`,
                      ]
                    : ["just joined"];
                return (
                    <li
                        key={peer.user.id}
                        data-testid="sync-person"
                        data-user-name={peer.user.name}
                        className="text-sub flex items-center gap-8"
                    >
                        <span
                            className="h-8 w-8 rounded-full"
                            style={{ background: peer.user.color }}
                        />
                        <span className="text-text">{peer.user.name}</span>
                        <span
                            className="text-text-subtitle"
                            data-testid="sync-person-where"
                        >
                            {bits.join(" · ")}
                        </span>
                        <button
                            type="button"
                            disabled={!p}
                            className="text-accent ml-auto underline"
                            onClick={() => goToPeer(peer)}
                        >
                            Go to
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

/** Rings, in the SVG over the field, around the marchers other people have selected. */
export function SyncFieldPresence({ marchers }: { marchers: FieldMarchers }) {
    const others = useOthers();
    const view = useFieldViewStore();
    // Where each peer's selected marchers are drawn, as a string so the snapshot is stable
    const drawn = useSyncExternalStore(marchers.subscribe, () => {
        if (others.length === 0) return "[]";
        const index = new Map<number, number>();
        marchers.ids.forEach((id, i) => index.set(id, i));
        const out: { peer: number; id: number; x: number; y: number }[] = [];
        others.forEach((peer, peerIndex) => {
            for (const id of peer.presence?.selection ?? []) {
                const i = index.get(id);
                if (i === undefined || marchers.hidden?.[i]) continue;
                out.push({
                    peer: peerIndex,
                    id,
                    x: marchers.positions[i * 2],
                    y: marchers.positions[i * 2 + 1],
                });
            }
        });
        return JSON.stringify(out);
    });
    const rings = JSON.parse(drawn) as {
        peer: number;
        id: number;
        x: number;
        y: number;
    }[];
    if (rings.length === 0) return null;
    const reach = ringReach(view.zoom) * view.zoom;
    return (
        <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            data-testid="sync-field-presence"
        >
            {rings.map(({ peer, id, x, y }) => {
                const at = fieldToElement(view, x, y);
                const user = others[peer]!.user;
                return (
                    <circle
                        key={`${user.id}:${id}`}
                        data-testid="sync-presence-ring"
                        data-marcher-id={id}
                        data-user-name={user.name}
                        cx={at.x}
                        cy={at.y}
                        r={reach + 3 + 3 * peer}
                        fill="none"
                        stroke={user.color}
                        strokeWidth={2}
                        strokeDasharray="5 3"
                    />
                );
            })}
        </svg>
    );
}

/** Other people's playhead lines on the timeline, as dashed lines in their colors. */
export function SyncTimelinePresence({
    pixelsPerBeat,
    height,
}: {
    pixelsPerBeat: number;
    height: number;
}) {
    const others = useOthers();
    const { beats } = useTimingObjects();
    const axis = useMemo(() => createTimelineBeatAxis(beats ?? []), [beats]);
    return (
        <>
            {others.map((peer) => {
                if (!peer.presence) return null;
                const left = Math.round(
                    beatToX(axis.toView(peer.presence.playhead), pixelsPerBeat),
                );
                return (
                    <div
                        key={peer.user.id}
                        data-testid="sync-presence-playhead"
                        data-user-name={peer.user.name}
                        data-beat={peer.presence.playhead}
                        className="pointer-events-none absolute top-0"
                        style={{
                            left,
                            height,
                            borderLeft: `2px dashed ${peer.user.color}`,
                        }}
                    >
                        <span
                            className="rounded-4 absolute top-0 left-2 px-4 text-[10px] font-semibold whitespace-nowrap text-black"
                            style={{ background: peer.user.color }}
                        >
                            {peer.user.name}
                        </span>
                    </div>
                );
            })}
        </>
    );
}
