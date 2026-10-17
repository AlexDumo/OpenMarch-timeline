import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditorModeStore } from "@/stores/EditorModeStore";
import { useWorkspaceViewStore } from "@/stores/WorkspaceViewStore";
import { isActionEnabled, registerActionHandler, runAction } from "../registry";
import { isDrillEditingAction } from "../workspaceActions";
import type { ActionId } from "../definitions";

afterEach(() => useWorkspaceViewStore.setState({ view: "editor" }));

const handle = (id: ActionId) => {
    const run = vi.fn();
    const off = registerActionHandler(id, { run, isEnabled: () => true });
    return { run, off };
};

describe("drill edits in Visuals mode (performer-behavior.md 7.1)", () => {
    it("are the moving, aligning and shaping actions, and K", () => {
        for (const id of [
            "moveSelectedMarchersUp",
            "alignHorizontally",
            "swapMarchers",
            "setSelectedMarchersToNextPage",
            "alignmentEventLine",
            "applyQuickShape",
            "createCircle",
            "toggleKeepOnPage",
        ] as const)
            expect(isDrillEditingAction(id), id).toBe(true);
        for (const id of [
            "selectAllMarchers",
            "performUndo",
            "performRedo",
            "playPause",
            "nextPage",
            "previousPage",
            "focusTimeline",
        ] as const)
            expect(isDrillEditingAction(id), id).toBe(false);
    });

    it("don't run in Visuals mode, and run again in the Editor", () => {
        const nudge = handle("moveSelectedMarchersUp");
        const undo = handle("performUndo");
        useWorkspaceViewStore.setState({ view: "visuals" });
        expect(isActionEnabled("moveSelectedMarchersUp")).toBe(false);
        expect(runAction("moveSelectedMarchersUp")).toBe(false);
        expect(nudge.run).not.toHaveBeenCalled();
        // undo, selecting and playback stay
        expect(runAction("performUndo")).toBe(true);
        expect(undo.run).toHaveBeenCalledOnce();

        useWorkspaceViewStore.setState({ view: "editor" });
        expect(runAction("moveSelectedMarchersUp")).toBe(true);
        expect(nudge.run).toHaveBeenCalledOnce();
        nudge.off();
        undo.off();
    });

    it("run in Basic, which has no Visuals mode", () => {
        const nudge = handle("moveSelectedMarchersUp");
        const mode = useEditorModeStore.getState().mode;
        useEditorModeStore.setState({ mode: "basic" });
        useWorkspaceViewStore.setState({ view: "visuals" });
        expect(runAction("moveSelectedMarchersUp")).toBe(true);
        useEditorModeStore.setState({ mode });
        nudge.off();
    });
});
