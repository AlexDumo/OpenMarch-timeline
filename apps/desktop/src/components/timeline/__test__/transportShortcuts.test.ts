import { describe, expect, it } from "vitest";
import { TRANSPORT_SHORTCUTS } from "../TimelinePrimitives";
import { formatBindingKeys } from "@/shortcuts/bindings";
import {
    ACTIONS,
    getActionDefinition,
    type ActionId,
} from "@/shortcuts/definitions";
import {
    HELP_MENU_ACTIONS,
    PLAYBACK_MENU_ACTIONS,
    isMenuAction,
} from "@/global/menuActions";
import { shortcutGroups } from "@/components/ShortcutsDialog";
import { transportShortcuts } from "../useTransportShortcuts";

/** An action's first default binding as the tooltips write it, e.g. "Shift + Space" */
const shown = (id: ActionId) =>
    formatBindingKeys(getActionDefinition(id).defaultBindings[0]!, false).join(
        " + ",
    );

/**
 * The transport tooltips show the same shortcuts as the actions' default bindings (UI-17).
 * `TimelinePrimitives` doesn't import the shortcut registry; this test is the link.
 */
describe("transport shortcuts (UI-17)", () => {
    it("matches the registered playback and page shortcuts", () => {
        expect(TRANSPORT_SHORTCUTS).toEqual({
            previousPage: "Q",
            nextPage: "E",
            firstPage: "Alt + Q",
            lastPage: "Alt + E",
            previousBeat: "Shift + Q",
            nextBeat: "Shift + E",
            play: "Space",
            playPage: "Shift + Space",
            playOn: "Alt + Space",
            loop: "C",
            fit: "Shift + Z",
        });
        expect(TRANSPORT_SHORTCUTS.playOn).toBe(shown("playOn"));
        expect(TRANSPORT_SHORTCUTS.playPage).toBe(shown("playPage"));
        expect(TRANSPORT_SHORTCUTS.play).toBe(shown("playPause"));
        expect(TRANSPORT_SHORTCUTS.previousPage).toBe(shown("previousPage"));
        expect(TRANSPORT_SHORTCUTS.nextPage).toBe(shown("nextPage"));
        expect(TRANSPORT_SHORTCUTS.loop).toBe(shown("toggleLoop"));
        expect(TRANSPORT_SHORTCUTS.firstPage).toBe(shown("firstPage"));
        expect(TRANSPORT_SHORTCUTS.lastPage).toBe(shown("lastPage"));
        expect(TRANSPORT_SHORTCUTS.previousBeat).toBe(shown("previousBeat"));
        expect(TRANSPORT_SHORTCUTS.nextBeat).toBe(shown("nextBeat"));
        expect(TRANSPORT_SHORTCUTS.fit).toBe(shown("timelineFit"));
    });

    it("are the defaults until the user changes them, on a Mac too (shortcut review)", () => {
        expect(transportShortcuts({}, false)).toEqual(TRANSPORT_SHORTCUTS);
        expect(transportShortcuts({}, true)).toEqual(TRANSPORT_SHORTCUTS);
    });

    it("follow the user's changed shortcuts, and leave out one taken away", () => {
        const shortcuts = transportShortcuts(
            {
                toggleLoop: ["$mod+L"],
                playPage: [],
                nextPage: ["ArrowRight", "E"],
            },
            false,
        );
        expect(shortcuts.loop).toBe("Ctrl + L");
        expect(shortcuts.playPage).toBeUndefined();
        expect(shortcuts.nextPage).toBe("→");
        expect(shortcuts.play).toBe("Space");
        expect(transportShortcuts({ toggleLoop: ["$mod+L"] }, true).loop).toBe(
            "Cmd + L",
        );
    });
});

describe("app menu actions (docs/adr/0003-menu-actions-ipc.md)", () => {
    const items = [...PLAYBACK_MENU_ACTIONS, ...HELP_MENU_ACTIONS];

    it("lists Play, Play from Playhead / Pause and Loop, plus the shortcuts list (UI-17)", () => {
        expect(PLAYBACK_MENU_ACTIONS).toEqual([
            { action: "playPause", label: "Play / Stop", accelerator: "Space" },
            {
                action: "playPage",
                label: "Play from Playhead / Pause",
                accelerator: "Shift+Space",
            },
            {
                action: "playOn",
                label: "Play On from Start Flag",
                accelerator: "Alt+Space",
            },
            {
                action: "toggleLoop",
                label: "Loop On / Off",
                accelerator: "C",
            },
        ]);
        expect(HELP_MENU_ACTIONS).toEqual([
            {
                action: "showShortcuts",
                label: "Keyboard Shortcuts",
                accelerator: "Shift+/",
            },
        ]);
    });

    it("names actions and shows their default shortcuts", () => {
        for (const item of items) {
            expect(item.action in ACTIONS, item.action).toBe(true);
            const [binding] = getActionDefinition(
                item.action as ActionId,
            ).defaultBindings;
            // Electron's accelerators name the slash "/"; the bindings name it by key code
            expect(item.accelerator, item.action).toBe(
                binding!.replace("Slash", "/"),
            );
        }
    });

    it("lets the renderer run only those", () => {
        for (const item of items) expect(isMenuAction(item.action)).toBe(true);
        expect(isMenuAction("deleteAllMarchers")).toBe(false);
        expect(isMenuAction(undefined)).toBe(false);
    });
});

describe("the shortcuts list (UI-17 follow-up)", () => {
    it("groups every shortcut, playback first, with the timeline's own keys", () => {
        const groups = shortcutGroups((key) => key, {}, false);
        expect(groups[0]?.title).toBe("Playback");
        const playback = groups[0]!.rows.map((row) => row.keys);
        expect(playback).toEqual([
            "Space",
            "Shift + Space",
            "Alt + Space",
            "C",
            "]",
            "[",
            "Ctrl + M",
        ]);
        const timeline = groups.find((g) => g.title === "Timeline");
        expect(timeline?.rows).toContainEqual({
            label: "actions.timeline.goTo",
            keys: "G",
        });
        // K keeps the selection on this page, or lets it follow again (UI-18)
        expect(timeline?.rows).toContainEqual({
            label: "actions.timeline.toggleKeepOnPage",
            keys: "K",
        });
        const view = groups.find((g) => g.title === "View");
        expect(view?.rows.map((row) => row.keys)).toContain("?");
        // Nothing without a key, such as the nudge's own actions
        for (const group of groups)
            for (const row of group.rows) expect(row.keys).not.toBe("");
    });
});
