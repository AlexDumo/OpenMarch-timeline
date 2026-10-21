// PROTOTYPE (fork #357 spike): throwaway, do not build on this.
//
// Rough sentence parser for the / bar: "[who] verb [arguments]"; a bare "who" selects.
// Returns the command call it means, or an error. `notes` records every guess it had to make.

import { parseSectionName } from "./contract";
import { parseMarcherQuery } from "./query";

export type SentenceParse =
    | { ok: true; id: string; args: Record<string, unknown>; notes: string[] }
    | { ok: false; message: string; suggestions?: string[]; notes: string[] };

const VERBS = [
    "select",
    "create",
    "add",
    "focus",
    "frame",
    "zoom",
    "export",
    "undo",
    "redo",
];

export function parseSentence(input: string): SentenceParse {
    const notes: string[] = [];
    const text = input.trim().replace(/\s+/g, " ");
    if (!text) return { ok: false, message: "Type a command", notes };
    const lower = text.toLowerCase();

    if (lower === "undo") return { ok: true, id: "edit.undo", args: {}, notes };
    if (lower === "redo") return { ok: true, id: "edit.redo", args: {}, notes };

    // add page [at] <beat> | new page at <beat> | page at <beat>
    const page = lower.match(
        /^(?:(?:add|new|create) )?page(?: (at|on))?(?: (?:beat|count|b) ?)?(?: ?(\d+|here|playhead))?$/,
    );
    if (page) {
        if (!page[1] && page[2] && /^\d+$/.test(page[2]))
            notes.push(
                `"page ${page[2]}" read as a beat; in the go-to box "${page[2]}" means page ${page[2]}`,
            );
        return {
            ok: true,
            id: "page.addAt",
            args: { beat: page[2] ?? "here" },
            notes,
        };
    }

    // create|add <count> <section>
    const create = lower.match(/^(?:create|add|new) (\d+) (.+)$/);
    if (create) {
        const section = parseSectionName(create[2]!);
        if (!section.ok)
            return {
                ok: false,
                message: section.message,
                suggestions: section.suggestions,
                notes,
            };
        return {
            ok: true,
            id: "marchers.create",
            args: { count: Number(create[1]), section: section.value },
            notes,
        };
    }
    if (/^(create|add|new)\b/.test(lower))
        return {
            ok: false,
            message: `Say how many and which section, e.g. "create 12 trumpets"`,
            notes,
        };

    // export <tab>
    const exp = lower.match(/^export(?: (.+))?$/);
    if (exp)
        return {
            ok: true,
            id: "export.open",
            args: exp[1] ? { tab: exp[1] } : {},
            notes,
        };

    // focus|frame|zoom [to] <who>   (verb first)
    const focus = text.match(
        /^(?:focus|frame|zoom(?: to)?)(?: on)?(?: (.+))?$/i,
    );
    if (focus)
        return {
            ok: true,
            id: "view.focus",
            args: { who: focus[1] ?? "sel" },
            notes,
        };

    // select <who>   (verb first)
    const sel = text.match(/^select (.+)$/i);
    if (sel) return { ok: true, id: "select", args: { who: sel[1] }, notes };

    // <who> focus | <who> select   (who first, as the grammar says)
    const whoVerb = text.match(/^(.+) (focus|frame|select)$/i);
    if (whoVerb) {
        notes.push("who-first form");
        return {
            ok: true,
            id:
                whoVerb[2]!.toLowerCase() === "select"
                    ? "select"
                    : "view.focus",
            args: { who: whoVerb[1] },
            notes,
        };
    }

    // bare who = select
    const q = parseMarcherQuery(text);
    if (q.ok) return { ok: true, id: "select", args: { who: text }, notes };
    const first = lower.split(" ")[0]!;
    const verbHint = VERBS.filter(
        (v) => v[0] === first[0] && Math.abs(v.length - first.length) <= 2,
    );
    return {
        ok: false,
        message: q.message,
        suggestions: [...(q.suggestions ?? []), ...verbHint],
        notes,
    };
}
