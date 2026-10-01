import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { describeDbTests, type DbConnection } from "@/test/base";
import {
    getWorkspaceSettingsParsed,
    updateWorkspaceSettingsParsed,
} from "@/db-functions/workspaceSettings";
import tolgee from "@/global/singletons/Tolgee";
import { ThemeProvider } from "@/context/ThemeContext";
import TimelineContainer from "../TimelineContainer";

/**
 * The 0.2 timeline (P8.1) replaces the page timeline only for a file whose timeline dev flag is
 * on. With the flag off, the container renders the page timeline exactly as before.
 */

afterEach(cleanup);

// The Electron bridge calls the container's theme and audio file providers make; the database
// proxy the test harness installs on window.electron stays as it is.
beforeEach(() => {
    window.electron = {
        ...window.electron,
        getTheme: vi.fn().mockResolvedValue(null),
        setTheme: vi.fn(),
        getSelectedAudioFile: vi.fn().mockResolvedValue(null),
    };
    window.matchMedia ??= vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
});

const setTimelineMode = async (db: DbConnection, on: boolean) => {
    const settings = await getWorkspaceSettingsParsed({ db });
    await updateWorkspaceSettingsParsed({
        db,
        settings: { ...settings, timelineMode: on },
    });
};

const renderContainer = (wrapper: ComponentType<{ children: ReactNode }>) => {
    const Wrapper = wrapper;
    return render(
        <Wrapper>
            <TolgeeProvider tolgee={tolgee} fallback="Loading...">
                <ThemeProvider>
                    <TimelineContainer />
                </ThemeProvider>
            </TolgeeProvider>
        </Wrapper>,
    );
};

describeDbTests("TimelineContainer and the timeline flag", (it) => {
    describe("flag off", () => {
        it("renders the page timeline and not the new timeline", async ({
            wrapper,
        }) => {
            const { container } = renderContainer(wrapper);

            await waitFor(
                () =>
                    expect(container.querySelector("#timeline")).not.toBeNull(),
                { timeout: 5000 },
            );
            expect(
                screen.queryByTestId("timeline-mode-container"),
            ).not.toBeInTheDocument();
            expect(
                screen.queryByTestId("timeline-viewport"),
            ).not.toBeInTheDocument();
        });
    });

    describe("flag on", () => {
        it("renders the new timeline instead of the page timeline", async ({
            db,
            wrapper,
        }) => {
            await setTimelineMode(db, true);
            const { container } = renderContainer(wrapper);

            await waitFor(
                () =>
                    expect(
                        screen.getByTestId("timeline-mode-container"),
                    ).toBeInTheDocument(),
                { timeout: 5000 },
            );
            expect(screen.getByTestId("timeline-viewport")).toBeInTheDocument();
            expect(container.querySelector("#timeline")).toBeNull();
            // No tracks until the view-model adapter (P8.8)
            expect(screen.queryByLabelText(/ timeline, beats /)).toBeNull();
            // The transport keeps the page timeline's extra controls
            expect(
                screen.getByRole("button", {
                    name: "Toggle timeline fullscreen",
                }),
            ).toBeInTheDocument();
        });
    });
});
