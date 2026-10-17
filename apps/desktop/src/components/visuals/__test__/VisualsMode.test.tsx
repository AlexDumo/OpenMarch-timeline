import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TolgeeProvider } from "@tolgee/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, vi } from "vitest";
import { describeDbTests } from "@/test/base";
import tolgee from "@/global/singletons/Tolgee";
import { createCues } from "@/db-functions/cues";
import { useVisualsStore } from "@/stores/VisualsStore";
import VisualsInspector from "../VisualsInspector";
import VisualsToolbar from "../VisualsToolbar";

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
    });
    vi.restoreAllMocks();
});

const renderVisuals = (wrapper: ComponentType<{ children: ReactNode }>) => {
    const Wrapper = wrapper;
    return render(
        <Wrapper>
            <TolgeeProvider tolgee={tolgee} fallback="Loading...">
                <VisualsToolbar />
                <VisualsInspector />
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
