import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TolgeeProvider } from "@tolgee/react";
import tolgee from "@/global/singletons/Tolgee";
import { ThemeProvider } from "@/context/ThemeContext";
import { useEditorModeStore } from "@/stores/EditorModeStore";
import WelcomeFlow from "../WelcomeFlow";

/** Stands in for the preload's settings bridge (the IPC boundary). */
function stubElectron(optOutAnalytics: unknown) {
    const electron = {
        invoke: vi.fn(async (_channel: string, key: string) =>
            key === "optOutAnalytics" ? optOutAnalytics : undefined,
        ),
        send: vi.fn(),
        getTheme: vi.fn(async () => "dark"),
        setTheme: vi.fn(async () => undefined),
        setLanguage: vi.fn(async () => undefined),
    };
    Object.assign(window, { electron });
    return electron;
}

function renderFlow() {
    const onFinish = vi.fn();
    const reload = vi.fn();
    render(
        <TolgeeProvider tolgee={tolgee} fallback="">
            <ThemeProvider>
                <WelcomeFlow onFinish={onFinish} reload={reload} />
            </ThemeProvider>
        </TolgeeProvider>,
    );
    return { onFinish, reload };
}

const continueButton = () => screen.getByTestId("welcome-continue");

/** From the welcome page through language and theme to the mode step. */
async function goToModeStep() {
    expect(await screen.findByTestId("welcome-greeting")).toBeInTheDocument();
    fireEvent.click(continueButton());
    await screen.findByTestId("welcome-language-options");
    fireEvent.click(continueButton());
    await screen.findByTestId("welcome-theme-options");
    fireEvent.click(continueButton());
    return screen.findByTestId("editor-mode-card-basic");
}

beforeEach(() => {
    useEditorModeStore.setState({ mode: null, loaded: true });
    Object.defineProperty(navigator, "languages", {
        value: ["en-US"],
        configurable: true,
    });
});
afterEach(async () => {
    vi.restoreAllMocks();
    await tolgee.changeLanguage("en");
});

describe("WelcomeFlow", () => {
    it("needs a mode before Continue, then asks about analytics", async () => {
        const electron = stubElectron(undefined);
        const { onFinish, reload } = renderFlow();

        const basic = await goToModeStep();
        expect(basic).toHaveAttribute("aria-checked", "false");
        expect(screen.getByTestId("editor-mode-card-expert")).toHaveAttribute(
            "aria-checked",
            "false",
        );
        expect(continueButton()).toBeDisabled();

        fireEvent.click(basic);
        expect(basic).toHaveAttribute("aria-checked", "true");
        expect(continueButton()).toBeEnabled();
        fireEvent.click(continueButton());

        fireEvent.click(await screen.findByTestId("welcome-analytics-opt-out"));
        expect(useEditorModeStore.getState().mode).toBe("basic");
        expect(electron.send).toHaveBeenCalledWith("settings:set", {
            editorMode: "basic",
        });
        expect(electron.send).toHaveBeenCalledWith("settings:set", {
            optOutAnalytics: true,
        });
        expect(onFinish).toHaveBeenCalledWith({ willReload: true });
        expect(reload).toHaveBeenCalled();
    });

    it("skips the analytics step when it was already answered", async () => {
        const electron = stubElectron(false);
        const { onFinish, reload } = renderFlow();
        await waitFor(() => expect(electron.invoke).toHaveBeenCalled());

        await goToModeStep();
        fireEvent.click(screen.getByTestId("editor-mode-card-expert"));
        await waitFor(() => expect(continueButton()).toBeEnabled());
        fireEvent.click(continueButton());

        expect(screen.queryByTestId("welcome-analytics-opt-in")).toBeNull();
        expect(useEditorModeStore.getState().mode).toBe("expert");
        expect(electron.send).toHaveBeenCalledTimes(1);
        expect(onFinish).toHaveBeenCalledWith({ willReload: false });
        expect(reload).not.toHaveBeenCalled();
    });

    it("switches and saves the language and theme as they are picked", async () => {
        const electron = stubElectron(false);
        renderFlow();

        fireEvent.click(await screen.findByTestId("welcome-continue"));
        fireEvent.click(await screen.findByTestId("welcome-language-fr"));
        expect(electron.setLanguage).toHaveBeenCalledWith("fr");
        await waitFor(() => expect(tolgee.getLanguage()).toBe("fr"));
        expect(screen.getByTestId("welcome-language-fr")).toHaveAttribute(
            "aria-checked",
            "true",
        );

        fireEvent.click(continueButton());
        fireEvent.click(await screen.findByTestId("welcome-theme-light"));
        expect(electron.setTheme).toHaveBeenCalledWith("light");
        expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("starts on the system's language and saves it on Continue", async () => {
        Object.defineProperty(navigator, "languages", {
            value: ["es-MX", "en-US"],
            configurable: true,
        });
        const electron = stubElectron(false);
        renderFlow();

        fireEvent.click(await screen.findByTestId("welcome-continue"));
        expect(
            await screen.findByTestId("welcome-language-es"),
        ).toHaveAttribute("aria-checked", "true");
        expect(electron.setLanguage).not.toHaveBeenCalled();

        fireEvent.click(continueButton());
        expect(electron.setLanguage).toHaveBeenCalledWith("es");
        await screen.findByTestId("welcome-theme-options");
    });
});
