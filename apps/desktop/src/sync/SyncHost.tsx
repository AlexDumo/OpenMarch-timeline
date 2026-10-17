/**
 * The collaboration spike's UI, mounted once in an open show (dev only): two command-palette
 * actions, a join dialog, a status chip, a read-only banner while offline, and toasts for refused
 * ops and overwritten edits. It also hands the app's QueryClient to the connection and installs
 * `window.__sync` for scripted tests.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
    Button,
    Dialog,
    DialogContent,
    DialogTitle,
    Input,
} from "@openmarch/ui";
import { usePaletteSource } from "@/shortcuts/palette/sources";
import {
    disconnect,
    endSession,
    getSyncServerUrl,
    joinSession,
    makeCollaborative,
    reconnect,
    setSyncQueryClient,
    setSyncServerUrl,
    subscribeSyncNotices,
    syncEvents,
    syncIdle,
    syncSeq,
    syncedSnapshot,
    useSyncStore,
    type SyncConflict,
    type SyncNotice,
} from "./connection";
import { db } from "@/global/database/db";
import { putValuesBack, type LostValue } from "./undo";
import { SyncReadOnlyError } from "./session";

const SYNC_DEV_STORAGE_KEY = "openmarch:syncDev";

/** Dev builds, or any build with `localStorage['openmarch:syncDev'] = "1"`. */
export const isSyncDevEnabled = () =>
    import.meta.env.DEV || localStorage.getItem(SYNC_DEV_STORAGE_KEY) === "1";

const syncApi = {
    makeCollaborative,
    joinSession,
    disconnect,
    reconnect,
    endSession,
    idle: syncIdle,
    snapshot: syncedSnapshot,
    seq: syncSeq,
    events: () => [...syncEvents()],
    state: () => useSyncStore.getState(),
};

declare global {
    interface Window {
        /** The collaboration spike's dev and test hook (`src/sync/SyncHost.tsx`). */
        __sync?: typeof syncApi;
    }
}

const describeTable = (table: string) => table.replace(/_/g, " ");

function describeConflict(conflict: SyncConflict, cols: string[]) {
    return `${describeTable(conflict.table)} ${conflict.id} (${cols.join(", ")})`;
}

function showNotice(notice: SyncNotice) {
    if (notice.kind === "rejected")
        toast.error(
            `Your change${notice.label ? ` (${notice.label})` : ""} was refused and undone`,
            { description: notice.message },
        );
    else if (notice.kind === "dropped")
        toast.warning(
            `Connection lost: ${notice.count} unsent change${notice.count === 1 ? " was" : "s were"} undone`,
        );
    else if (notice.kind === "read-only")
        // One toast however many edits were refused (a drag refuses several)
        toast.warning("You're offline, so the show is read-only", {
            id: "sync-read-only",
            description: `"${notice.label}" was not saved. Edits work again once the session reconnects.`,
        });
    else if (notice.kind === "undo-partial")
        toast.info(
            `${notice.which === "undo" ? "Undid" : "Redid"} "${notice.label}", except what ${notice.names.join(" and ")} changed since. That was kept.`,
        );
    else if (notice.kind === "undo-refused") toast.warning(notice.message);
    else if (notice.kind === "conflict") showConflict(notice);
    else toast.error("Collaboration error", { description: notice.message });
}

function showConflict(notice: Extract<SyncNotice, { kind: "conflict" }>) {
    const { conflicts, by, mine, iLost } = notice;
    const first = conflicts[0]!;
    const what = describeConflict(
        first,
        conflicts.map((c) => c.col),
    );
    if (first.kind === "deleted-edited") {
        if (iLost)
            toast.warning(
                `${by.name} deleted ${describeTable(first.table)} ${first.id}, which you had just edited`,
            );
        else if (mine)
            toast.info(
                `You deleted ${describeTable(first.table)} ${first.id}, which ${first.loser.name} had just edited`,
            );
        return;
    }
    if (iLost) {
        const lost: LostValue[] = conflicts.flatMap((c) =>
            c.kind === "overwrite"
                ? [{ table: c.table, id: c.id, col: c.col, value: c.lostValue }]
                : [],
        );
        toast.warning(
            `${by.name} changed ${what} at the same time as you, and theirs landed last`,
            {
                duration: 15_000,
                action: {
                    label: "Put mine back",
                    onClick: () =>
                        void putValuesBack(db, lost).catch((error) => {
                            if (!(error instanceof SyncReadOnlyError))
                                toast.error("Could not put your change back", {
                                    description: String(error),
                                });
                        }),
                },
            },
        );
    } else if (mine)
        toast.info(
            `You and ${first.loser.name} changed ${what} at the same time. Yours landed last.`,
        );
}

async function runMakeCollaborative() {
    try {
        const { sessionId } = await makeCollaborative();
        toast.success("This show is now collaborative", {
            description: sessionId,
            duration: 20_000,
            action: {
                label: "Copy id",
                onClick: () => void navigator.clipboard?.writeText(sessionId),
            },
        });
    } catch (error) {
        toast.error("Could not make the show collaborative", {
            description: String(error),
        });
    }
}

function JoinDialog({ onClose }: { onClose: () => void }) {
    const [server, setServer] = useState(getSyncServerUrl());
    const [sessionId, setSessionId] = useState("");
    const [busy, setBusy] = useState(false);
    const join = async () => {
        setBusy(true);
        setSyncServerUrl(server);
        try {
            await joinSession(sessionId, server);
            toast.success("Joined the session");
            onClose();
        } catch (error) {
            toast.error("Could not join the session", {
                description: String(error),
            });
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent aria-describedby={undefined}>
                <DialogTitle>Join collaboration session (dev)</DialogTitle>
                <label className="text-sub flex flex-col gap-4">
                    Server
                    <Input
                        value={server}
                        onChange={(e) => setServer(e.target.value)}
                    />
                </label>
                <label className="text-sub flex flex-col gap-4">
                    Session id
                    <Input
                        autoFocus
                        value={sessionId}
                        data-testid="sync-join-session-id"
                        onChange={(e) => setSessionId(e.target.value)}
                    />
                </label>
                <p className="text-sub text-text-subtitle">
                    This show&apos;s contents are replaced by the
                    session&apos;s.
                </p>
                <Button
                    disabled={busy || sessionId.trim() === ""}
                    onClick={() => void join()}
                >
                    Join
                </Button>
            </DialogContent>
        </Dialog>
    );
}

function StatusChip() {
    const { state, pending, people, sessionId } = useSyncStore();
    if (state === "none") return null;
    const color =
        state === "live"
            ? "bg-green"
            : state === "connecting"
              ? "bg-yellow"
              : "bg-red";
    return (
        <button
            type="button"
            data-testid="sync-status"
            data-sync-state={state}
            data-sync-pending={pending}
            title={`Session ${sessionId}. Click to copy the id.`}
            onClick={() =>
                sessionId && void navigator.clipboard?.writeText(sessionId)
            }
            className="border-stroke bg-modal text-sub text-text fixed bottom-12 left-12 z-[400] flex items-center gap-6 rounded-full border px-10 py-4"
        >
            <span className={`h-8 w-8 rounded-full ${color}`} />
            {state}
            {pending > 0 && ` · ${pending} pending`}
            {state === "live" && ` · ${people.length} here`}
        </button>
    );
}

function ReadOnlyBanner() {
    const state = useSyncStore((s) => s.state);
    if (state !== "offline" && state !== "connecting") return null;
    return (
        <div
            data-testid="sync-readonly-banner"
            role="status"
            className="bg-yellow text-sub rounded-b-6 fixed top-0 left-1/2 z-[400] -translate-x-1/2 px-16 py-4 text-black"
        >
            {state === "offline"
                ? "Offline: the show is read-only until it reconnects"
                : "Connecting: the show is read-only for now"}
        </div>
    );
}

export default function SyncHost() {
    const queryClient = useQueryClient();
    const [joining, setJoining] = useState(false);
    const state = useSyncStore((s) => s.state);
    const enabled = isSyncDevEnabled();

    useEffect(() => {
        setSyncQueryClient(queryClient);
        return () => setSyncQueryClient(null);
    }, [queryClient]);

    useEffect(() => subscribeSyncNotices(showNotice), []);

    useEffect(() => {
        if (!enabled) return;
        window.__sync = syncApi;
        return () => {
            delete window.__sync;
        };
    }, [enabled]);

    usePaletteSource("sync-dev", () =>
        !enabled
            ? []
            : [
                  {
                      id: "sync:makeCollaborative",
                      label: "Make show collaborative (dev)",
                      group: "Collaboration",
                      keywords: ["sync", "share", "session"],
                      disabled: state !== "none",
                      run: () => void runMakeCollaborative(),
                  },
                  {
                      id: "sync:join",
                      label: "Join collaboration session (dev)",
                      group: "Collaboration",
                      keywords: ["sync", "session"],
                      disabled: state !== "none",
                      run: () => setJoining(true),
                  },
                  {
                      id: "sync:toggleConnection",
                      label:
                          state === "offline"
                              ? "Reconnect collaboration session (dev)"
                              : "Disconnect collaboration session (dev)",
                      group: "Collaboration",
                      disabled: state === "none",
                      run: () =>
                          state === "offline" ? reconnect() : disconnect(),
                  },
              ],
    );

    return (
        <>
            <StatusChip />
            <ReadOnlyBanner />
            {joining && <JoinDialog onClose={() => setJoining(false)} />}
        </>
    );
}
