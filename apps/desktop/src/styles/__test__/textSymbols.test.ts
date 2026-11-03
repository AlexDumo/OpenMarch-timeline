import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { FIELD_LABEL_FONT, TEXT_SYMBOLS_FAMILY } from "../textSymbols";

/**
 * Keeps symbols from showing as color emoji (see text-symbols.css). Some characters, such
 * as ↩ and ↔, are text by default but have an emoji form; when the UI font lacks one, the
 * browser can land on an emoji font in `--font-sans`. A trailing U+FE0E doesn't prevent
 * that in Chromium. So every such character in UI text must be covered by
 * "OpenMarch Text Symbols", and real emoji (🎺, or a character followed by U+FE0F) are
 * only allowed where listed below.
 */

const DESKTOP = resolve(__dirname, "../../..");
const REPO = resolve(DESKTOP, "../..");

/** Emoji written on purpose; each entry must still be in use */
const INTENDED_EMOJI: { path: RegExp; chars: string; why: string }[] = [
    {
        path: /^apps\/desktop\/i18n\/[^/]+\.json$/,
        chars: "🎭🎺📋🧹👟🖌🎯",
        why: "export loading messages and the Playwright codegen banner",
    },
    {
        path: /^apps\/desktop\/src\/App\.tsx$/,
        chars: "🎭",
        why: "a console message in Playwright codegen mode",
    },
];

/** Text-default emoji characters DM Sans itself draws, so they never reach an emoji font */
const IN_DM_SANS = [..."©®™"].map((ch) => ch.codePointAt(0)!);

const VS15 = 0xfe0e;
const VS16 = 0xfe0f;
const isPictographic = (ch: string) => /\p{Extended_Pictographic}/u.test(ch);
const isEmojiByDefault = (ch: string) => /\p{Emoji_Presentation}/u.test(ch);

function walk(dir: string, keep: (path: string) => boolean): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            if (["node_modules", "__test__", "generated"].includes(entry.name))
                return [];
            return walk(path, keep);
        }
        return keep(path) ? [path] : [];
    });
}

/** Source files whose text can reach the screen, as repo-relative paths */
function uiTextFiles(): string[] {
    const source = (path: string) =>
        /\.tsx?$/.test(path) && !/\.(test|spec)\.tsx?$/.test(path);
    return [
        ...walk(resolve(DESKTOP, "src"), source).filter(
            (path) => !path.startsWith(resolve(DESKTOP, "src/test") + "/"),
        ),
        ...walk(resolve(REPO, "packages/ui/src"), source),
        ...walk(resolve(DESKTOP, "i18n"), (path) => path.endsWith(".json")),
    ].map((path) => relative(REPO, path));
}

/** Lines that are only a comment can't reach the screen */
const isCommentLine = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line);

function parseUnicodeRanges(css: string): Set<number> {
    const covered = new Set<number>();
    for (const [, ranges] of css.matchAll(/unicode-range:([^;]+);/g)) {
        for (const [, from, to] of ranges!.matchAll(
            /U\+([0-9A-F]+)(?:-([0-9A-F]+))?/gi,
        )) {
            const start = parseInt(from!, 16);
            const end = to ? parseInt(to, 16) : start;
            for (let c = start; c <= end; c++) covered.add(c);
        }
    }
    return covered;
}

const symbolsCss = readFileSync(
    resolve(DESKTOP, "src/styles/text-symbols.css"),
    "utf8",
);

describe("text symbols never show as color emoji", () => {
    it("lists the symbols family after DM Sans and before every emoji font", () => {
        const tailwind = readFileSync(
            resolve(REPO, "packages/ui/src/tailwind.css"),
            "utf8",
        );
        const stack = /--font-sans:([^;]+);/
            .exec(tailwind)![1]!
            .split(",")
            .map((family) => family.trim().replace(/^"|"$/g, ""));
        expect(stack.slice(0, 2)).toEqual(["DM Sans", TEXT_SYMBOLS_FAMILY]);
        const firstEmoji = stack.findIndex((family) => /emoji/i.test(family));
        expect(firstEmoji).toBeGreaterThan(1);
        expect(FIELD_LABEL_FONT).toContain(`"${TEXT_SYMBOLS_FAMILY}"`);
    });

    it("defines the family from font files that exist, and loads it", () => {
        const require = createRequire(resolve(DESKTOP, "package.json"));
        const urls = [...symbolsCss.matchAll(/url\("([^"]+)"\)/g)].map(
            ([, url]) => url!,
        );
        expect(urls.length).toBeGreaterThan(0);
        for (const url of urls)
            expect(existsSync(require.resolve(url))).toBe(true);
        expect(symbolsCss).toContain(`font-family: "${TEXT_SYMBOLS_FAMILY}"`);
        expect(
            readFileSync(resolve(DESKTOP, "src/main.tsx"), "utf8"),
        ).toContain('import "./styles/text-symbols.css"');
    });

    it("covers every text-default emoji character in UI text, and emoji are intended", () => {
        const covered = parseUnicodeRanges(symbolsCss);
        for (const code of IN_DM_SANS) covered.add(code);
        const used = new Set<RegExp>();
        const problems: string[] = [];
        for (const file of uiTextFiles()) {
            const lines = readFileSync(resolve(REPO, file), "utf8").split("\n");
            lines.forEach((line, index) => {
                if (isCommentLine(line)) return;
                const chars = [...line];
                chars.forEach((ch, i) => {
                    if (!isPictographic(ch)) return;
                    const at = `${file}:${index + 1}`;
                    const code = ch.codePointAt(0)!;
                    const name = `${ch} U+${code.toString(16).toUpperCase()}`;
                    const next = chars[i + 1]?.codePointAt(0);
                    if (isEmojiByDefault(ch) || next === VS16) {
                        const allowed = INTENDED_EMOJI.find(
                            (entry) =>
                                entry.path.test(file) &&
                                [...entry.chars].includes(ch),
                        );
                        if (allowed) used.add(allowed.path);
                        else
                            problems.push(
                                `${at}: emoji ${name}. If it's meant, add it to INTENDED_EMOJI; else use a text symbol or a Phosphor icon`,
                            );
                    } else if (!covered.has(code)) {
                        problems.push(
                            `${at}: ${name} can show as an emoji and "${TEXT_SYMBOLS_FAMILY}" has no text glyph for it${next === VS15 ? " (U+FE0E doesn't stop that in Chromium)" : ""}; add a font face for it or use a Phosphor icon`,
                        );
                    }
                });
            });
        }
        expect(problems).toEqual([]);
        expect(
            INTENDED_EMOJI.filter((entry) => !used.has(entry.path)).map(
                (entry) => entry.why,
            ),
        ).toEqual([]);
    });
});
