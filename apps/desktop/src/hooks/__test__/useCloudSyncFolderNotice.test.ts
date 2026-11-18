/** The warning when a show opens from a cloud-synced folder (`useCloudSyncFolderNotice.ts`). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { useCloudSyncFolderNotice } from "../useCloudSyncFolderNotice";

vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));

describe("useCloudSyncFolderNotice", () => {
    const original = window.electron;
    let folder: { service: string; filePath: string } | null;

    beforeEach(() => {
        folder = { service: "OneDrive", filePath: "C:\\OneDrive\\Show.dots" };
        localStorage.clear();
        vi.mocked(toast.warning).mockClear();
        window.electron = {
            ...(original ?? {}),
            getCloudSyncFolder: vi.fn(async () => folder),
            openExternal: vi.fn(),
        } as unknown as typeof window.electron;
    });

    afterEach(() => {
        window.electron = original;
    });

    const opened = async () => {
        renderHook(() => useCloudSyncFolderNotice(true));
        await act(async () => {});
    };

    it("warns when the open show is in a synced folder", async () => {
        await opened();
        expect(toast.warning).toHaveBeenCalledTimes(1);
    });

    it("stays quiet for a local folder, and before a show is open", async () => {
        folder = null;
        await opened();
        renderHook(() => useCloudSyncFolderNotice(false));
        await act(async () => {});
        expect(toast.warning).not.toHaveBeenCalled();
        expect(window.electron.getCloudSyncFolder).toHaveBeenCalledTimes(1);
    });

    it("stops warning for a show once told to, and only that show", async () => {
        await opened();
        const options = vi.mocked(toast.warning).mock.calls[0][1] as {
            cancel: { onClick: () => void };
        };
        options.cancel.onClick();

        await opened();
        expect(toast.warning).toHaveBeenCalledTimes(1);

        folder = { service: "OneDrive", filePath: "C:\\OneDrive\\Other.dots" };
        await opened();
        expect(toast.warning).toHaveBeenCalledTimes(2);
    });
});
