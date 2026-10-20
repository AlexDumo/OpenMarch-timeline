import { create } from "zustand";
import type { PaletteItem } from "./sources";

/**
 * Commands with parameters (spec #344, "The command bar"; #354). `/` and ⌘K open one bar: plain
 * actions run from the centered palette as before, and a command that declares parameters docks
 * the bar at the top of the field and asks them one at a time, with a default typed, while what
 * it makes shows live. Only the Shape branch uses it so far; moving the rest of the app onto the
 * tree is #357.
 */

/** One question the docked bar asks */
export interface CommandStep {
    /** Stable for the command; one-liners fill steps in this order */
    readonly key: string;
    /** What it asks, for the step strip and screen readers: "Side-to-side spacing, in steps" */
    readonly label: string;
    /** The answer typed when the step opens, so Enter accepts it */
    readonly initial: string;
    /** The answer typed isn't understood: Enter stays on the step */
    readonly invalid?: boolean;
}

/** A command under way in the docked bar */
export interface CommandRun {
    /** Where it sits in the tree, for the bar's breadcrumb: ["Shape", "Box"] */
    readonly path: readonly string[];
    /**
     * Shows `answers` live (a shape on the field) and returns every step as the answers leave
     * it. An answer for each step so far, the last one being typed.
     */
    preview(answers: readonly string[]): readonly CommandStep[];
    /** The last step was answered */
    finish(answers: readonly string[]): void;
    /** Escape: everything as it was before the command began */
    cancel(): void;
}

/** A palette item's command: began when chosen, null when it can't run now */
export interface ParamCommand {
    begin(): CommandRun | null;
}

/** What the palette and the docked bar show; one of them at most */
export const useCommandBarStore = create<{
    /** The centered palette is open, inside these branch ids (empty at the top) */
    palette: { readonly path: readonly string[] } | null;
    /** The docked bar's command, with answers filled ahead by a one-liner */
    docked: {
        readonly run: CommandRun;
        readonly prefill: readonly string[];
        /** The branch it was chosen from, which Backspace on the first step goes back to */
        readonly from: readonly string[];
    } | null;
}>(() => ({ palette: null, docked: null }));

/** Opens the centered palette, inside `path`; a docked command is left as it is */
export function openPalette(path: readonly string[] = []): void {
    useCommandBarStore.setState({ palette: { path } });
}

export function closePalette(): void {
    useCommandBarStore.setState({ palette: null });
}

/** Docks `run` and closes the palette */
export function dockCommand(
    run: CommandRun,
    prefill: readonly string[],
    from: readonly string[],
): void {
    useCommandBarStore.setState({
        palette: null,
        docked: { run, prefill, from },
    });
}

/**
 * Closes the docked bar without cancelling: for a command that ended on its own (its shape was
 * placed by a scrub, say)
 */
export function closeDockedCommand(run?: CommandRun): void {
    const { docked } = useCommandBarStore.getState();
    if (docked && (run === undefined || docked.run === run))
        useCommandBarStore.setState({ docked: null });
}

/** A branch's items found from the top: "Shape › Box", still nested in their branch */
export interface FlatItem {
    readonly item: PaletteItem;
    /** The branch ids above it */
    readonly path: readonly string[];
    /** Its own label, without the branches: what a one-liner starts with ("Box") */
    readonly name: string;
}

/** Every item in the tree below `items`, depth first, labelled with the branches above it */
export function flattenTree(
    items: readonly PaletteItem[],
    path: readonly string[] = [],
    trail: readonly string[] = [],
): FlatItem[] {
    return items.flatMap((item) => {
        const named =
            trail.length === 0
                ? item
                : { ...item, label: [...trail, item.label].join(" › ") };
        const self = { item: named, path, name: item.label };
        if (!item.children) return [self];
        const below = flattenTree(
            item.children(),
            [...path, item.id],
            [...trail, item.label],
        );
        return [self, ...below];
    });
}

/** The items inside the branch at `path`, or the top level */
export function itemsAt(
    top: readonly PaletteItem[],
    path: readonly string[],
): { items: readonly PaletteItem[]; trail: readonly PaletteItem[] } {
    let items = top;
    const trail: PaletteItem[] = [];
    for (const id of path) {
        const branch = items.find((i) => i.id === id && i.children);
        if (!branch) break;
        trail.push(branch);
        items = branch.children!();
    }
    return { items, trail };
}

/**
 * A one-liner: a command's name then its answers, "box 4x3 2" for Box with 4 × 3 and 2. The
 * answers are split on spaces and commas, keeping sizes such as "4 x 3" or "4 by 3" whole.
 * Null when `query` doesn't start with one of `names` and a space.
 */
export function oneLinerAnswers(
    query: string,
    names: readonly string[],
): string[] | null {
    const q = query.trimStart().toLowerCase();
    const name = names
        .map((n) => n.toLowerCase())
        .filter((n) => n !== "" && q.startsWith(`${n} `))
        .sort((a, b) => b.length - a.length)[0];
    if (name === undefined) return null;
    const rest = query
        .trimStart()
        .slice(name.length)
        .trim()
        .replace(/(\d)\s*(?:x|×|\*|by)\s*(\d)/gi, "$1x$2");
    const answers = rest.split(/[\s,]+/).filter(Boolean);
    return answers.length > 0 ? answers : null;
}
