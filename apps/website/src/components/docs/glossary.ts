/**
 * The glossary's entries, read from the Glossary page itself, so a term's hover text can't
 * disagree with its entry. Each entry is a `## Heading` followed by its definition; the hover text
 * is the definition's first sentence, as plain text.
 */
import source from "../../content/docs/guides/reference/glossary.mdx?raw";
import { uiText } from "./uiText";

export const GLOSSARY_URL = "/guides/reference/glossary/";

/** The anchor Starlight gives a heading: lowercase, punctuation dropped, spaces as hyphens. */
export function headingSlug(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .trim()
        .replace(/\s/g, "-");
}

function plain(markdown: string): string {
    return markdown
        .replace(/<Ui k="([^"]+)"[^>]*\/>/g, (_, k: string) => uiText(k))
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/[`*_]/g, "")
        .trim();
}

function firstSentence(text: string): string {
    const match = /^.+?[.!?](?=\s|$)/.exec(text);
    return match ? match[0] : text;
}

let cache: Map<string, { term: string; definition: string }> | undefined;

/** Every entry by its anchor: the term as headed, and the first sentence of its definition. */
export function glossaryEntries() {
    if (cache) return cache;
    cache = new Map();
    for (const block of source.split(/\n## /).slice(1)) {
        const [heading, ...rest] = block.split("\n");
        const paragraph = rest.find((line) => line.trim() !== "") ?? "";
        cache.set(headingSlug(heading), {
            term: heading.trim(),
            definition: firstSentence(plain(paragraph)),
        });
    }
    return cache;
}
