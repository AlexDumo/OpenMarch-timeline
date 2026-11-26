import { cleanup, render } from "@testing-library/react";
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
    it("offers no shape choice while there's one shape: the 6 ft flag's rectangle", () => {
        const { queryByTestId, container } = renderForm();
        expect(FLAG_SHAPES).toEqual(["rectangle"]);
        expect(queryByTestId("assets-add-flag-shape")).toBeNull();
        // the preview shows the rectangle's outline until a PNG is chosen
        expect(
            container
                .querySelector(
                    '[data-testid="assets-add-flag"] svg[data-shape]',
                )
                ?.getAttribute("data-shape"),
        ).toBe("rectangle");
    });
});
