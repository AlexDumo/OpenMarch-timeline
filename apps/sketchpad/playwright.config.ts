import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests for the static site against its production build. Run `pnpm build` first;
 * the preview server serves `dist/`.
 */
export default defineConfig({
    testDir: "./e2e",
    timeout: 90_000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? "github" : "list",
    use: {
        baseURL: "http://localhost:5290",
        viewport: { width: 1600, height: 1000 },
        acceptDownloads: true,
        trace: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: {
                ...devices["Desktop Chrome"],
                viewport: { width: 1600, height: 1000 },
                // A preinstalled Chromium, when the bundled one's version doesn't match
                launchOptions: process.env.SKETCHPAD_CHROMIUM
                    ? { executablePath: process.env.SKETCHPAD_CHROMIUM }
                    : {},
            },
        },
    ],
    webServer: {
        command: "pnpm exec vite preview --port 5290 --strictPort",
        url: "http://localhost:5290",
        reuseExistingServer: !process.env.CI,
    },
});
