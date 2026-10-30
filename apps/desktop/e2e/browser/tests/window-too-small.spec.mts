import { test, expect } from "../fixtures.mjs";

test("says when the window is too small, and comes back when it grows", async ({
    show,
}) => {
    const { page } = show;
    const notice = page.getByTestId("window-too-small");
    await expect(page.getByRole("heading", { name: "Page 0" })).toBeVisible();
    await expect(notice).toBeHidden();

    await page.setViewportSize({ width: 700, height: 800 });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Make the window bigger");
    await expect(notice).toContainText("This window is 700 × 800.");

    await page.setViewportSize({ width: 1200, height: 450 });
    await expect(notice).toContainText("This window is 1200 × 450.");

    await page.setViewportSize({ width: 768, height: 600 });
    await expect(notice).toBeHidden();
    await expect(page.getByRole("heading", { name: "Page 0" })).toBeVisible();
});
