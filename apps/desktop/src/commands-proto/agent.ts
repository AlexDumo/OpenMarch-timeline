// PROTOTYPE (fork #357 spike): throwaway, do not build on this.
//
// The dummy agent boundary: window.openmarchCommands, JSON in and JSON out (every result goes
// through a JSON round trip, so anything that wouldn't survive a real wire fails here too).
// Also registers the palette row that runs a typed sentence.

import { toast } from "sonner";
import { registerPaletteSource } from "@/shortcuts/palette/sources";
import { isPlaywrightSession } from "@/utilities/playwrightSession";
import { COMMANDS } from "./commands";
import { buildCtx } from "./ctx";
import {
    freshness,
    listCommands,
    runBatch,
    runCommand,
    showSummary,
} from "./registry";
import { ACTION_IDS } from "@/shortcuts/definitions";
import { hasActionHandler, isActionEnabled } from "@/shortcuts/registry";
import { isActionOffInWorkspace } from "@/shortcuts/workspaceActions";
import { createMarchers } from "@/db-functions/marcher";
import { parseSentence } from "./sentence";

const wire = async <T>(value: T | Promise<T>): Promise<unknown> =>
    JSON.parse(JSON.stringify(await value));

async function runSentence(text: string) {
    const parsed = parseSentence(text);
    if (!parsed.ok)
        return {
            ok: false,
            code: "E_PARSE",
            message: parsed.message,
            suggestions: parsed.suggestions,
            notes: parsed.notes,
        };
    const result = await runCommand(parsed.id, parsed.args);
    return {
        ...result,
        parsedAs: { id: parsed.id, args: parsed.args },
        notes: parsed.notes,
    };
}

export interface OpenmarchCommands {
    list(): Promise<unknown>;
    show(): Promise<unknown>;
    run(id: string, args?: Record<string, unknown>): Promise<unknown>;
    runSentence(text: string): Promise<unknown>;
    runBatch(
        steps: { id: string; args?: Record<string, unknown> }[],
        label: string,
    ): Promise<unknown>;
    parse(text: string): Promise<unknown>;
    /** Spike probes, not part of the boundary */
    _actions(): Promise<unknown>;
    _probeRawCreate(): Promise<unknown>;
}

/** Which of the app's actions exist right now, and whether they'd run */
function actionStates() {
    return ACTION_IDS.map((id) => ({
        id,
        handler: hasActionHandler(id),
        enabled: isActionEnabled(id),
        offInWorkspace: isActionOffInWorkspace(id),
    }));
}

/** A write that skips the command's invalidation: what does each layer say, and when? */
async function probeRawCreate() {
    const ctx = buildCtx();
    const frame = () =>
        new Promise((r) => requestAnimationFrame(() => r(null)));
    await createMarchers({
        db: ctx.db,
        newMarchers: [
            { section: "Euphonium", drill_prefix: "E", drill_order: 1 },
        ],
    });
    const atResolve = await freshness(buildCtx());
    await frame();
    const afterOneFrame = await freshness(buildCtx());
    await new Promise((r) => setTimeout(r, 1000));
    const after1s = await freshness(buildCtx());
    await ctx.queryClient.invalidateQueries({ queryKey: ["marchers"] });
    const afterInvalidate = await freshness(buildCtx());
    return { atResolve, afterOneFrame, after1s, afterInvalidate };
}

declare global {
    interface Window {
        openmarchCommands?: OpenmarchCommands;
    }
}

let installed = false;

export function installCommandsProto() {
    if (installed) return;
    installed = true;
    if (import.meta.env.DEV || isPlaywrightSession())
        window.openmarchCommands = {
            list: () => wire(listCommands()),
            show: () => wire(showSummary()),
            run: (id, args) => wire(runCommand(id, args ?? {})),
            runSentence: (text) => wire(runSentence(text)),
            runBatch: (steps, label) => wire(runBatch(steps, label)),
            parse: (text) => wire(parseSentence(text)),
            _actions: () => wire(actionStates()),
            _probeRawCreate: () => wire(probeRawCreate()),
        };

    // The palette row: what the typed text parses to, runnable, or why not
    registerPaletteSource({
        id: "commands-proto",
        getItems: ({ query }) => {
            const text = query?.trim() ?? "";
            // One word is probably a search for an action; two or more could be a sentence
            if (text.length < 2) return [];
            const parsed = parseSentence(text);
            if (!parsed.ok)
                return text.includes(" ")
                    ? [
                          {
                              id: "commands-proto:sentence",
                              label: `› ${text}`,
                              group: "Command",
                              pinned: true,
                              disabled: true,
                              disabledReason:
                                  parsed.message +
                                  (parsed.suggestions?.length
                                      ? ` (try ${parsed.suggestions.join(", ")})`
                                      : ""),
                              run: () => {},
                          },
                      ]
                    : [];
            const cmd = COMMANDS.find((c) => c.id === parsed.id)!;
            const available = cmd.available(buildCtx());
            const argText = Object.entries(parsed.args)
                .map(([k, v]) => `${k}=${String(v)}`)
                .join(" ");
            return [
                {
                    id: "commands-proto:sentence",
                    label: `› ${cmd.title}${argText ? `: ${argText}` : ""}`,
                    group: "Command",
                    pinned: true,
                    disabled: !available.ok,
                    disabledReason: available.ok ? undefined : available.reason,
                    run: () => {
                        void runCommand(parsed.id, parsed.args).then((r) => {
                            // The contract leaves showing results to the surface (D-3)
                            if (r.ok) toast.success(r.summary);
                            else toast.error(r.message);
                        });
                    },
                },
            ];
        },
    });
}
