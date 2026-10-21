// PROTOTYPE (fork #357 spike): throwaway, do not build on this.
//
// The five spike commands (+ undo/redo and the legacy-action adapter) on the contract.

import { eq, ne } from "drizzle-orm";
import { schema } from "@/global/database/db";
import { SECTIONS } from "@/global/classes/Sections";
import { createMarchers } from "@/db-functions/marcher";
import { addPageFlag, planPageFlagInsertion } from "@/db-functions/pageFlags";
import { readPageGrid } from "@/db-functions/timelineRipple";
import type { DbTransaction } from "@/db-functions/types";
import { invalidatePageQueries } from "@/hooks/queries/usePages";
import { useTimelineResolverStore } from "@/timeline/timelineStore";
import {
    fieldBeat,
    useTimelineSelectionStore,
} from "@/stores/TimelineSelectionStore";
import { useFieldViewStore } from "@/field/three/fieldView";
import {
    hasActionHandler,
    isActionEnabled,
    runAction,
} from "@/shortcuts/registry";
import { ACTION_IDS, type ActionId } from "@/shortcuts/definitions";
import { isActionOffInWorkspace } from "@/shortcuts/workspaceActions";
import type {
    Availability,
    Command,
    CommandCtx,
    CommandResult,
} from "./contract";
import { closest } from "./contract";
import {
    parseMarcherQuery,
    resolveMarcherQuery,
    type QueryShow,
} from "./query";

// ---------------------------------------------------------------------------
// Availability building blocks. Every reason string is made up here: nothing in the app
// returns a reason (isActionEnabled is a boolean; the palette's two reasons are i18n keys
// picked in actionSource.tsx:97).
// ---------------------------------------------------------------------------

const OK: Availability = { ok: true };
const needsShow = (ctx: CommandCtx): Availability =>
    ctx.fileOpen ? OK : { ok: false, reason: "Open a show first" };
const editsDrill = (ctx: CommandCtx): Availability => {
    const a = needsShow(ctx);
    if (!a.ok) return a;
    if (ctx.workspace === "preview")
        return {
            ok: false,
            reason: "Preview edits nothing. Leave Preview first",
        };
    if (ctx.workspace === "visuals")
        return {
            ok: false,
            reason: "Edits the drill. Switch from Visuals to the Editor",
        };
    return OK;
};
const needsResolver = (ctx: CommandCtx): Availability =>
    ctx.resolverStatus === "ready"
        ? OK
        : {
              ok: false,
              reason: `The timeline is not ready (${ctx.resolverStatus})`,
          };
const all = (...as: Availability[]): Availability =>
    as.find((a) => !a.ok) ?? OK;

const fail = (
    code: string,
    message: string,
    suggestions?: string[],
): CommandResult => ({ ok: false, code, message, suggestions });

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

export async function readQueryShow(ctx: CommandCtx): Promise<QueryShow> {
    const marchers = await ctx.db
        .select({
            id: schema.marchers.id,
            section: schema.marchers.section,
            drill_prefix: schema.marchers.drill_prefix,
            drill_order: schema.marchers.drill_order,
        })
        .from(schema.marchers)
        .where(ne(schema.marchers.type, "item"));
    const tagRows = await ctx.db
        .select({
            name: schema.tags.name,
            tagId: schema.tags.id,
            marcherId: schema.marcher_tags.marcher_id,
        })
        .from(schema.tags)
        .leftJoin(
            schema.marcher_tags,
            eq(schema.marcher_tags.tag_id, schema.tags.id),
        );
    const tags = new Map<string, number[]>();
    for (const r of tagRows) {
        const name = r.name?.trim() || `tag-${r.tagId}`;
        if (!tags.has(name)) tags.set(name, []);
        if (r.marcherId != null) tags.get(name)!.push(r.marcherId);
    }
    return {
        marchers,
        tags: [...tags].map(([name, marcherIds]) => ({ name, marcherIds })),
        selection: ctx.selection.ids(),
    };
}

async function resolveWho(
    ctx: CommandCtx,
    text: string,
): Promise<{ ok: true; ids: number[]; show: QueryShow } | CommandResult> {
    const parsed = parseMarcherQuery(text);
    if (!parsed.ok) return fail("E_QUERY", parsed.message, parsed.suggestions);
    const show = await readQueryShow(ctx);
    const r = resolveMarcherQuery(parsed.query, show);
    if (!r.ok) return fail("E_QUERY", r.message, r.suggestions);
    return { ok: true, ids: r.ids, show };
}

const drillList = (show: QueryShow, ids: readonly number[]) => {
    const byId = new Map(show.marchers.map((m) => [m.id, m]));
    const names = ids
        .map((id) => byId.get(id))
        .filter((m) => m !== undefined)
        .map((m) => `${m.drill_prefix}${m.drill_order}`);
    return names.length <= 8
        ? names.join(", ")
        : `${names.slice(0, 6).join(", ")} … ${names[names.length - 1]}`;
};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const select: Command = {
    id: "select",
    title: "Select marchers",
    description:
        "Select the marchers a query names, e.g. 'trumpets', 'brass - T4', 'T1-6, #rifles'. Replaces the selection.",
    params: [{ key: "who", label: "Marchers", kind: "marchers" }],
    effects: "view",
    available: (ctx) =>
        all(
            needsShow(ctx),
            ctx.workspace === "preview"
                ? { ok: false, reason: "Preview has no selection" }
                : OK,
        ),
    async run(ctx, args) {
        const who = await resolveWho(ctx, String(args.who));
        if (!("ids" in who)) return who;
        await ctx.selection.set(who.ids);
        // Read back: did the selection take every id? (hidden marchers are dropped by the provider)
        const now = ctx.selection.ids();
        return {
            ok: true,
            summary: `Selected ${now.length} marcher${now.length === 1 ? "" : "s"}: ${drillList(who.show, now)}`,
            changed: { selection: now },
            debug:
                now.length !== who.ids.length
                    ? { asked: who.ids.length, got: now.length }
                    : undefined,
        };
    },
};

const createMarchersCommand: Command = {
    id: "marchers.create",
    title: "Create marchers",
    description:
        "Create COUNT marchers in SECTION. Drill numbers continue after the section's highest; each new marcher gets a home spot.",
    params: [
        {
            key: "count",
            label: "How many",
            kind: "count",
            range: { min: 1, max: 200 },
        },
        { key: "section", label: "Section", kind: "section" },
    ],
    effects: "editsDrill",
    available: (ctx) => editsDrill(ctx),
    async run(ctx, args) {
        const count = Number(args.count);
        const section = Object.values(SECTIONS).find(
            (s) => s.name === args.section,
        )!;
        // Same rule as MarcherForm.tsx:146, but by prefix max, not "first free from the typed start"
        const existing = await ctx.db
            .select({ order: schema.marchers.drill_order })
            .from(schema.marchers)
            .where(eq(schema.marchers.drill_prefix, section.prefix));
        const start = existing.reduce((m, r) => Math.max(m, r.order), 0) + 1;
        const created = await createMarchers({
            db: ctx.db,
            newMarchers: Array.from({ length: count }, (_, i) => ({
                section: section.name,
                drill_prefix: section.prefix,
                drill_order: start + i,
            })),
        });
        // createMarchersMutationOptions does this in onSuccess (hooks/queries/useMarchers.ts:111):
        // forget it and the UI never shows the new marchers
        await ctx.queryClient.invalidateQueries({ queryKey: ["marchers"] });
        const first = `${section.prefix}${start}`;
        const last = `${section.prefix}${start + count - 1}`;
        return {
            ok: true,
            summary: `Created ${count} ${section.name}${count === 1 ? "" : "s"}, ${count === 1 ? first : `${first} to ${last}`}`,
            changed: { marchers: created.map((m) => m.id) },
        };
    },
};

const addPageAt: Command = {
    id: "page.addAt",
    title: "Add a page at a beat",
    description:
        "Add a page flag at BEAT (a timeline beat, 1 = the start; or 'here' for the playhead). Inside a page it splits that page; past the last flag it adds a page ending there. In Basic it also splits moves at the flag.",
    params: [{ key: "beat", label: "Beat", kind: "beat", default: "playhead" }],
    effects: "editsDrill",
    available: (ctx) =>
        all(
            editsDrill(ctx),
            ctx.isPlaying ? { ok: false, reason: "Stop playback first" } : OK,
        ),
    async run(ctx, args) {
        const beat =
            args.beat === "playhead" ? ctx.playheadBeat : Number(args.beat);
        // readPageGrid takes a tx; a plain connection works (same query API)
        const grid = await readPageGrid(ctx.db as unknown as DbTransaction);
        const plan = planPageFlagInsertion(
            { beatCount: grid.beatIds.length, pages: grid.pages },
            beat,
        );
        // addPageFlag also stores endless counts before planning an append far past the end;
        // the check above only refuses what it would refuse anyway (on a flag, at home)
        if (!plan && beat <= grid.beatIds.length) {
            const on = grid.pages.find(
                (p) => p.end === beat || p.start === beat,
            );
            return fail(
                "E_NO_PAGE_HERE",
                on
                    ? `Beat ${beat} is already on page ${on.name ?? on.id}'s flag`
                    : `No page can be added at beat ${beat} (home, or between counts)`,
            );
        }
        const added = await addPageFlag({
            db: ctx.db,
            beat,
            splitMoves: ctx.mode === "basic",
        });
        await invalidatePageQueries(ctx.queryClient, () =>
            ctx.pages.select(added.page.id),
        );
        const after = await readPageGrid(ctx.db as unknown as DbTransaction);
        const name =
            after.pages.find((p) => p.id === added.page.id)?.name ??
            String(added.page.id);
        return {
            ok: true,
            summary: `Added page ${name}, beats ${added.startBeat} to ${added.endBeat}${ctx.mode === "basic" ? " (moves split at the flag)" : ""}`,
            // Basic's split says which marchers' moves it split: ids for free, no re-query
            changed: {
                pages: [added.page.id],
                ...(added.splitMoves
                    ? { marchers: added.splitMoves.split }
                    : {}),
            },
            debug: {
                mode: ctx.mode,
                splitMoves: added.splitMoves
                    ? {
                          split: added.splitMoves.split.length,
                          leftAlone: added.splitMoves.leftAlone.length,
                      }
                    : null,
            },
        };
    },
};

const focus: Command = {
    id: "view.focus",
    title: "Focus the field on marchers",
    description:
        "Pan and zoom the field to frame the marchers a query names, where they stand at the beat the field shows. Doesn't change the selection.",
    params: [
        { key: "who", label: "Marchers", kind: "marchers", default: "sel" },
    ],
    effects: "view",
    available: (ctx) =>
        all(
            needsShow(ctx),
            needsResolver(ctx),
            useFieldViewStore.getState().width > 0
                ? OK
                : { ok: false, reason: "The field isn't on screen" },
        ),
    async run(ctx, args) {
        const who = await resolveWho(ctx, String(args.who));
        if (!("ids" in who)) return who;
        const resolver = useTimelineResolverStore.getState().resolver;
        if (!resolver) return fail("E_NOT_READY", "The timeline is not ready");
        const beat = fieldBeat(useTimelineSelectionStore.getState());
        const order = resolver.marcherIds();
        const out = new Float64Array(order.length * 2);
        resolver.positionsAt(beat, out);
        const want = new Set(who.ids);
        let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity,
            n = 0;
        order.forEach((id, i) => {
            if (!want.has(id)) return;
            n++;
            const x = out[i * 2]!,
                y = out[i * 2 + 1]!;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        });
        if (n === 0)
            return fail(
                "E_STALE",
                "The marchers aren't in the timeline yet (resolver hasn't seen them)",
            );
        ctx.view.focusField({ minX, minY, maxX, maxY });
        const v = useFieldViewStore.getState();
        return {
            ok: true,
            summary: `Framed ${n} marcher${n === 1 ? "" : "s"}: ${drillList(who.show, who.ids)}`,
            debug: {
                beat,
                missingFromResolver: who.ids.length - n,
                view: { zoom: v.zoom, panX: v.panX, panY: v.panY },
            },
        };
    },
};

const exportOpen: Command = {
    id: "export.open",
    title: "Open export",
    description:
        "Open the export window on a tab. It only opens; the person exports.",
    params: [
        {
            key: "tab",
            label: "Export",
            kind: "enum",
            default: "mobile",
            options: [
                { value: "mobile", aliases: ["app", "phone", "openmarch app"] },
                {
                    value: "coordinate-sheets",
                    aliases: ["coordinates", "coords", "dot sheets", "pdf"],
                },
                {
                    value: "drill-charts",
                    aliases: ["charts", "drill charts", "pdf"],
                },
                { value: "video", aliases: ["mp4", "movie"] },
            ],
        },
    ],
    effects: "opensUi",
    available: (ctx) =>
        all(
            needsShow(ctx),
            ctx.isWebBuild
                ? {
                      ok: false,
                      reason: "Export needs the desktop app (useAppActionHandlers.ts:15)",
                  }
                : OK,
        ),
    async run(ctx, args) {
        ctx.dialogs.openExport(String(args.tab));
        return { ok: true, summary: `Opened export on ${String(args.tab)}` };
    },
};

const undo: Command = {
    id: "edit.undo",
    title: "Undo",
    description: "Undo the last edit (an agent batch is one edit).",
    params: [],
    effects: "editsDrill",
    available: (ctx) =>
        all(
            needsShow(ctx),
            ctx.workspace === "preview"
                ? { ok: false, reason: "Preview edits nothing" }
                : OK,
        ),
    async run(ctx) {
        const r = (await ctx.history.undo()) as {
            nothingToDo?: boolean;
            failure?: { message: string };
            tableNames?: ReadonlySet<string>;
        };
        if (r.nothingToDo) return fail("E_NOTHING", "Nothing to undo");
        if (r.failure) return fail("E_HISTORY", r.failure.message);
        return {
            ok: true,
            summary: `Undid an edit to ${[...(r.tableNames ?? [])].join(", ")}`,
        };
    },
};

const redo: Command = {
    ...undo,
    id: "edit.redo",
    title: "Redo",
    description: "Redo the last undone edit.",
    async run(ctx) {
        const r = (await ctx.history.redo()) as {
            nothingToDo?: boolean;
            failure?: { message: string };
        };
        if (r.nothingToDo) return fail("E_NOTHING", "Nothing to redo");
        if (r.failure) return fail("E_HISTORY", r.failure.message);
        return { ok: true, summary: "Redid an edit" };
    },
};

/** ADR 0008 D-8's adapter: any of the 102 actions, with no result beyond "it ran". */
const legacyAction: Command = {
    id: "action",
    title: "Run an app action",
    description:
        "Run one of the app's existing actions by id (adapter; returns no details).",
    params: [{ key: "action", label: "Action id", kind: "text" }],
    effects: "editsDrill",
    available: () => OK,
    async run(_ctx, args) {
        const id = String(args.action) as ActionId;
        if (!(ACTION_IDS as readonly string[]).includes(id))
            return fail(
                "E_UNKNOWN_ACTION",
                `No action "${id}"`,
                closest(id, ACTION_IDS),
            );
        if (!hasActionHandler(id))
            return fail(
                "E_UNAVAILABLE",
                // The only "reason" the registry can give: nothing registered a handler
                `"${id}" has no handler now (its component isn't mounted, or Basic hides it)`,
            );
        if (isActionOffInWorkspace(id))
            return fail("E_UNAVAILABLE", `"${id}" is off in this workspace`);
        if (!isActionEnabled(id))
            return fail(
                "E_UNAVAILABLE",
                `"${id}" is disabled (no reason given)`,
            );
        const ran = runAction(id);
        // runAction returns a boolean and doesn't wait for async handlers
        return ran
            ? { ok: true, summary: `Ran ${id} (no details: legacy action)` }
            : fail("E_UNAVAILABLE", `"${id}" didn't run`);
    },
};

export const COMMANDS: readonly Command[] = [
    select,
    createMarchersCommand,
    addPageAt,
    focus,
    exportOpen,
    undo,
    redo,
    legacyAction,
];
