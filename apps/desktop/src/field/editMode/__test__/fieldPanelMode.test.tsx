import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import tolgee from "@/global/singletons/Tolgee";
import FieldPropertiesTemplates from "@/global/classes/FieldProperties.templates";
import ShortcutDispatcher from "@/shortcuts/ShortcutDispatcher";
import { registerActionHandler } from "@/shortcuts/registry";
import { fieldEditMode } from "../fieldEditModeStore";
import { toRef } from "../lines";
import {
    useFieldEditModeEntry,
    useFieldPanelActions,
} from "../useFieldEditModeActions";

/**
 * The Field panel and Edit lines (#824): the panel opens on Setup with line editing off, Edit
 * lines belongs to the Lines tab, Escape steps back one thing at a time, and the drill's canvas
 * keys are off while the panel is open.
 */

const college = FieldPropertiesTemplates.COLLEGE_FOOTBALL_FIELD_NO_END_ZONES;
const forty = college.xCheckpoints.find((c) => c.stepsFromCenterFront === 16)!;

beforeAll(async () => {
    await tolgee.run();
});

const offs: (() => void)[] = [];
afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
    fieldEditMode.exit();
});

function Providers({ children }: { children: ReactNode }) {
    return (
        <TolgeeProvider tolgee={tolgee} fallback="Loading...">
            <QueryClientProvider client={new QueryClient()}>
                {children}
            </QueryClientProvider>
        </TolgeeProvider>
    );
}

describe("the panel and Edit lines", () => {
    it("opens on Setup with Edit lines off", () => {
        fieldEditMode.enter();
        expect(fieldEditMode.get()).toMatchObject({
            active: true,
            lines: false,
            tab: "setup",
        });
    });

    it("turns Edit lines on on the Lines tab, and another tab turns it off with nothing picked", () => {
        fieldEditMode.enter();
        fieldEditMode.setLines(true);
        expect(fieldEditMode.get()).toMatchObject({
            lines: true,
            tab: "lines",
        });
        fieldEditMode.select([toRef(forty)]);
        fieldEditMode.setTab("appearance");
        expect(fieldEditMode.get()).toMatchObject({
            lines: false,
            tab: "appearance",
            selection: [],
        });
    });

    it("keeps Mirror sides when Edit lines turns off", () => {
        fieldEditMode.enter();
        fieldEditMode.setLines(true);
        fieldEditMode.setMirror(false);
        fieldEditMode.setLines(false);
        expect(fieldEditMode.get().mirror).toBe(false);
        fieldEditMode.setMirror(true);
    });

    it("has no Edit lines while the panel is shut", () => {
        fieldEditMode.setLines(true);
        expect(fieldEditMode.get().lines).toBe(false);
        fieldEditMode.enter({ lines: true });
        expect(fieldEditMode.get()).toMatchObject({
            lines: true,
            tab: "lines",
        });
        fieldEditMode.exit();
        expect(fieldEditMode.get()).toMatchObject({
            active: false,
            lines: false,
        });
    });
});

describe("keys while the panel is open", () => {
    function PanelKeys() {
        useFieldEditModeEntry();
        useFieldPanelActions();
        return null;
    }

    it("Escape drops the pick, then Edit lines, then shuts the panel", () => {
        render(
            <Providers>
                <ShortcutDispatcher />
                <PanelKeys />
            </Providers>,
        );
        act(() => {
            fieldEditMode.enter({ lines: true });
            fieldEditMode.select([toRef(forty)]);
        });
        const escape = () =>
            act(() => {
                fireEvent.keyDown(document.body, { key: "Escape" });
            });
        escape();
        expect(fieldEditMode.get()).toMatchObject({
            active: true,
            lines: true,
            selection: [],
        });
        escape();
        expect(fieldEditMode.get()).toMatchObject({
            active: true,
            lines: false,
        });
        escape();
        expect(fieldEditMode.isActive()).toBe(false);
    });

    it("Escape in a text field is the field's", () => {
        render(
            <Providers>
                <ShortcutDispatcher />
                <PanelKeys />
                <input data-testid="name" />
            </Providers>,
        );
        act(() => fieldEditMode.enter());
        const input = document.querySelector("input")!;
        input.focus();
        act(() => {
            fireEvent.keyDown(input, { key: "Escape" });
        });
        expect(fieldEditMode.isActive()).toBe(true);
    });

    it("turns the drill's canvas keys off, so a line key can't fall through to one", () => {
        const lockX = vi.fn();
        offs.push(
            registerActionHandler("lockX", {
                run: lockX,
                isEnabled: () => true,
            }),
        );
        render(
            <Providers>
                <ShortcutDispatcher />
            </Providers>,
        );
        const pressY = () =>
            act(() => {
                fireEvent.keyDown(document.body, { key: "y", code: "KeyY" });
            });
        pressY();
        expect(lockX).toHaveBeenCalledTimes(1);
        act(() => fieldEditMode.enter());
        pressY();
        expect(lockX).toHaveBeenCalledTimes(1);
    });
});
