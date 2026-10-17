import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TolgeeProvider } from "@tolgee/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, vi } from "vitest";
import { describeDbTests } from "@/test/base";
import tolgee from "@/global/singletons/Tolgee";
import { createCues } from "@/db-functions/cues";
import { useVisualsStore } from "@/stores/VisualsStore";
import { useWorkspaceViewStore } from "@/stores/WorkspaceViewStore";
import { takeFieldPoint } from "@/field/fieldPointPick";
import VisualsInspector from "../VisualsInspector";
import VisualsToolbar from "../VisualsToolbar";
import { VisualsProvider } from "../VisualsProvider";

/**
 * Visuals mode's Who list and channel tabs against a real show
 * (performer-behavior.md section 7.1): focusing a who keeps its marchers
 * for the field to light, and the tabs count each channel's cues.
 */

beforeAll(async () => {
    await tolgee.run();
});
afterEach(() => {
    cleanup();
    useVisualsStore.setState({
        channel: "feet",
        focus: null,
        focusMarcherIds: null,
        selectedCueIds: [],
    });
    useWorkspaceViewStore.setState({ view: "editor" });
    vi.restoreAllMocks();
});

const renderVisuals = (wrapper: ComponentType<{ children: ReactNode }>) => {
    const Wrapper = wrapper;
    return render(
        <Wrapper>
            <TolgeeProvider tolgee={tolgee} fallback="Loading...">
                <VisualsProvider>
                    <VisualsToolbar />
                    <VisualsInspector />
                </VisualsProvider>
            </TolgeeProvider>
        </Wrapper>,
    );
};

describeDbTests("Visuals mode", (it) => {
    describe("the Who list", () => {
        it("lists the band and its sections, and focuses one", async ({
            db,
            marchersAndPages,
            wrapper,
        }) => {
            void db;
            void marchersAndPages;
            const user = userEvent.setup();
            renderVisuals(wrapper);

            const trumpets = await screen.findByTestId(
                "visuals-who-section-Trumpet",
                {},
                { timeout: 5000 },
            );
            expect(screen.getByTestId("visuals-who-band")).toHaveTextContent(
                "76",
            );
            expect(trumpets).toHaveTextContent("24");

            await user.click(trumpets);
            await waitFor(() =>
                expect(useVisualsStore.getState().focusMarcherIds?.size).toBe(
                    24,
                ),
            );
            expect(trumpets).toHaveAttribute("aria-pressed", "true");
            // all winds, so the Horn/Equipment tab says Horn
            expect(
                screen.getByTestId("visuals-tab-horn_equipment"),
            ).toHaveTextContent(/^Horn\d/);

            // clicking the focused who again clears the focus
            await user.click(trumpets);
            expect(useVisualsStore.getState().focus).toBeNull();
            expect(useVisualsStore.getState().focusMarcherIds).toBeNull();
        });
    });

    it("keeps the focus current with the inspector hidden (fullscreen)", async ({
        db,
        marchersAndPages,
        wrapper,
    }) => {
        void db;
        void marchersAndPages;
        const Wrapper = wrapper;
        render(
            <Wrapper>
                <VisualsProvider>{null}</VisualsProvider>
            </Wrapper>,
        );
        useVisualsStore
            .getState()
            .toggleFocus({ kind: "section", section: "Trumpet" });
        await waitFor(
            () =>
                expect(useVisualsStore.getState().focusMarcherIds?.size).toBe(
                    24,
                ),
            { timeout: 5000 },
        );
    });

    it("drops a field point pick when another cue is picked", async ({
        db,
        marchersAndPages,
        wrapper,
    }) => {
        void marchersAndPages;
        const point = {
            channel: "facing",
            kind: "state",
            target: { kind: "band" },
            value: "builtin:facing.point",
        } as const;
        const [first, second] = await createCues({
            db,
            newCues: [
                { ...point, beatId: 3 },
                { ...point, beatId: 5 },
            ],
        });
        useWorkspaceViewStore.setState({ view: "visuals" });
        useVisualsStore.setState({ channel: "facing" });
        useVisualsStore.getState().toggleFocus({ kind: "band" });
        const user = userEvent.setup();
        renderVisuals(wrapper);
        useVisualsStore.getState().selectCue(first!.id);

        await user.click(
            await screen.findByTestId(
                "visuals-pick-point",
                {},
                { timeout: 5000 },
            ),
        );
        expect(screen.getByTestId("visuals-pick-point")).toHaveTextContent(
            /^Click a point/,
        );
        useVisualsStore.getState().selectCue(second!.id);
        await waitFor(() =>
            expect(screen.getByTestId("visuals-pick-point")).toHaveTextContent(
                /^Pick the point/,
            ),
        );
        // the next field press is the editor's again, not the first cue's point
        expect(takeFieldPoint({ x: 1, y: 2 })).toBe(false);
    });

    describe("the channel tabs", () => {
        it("count each channel's cues and switch the channel", async ({
            db,
            wrapper,
            marchersAndPages,
        }) => {
            void marchersAndPages;
            await createCues({
                db,
                newCues: [
                    {
                        channel: "facing",
                        kind: "state",
                        target: { kind: "band" },
                        beatId: 3,
                        value: "builtin:facing.back",
                    },
                    {
                        channel: "facing",
                        kind: "state",
                        target: { kind: "section", section: "Tuba" },
                        beatId: 5,
                        value: "builtin:facing.side1",
                    },
                ],
            });
            const user = userEvent.setup();
            renderVisuals(wrapper);

            const facing = screen.getByTestId("visuals-tab-facing");
            await waitFor(() => expect(facing).toHaveTextContent("Facing2"), {
                timeout: 5000,
            });
            expect(screen.getByTestId("visuals-tab-feet")).toHaveTextContent(
                "Feet0",
            );

            await user.click(facing);
            expect(useVisualsStore.getState().channel).toBe("facing");
        });
    });
});
