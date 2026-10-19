// cspell:ignore abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Bytes, sha256Hex } from "../hash";
import { uuid } from "../ids";

const hex = (b: Uint8Array) =>
    [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const utf8 = (s: string) => new TextEncoder().encode(s);

afterEach(() => vi.unstubAllGlobals());

describe("sha256 without crypto.subtle (plain HTTP pages)", () => {
    it("matches the FIPS 180-4 test vectors", () => {
        expect(hex(sha256Bytes(utf8("")))).toBe(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        );
        expect(hex(sha256Bytes(utf8("abc")))).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
        expect(
            hex(
                sha256Bytes(
                    utf8(
                        "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
                    ),
                ),
            ),
        ).toBe(
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
        );
    });

    it("gives the same hash as crypto.subtle", async () => {
        const data = new Uint8Array(1000).map((_, i) => (i * 7) & 255);
        const native = await sha256Hex(data.buffer);
        vi.stubGlobal("crypto", {
            getRandomValues: crypto.getRandomValues.bind(crypto),
        });
        expect(await sha256Hex(data.buffer)).toBe(native);
    });
});

describe("uuid", () => {
    it("builds a v4 uuid without crypto.randomUUID", () => {
        vi.stubGlobal("crypto", {
            getRandomValues: crypto.getRandomValues.bind(crypto),
        });
        const id = uuid();
        expect(id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(uuid()).not.toBe(id);
    });
});
