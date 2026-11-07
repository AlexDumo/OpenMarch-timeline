import { afterEach, describe, expect, it, vi } from "vitest";
import { revokeRefreshToken } from "../oauth-flow";

// Hoisted above the imports by vitest.

vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }));
vi.mock("../../../../src/global/auth/constants", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    CLERK_CONFIG: { DOMAIN: "clerk.example.test", CLIENT_ID: "client_1" },
    getClerkRevocationEndpoint: () =>
        "https://clerk.example.test/oauth/token/revoke",
}));

describe("revokeRefreshToken", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("asks Clerk's revocation endpoint to revoke the refresh token", async () => {
        const fetchMock = vi.fn(
            async () => new Response(null, { status: 200 }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await expect(revokeRefreshToken("refresh-1")).resolves.toBe(true);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [
            string,
            RequestInit,
        ];
        expect(url).toBe("https://clerk.example.test/oauth/token/revoke");
        expect(init.method).toBe("POST");
        const body = new URLSearchParams(init.body as URLSearchParams);
        expect(Object.fromEntries(body)).toEqual({
            client_id: "client_1",
            token: "refresh-1",
            token_type_hint: "refresh_token",
        });
    });

    it("reports false, without throwing, when Clerk turns it down", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("{}", { status: 400 })),
        );
        await expect(revokeRefreshToken("refresh-1")).resolves.toBe(false);
    });

    it("reports false, without throwing, when offline", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("fetch failed");
            }),
        );
        await expect(revokeRefreshToken("refresh-1")).resolves.toBe(false);
    });
});
