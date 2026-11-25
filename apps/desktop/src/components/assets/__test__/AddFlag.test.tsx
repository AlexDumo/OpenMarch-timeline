import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TolgeeProvider } from "@tolgee/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import tolgee from "@/global/singletons/Tolgee";
import { FLAG_SHAPES } from "@/showAssets/flags";
import { AddFlag } from "../AddFlag";

function renderForm() {
    return render(
        <TolgeeProvider tolgee={tolgee}>
            <QueryClientProvider client={new QueryClient()}>
                <AddFlag onDone={() => {}} />
            </QueryClientProvider>
        </TolgeeProvider>,
    );
}

beforeAll(async () => {
    await tolgee.run();
});
afterEach(cleanup);

describe("adding a flag: its silk shape (fork #985)", () => {
    it("offers a few shapes, each drawn as its outline and named", () => {
        const { getByTestId } = renderForm();
        const cards = getByTestId("assets-add-flag-shape").querySelectorAll(
            '[role="radio"]',
        );
        expect(FLAG_SHAPES).toEqual(["rectangle", "standard", "swing"]);
        expect([...cards].map((c) => c.textContent)).toEqual([
            "Rectangle",
            "Standard",
            "Swing",
        ]);
        for (const card of cards)
            expect(card.querySelector("svg path")).not.toBeNull();
        // the 6 ft flag's plain rectangle to start
        expect(
            getByTestId("assets-add-flag-shape-rectangle").getAttribute(
                "aria-checked",
            ),
        ).toBe("true");
    });

    it("shows the picked shape's outline until a PNG is chosen", async () => {
        const { getByTestId, container } = renderForm();
        const preview = () =>
            container.querySelector(
                '[data-testid="assets-add-flag"] svg[data-shape]:not([role="radio"] svg)',
            );
        expect(preview()?.getAttribute("data-shape")).toBe("rectangle");
        await act(async () => {
            fireEvent.click(getByTestId("assets-add-flag-shape-swing"));
        });
        expect(
            getByTestId("assets-add-flag-shape-swing").getAttribute(
                "aria-checked",
            ),
        ).toBe("true");
        expect(preview()?.getAttribute("data-shape")).toBe("swing");
    });
});
