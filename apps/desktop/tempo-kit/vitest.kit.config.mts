import base from "../vitest.config";

/**
 * Runs the tempo kit generator (`generate.kit.ts`) with the desktop app's aliases. Not a test
 * suite: `pnpm --dir apps/desktop run tempo-kit`.
 */
const config = await base({ mode: "test", command: "serve" });
const kitConfig = {
    ...config,
    test: {
        ...config.test,
        include: ["tempo-kit/generate.kit.ts"],
        setupFiles: [],
        silent: false,
    },
};
export default kitConfig;
