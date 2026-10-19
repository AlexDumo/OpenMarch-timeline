import type { WorkspaceView } from "@/stores/WorkspaceViewStore";

/** The performer cue tables (ADR 0004 D-5): what Visuals mode edits. */
const CUE_TABLES: ReadonlySet<string> = new Set([
    "cues",
    "cue_marchers",
    "phrase_assets",
    "page_performer_settings",
]);

/** Tables that belong to neither workspace: the 3D View's venue is edited from its own window. */
const NEITHER_TABLES: ReadonlySet<string> = new Set(["view3d_venue"]);

/**
 * The workspace an undone or redone edit belongs to, from the tables it changed: Visuals for
 * cues only, the Editor for anything in the drill (with or without cues, as when a deleted beat
 * carries its cues), and null for neither or nothing. Undo and redo share one stack across both
 * workspaces (performer-behavior.md section 7.1), so the other one's edits can come off it.
 */
export function historyEditWorkspace(
    tableNames: Iterable<string>,
): WorkspaceView | null {
    let cues = false;
    for (const name of tableNames) {
        if (NEITHER_TABLES.has(name)) continue;
        if (!CUE_TABLES.has(name)) return "editor";
        cues = true;
    }
    return cues ? "visuals" : null;
}
