// PROTOTYPE (fork #357 spike): throwaway, do not build on this.
//
// The command contract from draft ADR 0008 (fork PR #373), as small as it can be.

import type { QueryClient } from "@tanstack/react-query";
import type { DbConnection } from "@/db-functions/types";
import type Marcher from "@/global/classes/Marcher";
import { SECTIONS } from "@/global/classes/Sections";
import { parseMarcherQuery, type MarcherQuery } from "./query";

export type Availability = { ok: true } | { ok: false; reason: string };

export type CommandResult =
    | {
          ok: true;
          summary: string;
          /** What changed, by kind: ids the agent can use without re-querying */
          changed?: {
              marchers?: number[];
              pages?: number[];
              selection?: number[];
          };
          /** Spike instrumentation (not part of the contract) */
          debug?: Record<string, unknown>;
      }
    | {
          ok: false;
          code: string;
          message: string;
          suggestions?: string[];
          debug?: Record<string, unknown>;
      };

export type ParamKind =
    | "count"
    | "beat"
    | "section"
    | "marchers"
    | "enum"
    | "text";

export type ParseResult<T> =
    | { ok: true; value: T }
    | { ok: false; message: string; suggestions?: string[] };

export interface CommandParam {
    key: string;
    label: string;
    kind: ParamKind;
    default?: unknown;
    range?: { min?: number; max?: number };
    /** enum only */
    options?: readonly { value: string; aliases?: readonly string[] }[];
    optional?: boolean;
}

/**
 * Everything a command may touch, handed in. Every field is something run() would otherwise
 * reach for as a global, a hook or a mounted component; `source` says where each came from in
 * this spike (see FINDINGS.md section 1).
 */
export interface CommandCtx {
    db: DbConnection;
    queryClient: QueryClient;
    /** False when no show is open (the editor's React tree isn't mounted) */
    fileOpen: boolean;
    mode: "basic" | "expert";
    workspace: "editor" | "visuals" | "preview";
    resolverStatus: string;
    playheadBeat: number;
    isPlaying: boolean;
    selection: {
        ids(): number[];
        set(ids: readonly number[]): Promise<void>;
    };
    /** The rows the selection setter needs (Marcher objects, not ids) */
    marchers(): Promise<Marcher[]>;
    view: {
        focusField(rect: {
            minX: number;
            minY: number;
            maxX: number;
            maxY: number;
        }): boolean;
    };
    dialogs: { openExport(tab: string): void };
    pages: { select(pageId: number): void };
    history: { undo(): Promise<unknown>; redo(): Promise<unknown> };
    isWebBuild: boolean;
}

export type Args = Record<string, unknown>;

export interface Command {
    id: string;
    title: string;
    description: string;
    params: CommandParam[];
    effects: "read" | "view" | "opensUi" | "editsDrill" | "destructive";
    available(ctx: CommandCtx): Availability;
    run(ctx: CommandCtx, args: Args): Promise<CommandResult>;
}

// ---------------------------------------------------------------------------
// Param kinds: parse typed text, format back. JSON args go through `coerce`.
// ---------------------------------------------------------------------------

const sectionNames = () => Object.values(SECTIONS).map((s) => s.name);

export function parseSectionName(text: string): ParseResult<string> {
    const t = text.trim().toLowerCase();
    for (const name of sectionNames()) {
        const n = name.toLowerCase();
        if (t === n || t === n + "s" || t === n + "es")
            return { ok: true, value: name };
    }
    // a typo or a word we lack ("percussion") gets suggestions
    return {
        ok: false,
        message: `"${text}" is not a section`,
        suggestions: closest(t, sectionNames()),
    };
}

export function parseParam(
    param: CommandParam,
    text: string,
): ParseResult<unknown> {
    const t = text.trim();
    switch (param.kind) {
        case "count": {
            const n = Number(t);
            if (!Number.isInteger(n))
                return { ok: false, message: `"${t}" is not a whole number` };
            if (param.range?.min !== undefined && n < param.range.min)
                return {
                    ok: false,
                    message: `${param.label} must be at least ${param.range.min}`,
                };
            if (param.range?.max !== undefined && n > param.range.max)
                return {
                    ok: false,
                    message: `${param.label} must be at most ${param.range.max}`,
                };
            return { ok: true, value: n };
        }
        case "beat": {
            // "17", "beat 17", "b17", "count 17", "here"/"playhead". NOT "m5" (needs measures,
            // which live in a React hook's view model) and NOT "p7" (that's a page, not a beat).
            if (/^(here|playhead)$/i.test(t))
                return { ok: true, value: "playhead" };
            const m = t.match(/^(?:beat|b|count|c)?\s*(\d+)$/i);
            if (!m)
                return {
                    ok: false,
                    message: `"${t}" is not a beat (try "beat 17" or "here")`,
                };
            return { ok: true, value: Number(m[1]) };
        }
        case "section":
            return parseSectionName(t);
        case "marchers": {
            const q = parseMarcherQuery(t);
            return q.ok ? { ok: true, value: t } : q;
        }
        case "enum": {
            const lower = t.toLowerCase();
            const hits = (param.options ?? []).filter(
                (o) =>
                    o.value === lower ||
                    (o.aliases ?? []).some((a) => a === lower),
            );
            if (hits.length === 1) return { ok: true, value: hits[0]!.value };
            const values = (param.options ?? []).map((o) => o.value);
            if (hits.length > 1)
                return {
                    ok: false,
                    message: `"${t}" could mean ${hits.map((h) => h.value).join(" or ")}`,
                    suggestions: hits.map((h) => h.value),
                };
            return {
                ok: false,
                message: `"${t}" is not one of ${values.join(", ")}`,
                suggestions: closest(lower, values),
            };
        }
        case "text":
            return { ok: true, value: t };
    }
}

export function formatParam(param: CommandParam, value: unknown): string {
    switch (param.kind) {
        case "beat":
            return value === "playhead" ? "here" : `beat ${String(value)}`;
        default:
            return String(value);
    }
}

/** JSON args from an agent: strings parse like typed text, numbers pass through for count/beat. */
export function coerceArgs(
    params: readonly CommandParam[],
    args: Args,
): ParseResult<Args> {
    const out: Args = {};
    const known = new Set(params.map((p) => p.key));
    const unknown = Object.keys(args).filter((k) => !known.has(k));
    if (unknown.length > 0)
        return {
            ok: false,
            message: `unknown argument(s): ${unknown.join(", ")}`,
            suggestions: [...known],
        };
    for (const p of params) {
        const raw = args[p.key];
        if (raw === undefined || raw === null || raw === "") {
            if (p.default !== undefined) out[p.key] = p.default;
            else if (!p.optional)
                return { ok: false, message: `missing ${p.label} (${p.key})` };
            continue;
        }
        if (
            typeof raw === "number" &&
            (p.kind === "count" || p.kind === "beat")
        ) {
            const r = parseParam(p, String(raw));
            if (!r.ok) return r;
            out[p.key] = r.value;
            continue;
        }
        if (typeof raw !== "string")
            return {
                ok: false,
                message: `${p.key} must be a string or number, got ${typeof raw}`,
            };
        const r = parseParam(p, raw);
        if (!r.ok) return r;
        out[p.key] = r.value;
    }
    return { ok: true, value: out };
}

/** A rough JSON Schema for a param list (what an agent would see) */
export function paramsSchema(params: readonly CommandParam[]) {
    const props: Record<string, unknown> = {};
    for (const p of params) {
        const base: Record<string, unknown> = { description: p.label };
        if (p.kind === "count")
            props[p.key] = {
                ...base,
                type: "integer",
                minimum: p.range?.min,
                maximum: p.range?.max,
            };
        else if (p.kind === "beat")
            props[p.key] = {
                ...base,
                anyOf: [{ type: "integer", minimum: 1 }, { const: "here" }],
            };
        else if (p.kind === "enum")
            props[p.key] = {
                ...base,
                enum: (p.options ?? []).map((o) => o.value),
            };
        else if (p.kind === "section")
            props[p.key] = { ...base, enum: sectionNames() };
        else if (p.kind === "marchers")
            props[p.key] = {
                ...base,
                type: "string",
                description: `${p.label}: marcher query, e.g. "T1-6, brass - T4", "#rifles", "sel"`,
            };
        else props[p.key] = { ...base, type: "string" };
    }
    return {
        type: "object",
        properties: props,
        required: params
            .filter((p) => !p.optional && p.default === undefined)
            .map((p) => p.key),
    };
}

// ---------------------------------------------------------------------------

function editDistance(a: string, b: string): number {
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
}

export function closest(text: string, candidates: readonly string[], n = 3) {
    return [...candidates]
        .map((c) => ({ c, d: editDistance(text, c.toLowerCase()) }))
        .sort((a, b) => a.d - b.d)
        .filter((x) => x.d <= Math.max(2, Math.floor(text.length / 2)))
        .slice(0, n)
        .map((x) => x.c);
}

export type { MarcherQuery };
