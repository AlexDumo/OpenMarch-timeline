import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TolgeeProvider } from "@tolgee/react";
import tolgee from "@/global/singletons/Tolgee";
import ViewTab from "../ViewTab";

vi.mock("@/shortcuts/ActionButton", () => ({
    default: ({ children }: { children: React.ReactNode }) => (
        <button>{children}</button>
    ),
}));

describe("ViewTab", () => {
    it("keeps only the toggles flipped while working", async () => {
        render(
            <TolgeeProvider tolgee={tolgee} fallback="loading">
                <ViewTab />
            </TolgeeProvider>,
        );
        await screen.findByText("Next paths");
        for (const kept of ["Labels", "Shapes", "Open 3D View"])
            expect(screen.getByText(kept)).toBeInTheDocument();
        for (const moved of [
            "Grid lines",
            "Half lines",
            "Label size",
            "Label position",
            "Step size warnings",
            "While shaping",
        ])
            expect(screen.queryByText(moved)).not.toBeInTheDocument();
    });
});
