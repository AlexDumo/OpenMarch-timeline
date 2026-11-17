import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TolgeeProvider } from "@tolgee/react";
import tolgee from "@/global/singletons/Tolgee";
import WebFileMenu from "../WebFileMenu";

describe("WebFileMenu", () => {
    // On a tablet the title bar's ? gives its room to the toolbar tabs (#1075)
    it("has Get help", async () => {
        render(
            <TolgeeProvider tolgee={tolgee} fallback="">
                <WebFileMenu />
            </TolgeeProvider>,
        );
        await userEvent.click(
            await screen.findByRole("button", { name: "File" }),
        );
        expect(
            await screen.findByRole("menuitem", { name: /Get help/ }),
        ).toBeInTheDocument();
    });
});
