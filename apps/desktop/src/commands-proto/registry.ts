// PROTOTYPE (fork #357 spike): throwaway, do not build on this.
//
// list / run / runBatch over COMMANDS, with spike instrumentation: undo groups made per run, and a
// freshness probe taken the moment run() resolves.

import { count, countDistinct, gt, max, ne } from "drizzle-orm";
import { schema } from "@/global/database/db";
import {
    flattenUndoGroupsAbove,
    withTimelineWriteLock,
} from "@/db-functions/history";
import { readPageGrid } from "@/db-functions/timelineRipple";
import type { DbTransaction } from "@/db-functions/types";
import { allMarcherRowsQueryOptions } from "@/hooks/queries/useMarchers";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import { SECTIONS } from "@/global/classes/Sections";
import {
    closest,
    coerceArgs,
    paramsSchema,
    type Args,
    type CommandCtx,
    type CommandResult,
} from "./contract";
import { COMMANDS } from "./commands";
import { buildCtx } from "./ctx";

export function listCommands(ctx: CommandCtx = buildCtx()) {
    return COMMANDS.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        effects: c.effects,
        params: c.params.map((p) => ({
            key: p.key,
            label: p.label,
            kind: p.kind,
            default: p.default,
            range: p.range,
            options: p.options?.map((o) => o.value),
        })),
        schema: paramsSchema(c.params),
        available: c.available(ctx),
    }));
}

async function maxUndoGroup(ctx: CommandCtx): Promise<number> {
    const r = await ctx.db
        .select({ m: max(schema.history_undo.history_group) })
        .from(schema.history_undo)
        .get();
    return r?.m ?? 0;
}

async function groupsAbove(ctx: CommandCtx, g: number): Promise<number> {
    const r = await ctx.db
        .select({ n: countDistinct(schema.history_undo.history_group) })
        .from(schema.history_undo)
        .where(gt(schema.history_undo.history_group, g))
        .get();
    return r?.n ?? 0;
}

/** What each layer says right now. Stale = disagrees with the database. */
export async function freshness(ctx: CommandCtx) {
    const dbMarchers =
        (
            await ctx.db
                .select({ n: count() })
                .from(schema.marchers)
                .where(ne(schema.marchers.type, "item"))
                .get()
        )?.n ?? 0;
    const dbPages =
        (await ctx.db.select({ n: count() }).from(schema.pages).get())?.n ?? 0;
    const cached = ctx.queryClient.getQueryData(
        allMarcherRowsQueryOptions().queryKey,
    );
    const cachedPages = ctx.queryClient.getQueryData<unknown[]>(["pages"]);
    const resolver = useTimelineResolverStore.getState();
    const field = (
        window as unknown as {
            fieldTest?: { marchers(): unknown[]; pageId(): number | null };
        }
    ).fieldTest;
    return {
        dbMarchers,
        queryCacheMarcherRows: cached?.length ?? null,
        resolverMarchers: resolver.resolver?.marcherIds().length ?? null,
        resolverVersion: resolver.version,
        fieldMarchers: field ? field.marchers().length : null,
        dbPages,
        queryCachePages: cachedPages?.length ?? null,
        fieldPageId: field ? field.pageId() : null,
        selection: ctx.selection.ids().length,
    };
}

export async function runCommand(
    id: string,
    args: Args = {},
    opts: { probe?: boolean } = {},
): Promise<CommandResult> {
    const cmd = COMMANDS.find((c) => c.id === id);
    if (!cmd)
        return {
            ok: false,
            code: "E_UNKNOWN_COMMAND",
            message: `No command "${id}"`,
            suggestions: closest(
                id,
                COMMANDS.map((c) => c.id),
            ),
        };
    const ctx = buildCtx();
    const coerced = coerceArgs(cmd.params, args ?? {});
    if (!coerced.ok)
        return {
            ok: false,
            code: "E_ARGS",
            message: coerced.message,
            suggestions: coerced.suggestions,
        };
    const available = cmd.available(ctx);
    if (!available.ok)
        return { ok: false, code: "E_UNAVAILABLE", message: available.reason };
    const before = ctx.fileOpen ? await maxUndoGroup(ctx) : 0;
    const t0 = performance.now();
    let result: CommandResult;
    try {
        result = await cmd.run(ctx, coerced.value);
    } catch (e) {
        result = {
            ok: false,
            code: "E_EXCEPTION",
            message: e instanceof Error ? e.message : String(e),
        };
    }
    const ms = Math.round(performance.now() - t0);
    if (!ctx.fileOpen || opts.probe === false) return result;
    const ctxAfter = buildCtx();
    const undoGroups =
        id === "edit.undo" || id === "edit.redo"
            ? null
            : await groupsAbove(ctxAfter, before);
    const fresh = await freshness(ctxAfter);
    return {
        ...result,
        debug: {
            ...(result.debug ?? {}),
            ms,
            undoGroupsMade: undoGroups,
            freshAtResolve: fresh,
        },
    };
}

export async function runBatch(
    steps: readonly { id: string; args?: Args }[],
    label: string,
) {
    const ctx = buildCtx();
    if (!ctx.fileOpen)
        return {
            ok: false,
            code: "E_UNAVAILABLE",
            message: "Open a show first",
        };
    const before = await maxUndoGroup(ctx);
    const results: CommandResult[] = [];
    let failedAt: number | null = null;
    for (const [i, step] of steps.entries()) {
        const r = await runCommand(step.id, step.args ?? {}, { probe: false });
        results.push(r);
        if (!r.ok) {
            failedAt = i;
            break;
        }
    }
    const groupsBeforeFlatten = await groupsAbove(ctx, before);
    // Flatten under the write lock so an edit queued meanwhile can't interleave with the
    // rewrite. Anything the person did *between* the batch's commands is merged in regardless.
    if (groupsBeforeFlatten > 1)
        await withTimelineWriteLock(() =>
            flattenUndoGroupsAbove(ctx.db, before + 1),
        );
    const groupsAfterFlatten = await groupsAbove(ctx, before);
    return {
        ok: failedAt === null,
        label,
        // There's nowhere to store the label: history_undo is (sequence, history_group, sql)
        labelStored: false,
        summary: results
            .map((r) => (r.ok ? r.summary : `FAILED: ${r.message}`))
            .join("; "),
        failedAt,
        // A failed step leaves the earlier steps applied (each committed its own transaction)
        partialApplied: failedAt !== null && failedAt > 0,
        results,
        debug: {
            undoGroupsBeforeFlatten: groupsBeforeFlatten,
            undoGroupsAfterFlatten: groupsAfterFlatten,
            freshAtResolve: await freshness(buildCtx()),
        },
    };
}

export async function showSummary() {
    const ctx = buildCtx();
    const base = {
        fileOpen: ctx.fileOpen,
        mode: ctx.mode,
        workspace: ctx.workspace,
        resolverStatus: ctx.resolverStatus,
        isPlaying: ctx.isPlaying,
        playheadBeat: ctx.playheadBeat,
    };
    if (!ctx.fileOpen) return base;
    const grid = await readPageGrid(ctx.db as unknown as DbTransaction);
    const marchers = await ctx.db
        .select({
            id: schema.marchers.id,
            section: schema.marchers.section,
            prefix: schema.marchers.drill_prefix,
            order: schema.marchers.drill_order,
        })
        .from(schema.marchers)
        .where(ne(schema.marchers.type, "item"));
    const sections = new Map<string, { count: number; numbers: number[] }>();
    for (const m of marchers) {
        const s = sections.get(m.section) ?? { count: 0, numbers: [] };
        s.count++;
        s.numbers.push(m.order);
        sections.set(m.section, s);
    }
    const prefixOf = (name: string) =>
        Object.values(SECTIONS).find((s) => s.name === name)?.prefix ?? "?";
    const sel = new Set(ctx.selection.ids());
    return {
        ...base,
        beats: grid.beatIds.length,
        pages: grid.pages.map((p) => ({
            id: p.id,
            name: p.name,
            beats: [p.start, p.end],
        })),
        marchers: marchers.length,
        sections: [...sections].map(([name, s]) => ({
            name,
            count: s.count,
            drill: `${prefixOf(name)}${Math.min(...s.numbers)}-${Math.max(...s.numbers)}`,
        })),
        selection: marchers
            .filter((m) => sel.has(m.id))
            .map((m) => `${m.prefix}${m.order}`),
        freshness: await freshness(ctx),
    };
}
