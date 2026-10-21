// PROTOTYPE (fork #357 spike): throwaway, do not build on this.
//
// Marcher query text (ADR 0008 D-7): pure parser + pure resolver.
//   atoms:     sel, all, #tag, T12, T1-6, T1-T6, section (singular/plural), family
//   operators: "," and "+" add, "-" removes, "&" intersects; left to right

import { FAMILIES, SECTIONS } from "@/global/classes/Sections";

export type Atom =
    | { kind: "sel" }
    | { kind: "all" }
    | { kind: "tag"; name: string }
    | { kind: "drill"; prefix: string; from: number; to: number }
    | { kind: "section"; name: string }
    | { kind: "family"; name: string };

export type Op = "add" | "remove" | "intersect";
export type MarcherQuery = { op: Op; atom: Atom; text: string }[];

type Fail = { ok: false; message: string; suggestions?: string[] };

const lev = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0]![j] = j;
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
            d[i]![j] = Math.min(
                d[i - 1]![j]! + 1,
                d[i]![j - 1]! + 1,
                d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
    return d[a.length]![b.length]!;
};

const suggest = (word: string, names: string[]) =>
    names
        .map((n) => ({ n, d: lev(word, n.toLowerCase()) }))
        .filter((x) => x.d <= Math.max(2, Math.floor(word.length / 3)))
        .sort((a, b) => a.d - b.d)
        .slice(0, 3)
        .map((x) => x.n);

/** Every spelling we accept for a name: as is, plural (+s/+es), singular (-s) */
const spellings = (name: string) => {
    const n = name.toLowerCase();
    const out = [n, n + "s", n + "es"];
    if (n.endsWith("s")) out.push(n.slice(0, -1));
    return out;
};

/** Words that would match more than one name, e.g. "bass" (3 sections). Reported, not guessed. */
function wordMatches(word: string): { section: string[]; family: string[] } {
    const w = word.toLowerCase();
    return {
        section: Object.values(SECTIONS)
            .filter((s) => spellings(s.name).includes(w))
            .map((s) => s.name),
        family: Object.values(FAMILIES)
            .filter((f) => spellings(f.name).includes(w))
            .map((f) => f.name),
    };
}

const DRILL = /^([a-z]{1,2})(\d+)(?:-(?:([a-z]{1,2}))?(\d+))?$/i;

function parseAtom(text: string): { ok: true; atom: Atom } | Fail {
    const t = text.trim();
    const lower = t.toLowerCase();
    if (lower === "sel" || lower === "selection" || lower === "selected")
        return { ok: true, atom: { kind: "sel" } };
    if (lower === "all" || lower === "everyone")
        return { ok: true, atom: { kind: "all" } };
    if (t.startsWith("#"))
        return t.length > 1
            ? { ok: true, atom: { kind: "tag", name: t.slice(1) } }
            : { ok: false, message: `"#" needs a tag name` };
    const d = t.replace(/\s+/g, "").match(DRILL);
    if (d) {
        const prefix = d[1]!.toUpperCase();
        if (d[3] && d[3].toUpperCase() !== prefix)
            return {
                ok: false,
                message: `"${t}": a range stays in one prefix (${prefix})`,
            };
        const from = Number(d[2]);
        const to = d[4] ? Number(d[4]) : from;
        return {
            ok: true,
            atom: {
                kind: "drill",
                prefix,
                from: Math.min(from, to),
                to: Math.max(from, to),
            },
        };
    }
    const { section, family } = wordMatches(t);
    if (section.length === 1 && family.length === 0)
        return { ok: true, atom: { kind: "section", name: section[0]! } };
    if (family.length === 1 && section.length === 0)
        return { ok: true, atom: { kind: "family", name: family[0]! } };
    if (section.length + family.length > 1)
        return {
            ok: false,
            message: `"${t}" could mean ${[...section, ...family].join(" or ")}`,
            suggestions: [...section, ...family],
        };
    // "bass" alone: a word that starts several names
    const starts = Object.values(SECTIONS)
        .map((s) => s.name)
        .filter((n) => n.toLowerCase().startsWith(lower + " "));
    if (starts.length > 0)
        return {
            ok: false,
            message: `"${t}" could mean ${starts.join(" or ")}`,
            suggestions: starts,
        };
    const names = [
        ...Object.values(SECTIONS).map((s) => s.name),
        ...Object.values(FAMILIES).map((f) => f.name),
        "sel",
        "all",
    ];
    return {
        ok: false,
        message: `"${t}" is not a section, family, tag or drill number`,
        suggestions: suggest(lower.replace(/s$/, ""), names),
    };
}

/** Splits on , + & and on "-" that isn't inside a drill range (T1-6, T1-T6). */
function tokenize(text: string): { op: Op; text: string }[] {
    const out: { op: Op; text: string }[] = [];
    let op: Op = "add";
    let buf = "";
    const flush = (next: Op) => {
        out.push({ op, text: buf });
        buf = "";
        op = next;
    };
    for (let i = 0; i < text.length; i++) {
        const c = text[i]!;
        if (c === "," || c === "+") flush("add");
        else if (c === "&") flush("intersect");
        else if (c === "-") {
            // A range: letters+digits right before, digits or letters+digits right after, no spaces
            const before =
                buf.match(/[a-z]{1,2}\d+$/i) && buf === buf.trimEnd();
            const after = /^([a-z]{1,2})?\d+/i.test(text.slice(i + 1));
            if (before && after) buf += c;
            else flush("remove");
        } else buf += c;
    }
    flush("add");
    return out;
}

export function parseMarcherQuery(
    text: string,
): { ok: true; query: MarcherQuery } | Fail {
    if (text.trim() === "") return { ok: false, message: "empty query" };
    const parts = tokenize(text);
    const query: MarcherQuery = [];
    for (const [i, part] of parts.entries()) {
        if (part.text.trim() === "") {
            // a leading "-" ("- T4") starts from nothing; empty elsewhere is a typo
            if (i === 0) continue;
            return {
                ok: false,
                message: `nothing after an operator in "${text}"`,
            };
        }
        const a = parseAtom(part.text);
        if (!a.ok) return a;
        query.push({
            op: i === 0 ? "add" : part.op,
            atom: a.atom,
            text: part.text.trim(),
        });
    }
    return { ok: true, query };
}

// ---------------------------------------------------------------------------

export interface QueryShow {
    marchers: readonly {
        id: number;
        section: string;
        drill_prefix: string;
        drill_order: number;
    }[];
    tags: readonly { name: string; marcherIds: readonly number[] }[];
    selection: readonly number[];
}

export function resolveMarcherQuery(
    query: MarcherQuery,
    show: QueryShow,
): { ok: true; ids: number[] } | Fail {
    const familyOf = (section: string) =>
        Object.values(SECTIONS).find((s) => s.name === section)?.family.name;
    let acc = new Set<number>();
    for (const { op, atom, text } of query) {
        let ids: number[];
        switch (atom.kind) {
            case "sel":
                ids = [...show.selection];
                if (ids.length === 0)
                    return { ok: false, message: `"sel": nothing is selected` };
                break;
            case "all":
                ids = show.marchers.map((m) => m.id);
                break;
            case "tag": {
                const tag = show.tags.find(
                    (t) => t.name.toLowerCase() === atom.name.toLowerCase(),
                );
                if (!tag)
                    return {
                        ok: false,
                        message: `no tag "#${atom.name}"`,
                        suggestions: suggest(
                            atom.name.toLowerCase(),
                            show.tags.map((t) => t.name),
                        ).map((n) => "#" + n),
                    };
                ids = [...tag.marcherIds];
                break;
            }
            case "drill":
                ids = show.marchers
                    .filter(
                        (m) =>
                            m.drill_prefix.toUpperCase() === atom.prefix &&
                            m.drill_order >= atom.from &&
                            m.drill_order <= atom.to,
                    )
                    .map((m) => m.id);
                break;
            case "section":
                ids = show.marchers
                    .filter((m) => m.section === atom.name)
                    .map((m) => m.id);
                break;
            case "family":
                ids = show.marchers
                    .filter((m) => familyOf(m.section) === atom.name)
                    .map((m) => m.id);
                break;
        }
        if (ids.length === 0) {
            const present = [
                ...new Set(show.marchers.map((m) => m.section)),
            ].sort();
            return {
                ok: false,
                message: `"${text}" matches no marchers in this show`,
                suggestions: present.slice(0, 5),
            };
        }
        if (op === "add") ids.forEach((id) => acc.add(id));
        else if (op === "remove") ids.forEach((id) => acc.delete(id));
        else acc = new Set(ids.filter((id) => acc.has(id)));
    }
    return { ok: true, ids: [...acc].sort((a, b) => a - b) };
}
