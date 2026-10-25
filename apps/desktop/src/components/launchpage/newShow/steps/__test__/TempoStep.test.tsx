import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TolgeeProvider } from "@tolgee/react";
import tolgee from "@/global/singletons/Tolgee";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import TempoStep from "../TempoStep";

beforeAll(async () => {
    await tolgee.run();
    (window as unknown as { electron: unknown }).electron = {
        databaseIsReady: vi.fn(async () => false),
    };
});
afterEach(cleanup);

const renderStep = (hasAudio: boolean) => {
    const onChange = vi.fn();
    render(
        <TolgeeProvider tolgee={tolgee} fallback="Loading...">
            <QueryClientProvider client={new QueryClient()}>
                <TempoStep
                    tempo={null}
                    onChange={onChange}
                    hasAudio={hasAudio}
                />
            </QueryClientProvider>
        </TolgeeProvider>,
    );
    return onChange;
};

describe("the wizard's tempo step with music (FB-10)", () => {
    it("makes the tempo optional, with I don't know: I'll tap it", async () => {
        useUiSettingsStore.getState().setTempoLabFlag("tapTheBeat", true);
        const onChange = renderStep(true);
        expect(
            await screen.findByText("Tempo (BPM), if you know it"),
        ).toBeTruthy();
        fireEvent.click(screen.getByTestId("tempo-tap-later"));
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({
                method: "tempo_only",
                tempo: 120,
                tapLater: true,
            }),
        );
        expect(screen.getByRole("spinbutton")).toBeDisabled();
    });

    it("keeps asking for a BPM without music", async () => {
        useUiSettingsStore.getState().setTempoLabFlag("tapTheBeat", true);
        renderStep(false);
        expect(screen.queryByTestId("tempo-tap-later")).toBeNull();
        expect(await screen.findByText("Default tempo (BPM)")).toBeTruthy();
    });
});
