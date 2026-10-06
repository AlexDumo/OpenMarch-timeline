import { describe, expect, it } from "vitest";
import en from "../../../../i18n/en.json";
import { audioOffsetHint, formatAudioOffset } from "../audioOffset";

const text = ({ key, params }: ReturnType<typeof audioOffsetHint>) =>
    (
        key
            .split(".")
            .reduce<unknown>(
                (node, part) => (node as Record<string, unknown>)[part],
                en,
            ) as string
    ).replace(/\{(\w+)\}/g, (_, name: string) => params[name]!);

describe("the Audio Offset field (FX-5)", () => {
    it("shows milliseconds, without float noise", () => {
        expect(formatAudioOffset(-0.5000000000000002)).toBe("-0.5");
        expect(formatAudioOffset(0.1234)).toBe("0.123");
        expect(formatAudioOffset(-0.0001)).toBe("0");
        expect(formatAudioOffset(2)).toBe("2");
    });

    it("says in words which way its sign goes", () => {
        expect(text(audioOffsetHint(-0.5000000000000002))).toBe(
            "Music starts 0.500 s before count 1: count 1 is 0.500 s into the recording.",
        );
        expect(text(audioOffsetHint(0.5))).toBe(
            "Music starts 0.500 s after count 1 (silence first). If count 1 is 0.500 s into the recording instead, type -0.500.",
        );
        expect(audioOffsetHint(0).key).toBe("music.audioOffsetHint.on");
    });
});
