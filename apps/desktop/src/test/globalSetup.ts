import fs from "fs";
import os from "os";
import path from "path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
    export interface ProvidedContext {
        /** Where this run's built test databases go (see ./fixtureCache.ts) */
        fixtureCacheDir: string;
    }
}

/**
 * Makes one folder per run for the test databases the fixtures build, so every worker
 * reuses them. A new folder each run, so a changed migration or fixture never hits an old one.
 */
export default function setup(project: TestProject) {
    const parent = path.join(os.tmpdir(), "openmarch-test");
    fs.mkdirSync(parent, { recursive: true });
    const dir = fs.mkdtempSync(path.join(parent, "fixture-cache-"));
    project.provide("fixtureCacheDir", dir);
    return () => fs.rmSync(dir, { recursive: true, force: true });
}
