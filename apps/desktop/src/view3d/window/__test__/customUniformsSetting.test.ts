/**
 * Custom uniforms (preview), the per-computer setting (step 7 of the uniform artwork build): its
 * default per build channel, the hidden flag's "1" read as on, and the once-only warning.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
    UNIFORM_ARTWORK_STORAGE_KEY,
    UNIFORM_PREVIEW_WARNED_STORAGE_KEY,
    customUniformsDefault,
    loadCustomUniforms,
    markPreviewWarningShown,
    previewWarningShown,
    useCustomUniformsStore,
} from "../uniformArtworkPreview";

function memoryStorage(initial: Record<string, string> = {}, broken = false) {
    const data = new Map(Object.entries(initial));
    const storage: Storage = {
        get length() {
            return data.size;
        },
        clear: () => data.clear(),
        key: (i) => [...data.keys()][i] ?? null,
        removeItem: (k) => void data.delete(k),
        setItem: (k, v) => {
            if (broken) throw new Error("blocked");
            data.set(k, v);
        },
        getItem: (k) => {
            if (broken) throw new Error("blocked");
            return data.get(k) ?? null;
        },
    };
    return storage;
}

const release = { dev: false, webChannel: undefined };

afterEach(() => {
    localStorage.clear();
});

describe("Custom uniforms (preview) default", () => {
    it("is off in release builds: packaged Electron, the stable and the preview sites", () => {
        expect(customUniformsDefault(release)).toBe(false);
        expect(
            customUniformsDefault({ dev: false, webChannel: "stable" }),
        ).toBe(false);
        expect(
            customUniformsDefault({ dev: false, webChannel: "preview" }),
        ).toBe(false);
    });

    it("is on in developer builds and lab builds", () => {
        expect(
            customUniformsDefault({ dev: true, webChannel: undefined }),
        ).toBe(true);
        for (const webChannel of ["dev", "examples", "nightly", "lab"])
            expect(customUniformsDefault({ dev: false, webChannel })).toBe(
                true,
            );
    });
});

describe("loadCustomUniforms", () => {
    it('reads the hidden flag\'s "1" as on, so a computer that set it keeps it', () => {
        expect(
            loadCustomUniforms(
                memoryStorage({ [UNIFORM_ARTWORK_STORAGE_KEY]: "1" }),
                release,
            ),
        ).toBe(true);
    });

    it('reads "0" as off, even in a developer build', () => {
        expect(
            loadCustomUniforms(
                memoryStorage({ [UNIFORM_ARTWORK_STORAGE_KEY]: "0" }),
                { dev: true, webChannel: undefined },
            ),
        ).toBe(false);
    });

    it("uses the build's default with nothing saved, a stray value or blocked storage", () => {
        expect(loadCustomUniforms(memoryStorage(), release)).toBe(false);
        expect(
            loadCustomUniforms(memoryStorage(), {
                dev: false,
                webChannel: "lab",
            }),
        ).toBe(true);
        expect(
            loadCustomUniforms(
                memoryStorage({ [UNIFORM_ARTWORK_STORAGE_KEY]: "yes" }),
                release,
            ),
        ).toBe(false);
        expect(loadCustomUniforms(memoryStorage({}, true), release)).toBe(
            false,
        );
    });

    it('saves a change as "1" or "0" under the same key', () => {
        useCustomUniformsStore.getState().setEnabled(true);
        expect(localStorage.getItem(UNIFORM_ARTWORK_STORAGE_KEY)).toBe("1");
        expect(useCustomUniformsStore.getState().enabled).toBe(true);
        useCustomUniformsStore.getState().setEnabled(false);
        expect(localStorage.getItem(UNIFORM_ARTWORK_STORAGE_KEY)).toBe("0");
        expect(useCustomUniformsStore.getState().enabled).toBe(false);
    });

    it("follows a change another window saves", () => {
        useCustomUniformsStore.setState({ enabled: false });
        localStorage.setItem(UNIFORM_ARTWORK_STORAGE_KEY, "1");
        window.dispatchEvent(
            new StorageEvent("storage", { key: UNIFORM_ARTWORK_STORAGE_KEY }),
        );
        expect(useCustomUniformsStore.getState().enabled).toBe(true);
    });
});

describe("the once-only warning's flag", () => {
    it("is unset until marked, then set", () => {
        const storage = memoryStorage();
        expect(previewWarningShown(storage)).toBe(false);
        markPreviewWarningShown(storage);
        expect(previewWarningShown(storage)).toBe(true);
        expect(storage.getItem(UNIFORM_PREVIEW_WARNED_STORAGE_KEY)).toBe("1");
    });

    it("reads as not shown when storage is blocked, without throwing", () => {
        const storage = memoryStorage({}, true);
        expect(() => markPreviewWarningShown(storage)).not.toThrow();
        expect(previewWarningShown(storage)).toBe(false);
    });
});
