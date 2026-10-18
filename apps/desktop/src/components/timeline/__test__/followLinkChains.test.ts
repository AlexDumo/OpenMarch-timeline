import { describe, expect, it, vi } from "vitest";
import {
    pageKeepChains,
    followLinkChains,
    type PageKeepChains,
} from "../PageKeepChain";
import type { PageKeepState } from "@/timeline/timelineKeepLater";
import type { CarriedEdit } from "@/timeline/followLinks";

vi.mock("@/timeline/timelineKeepCommands", () => ({
    keepOnPage: vi.fn(async () => {}),
    followAgainOn: vi.fn(async () => {}),
}));

/**
 * Follow links (study variant): with page 2 selected, OT1 and OT2 moved there and hold through
 * pages 3 and 4; page 5 has their own move. The chains show on 3 and 4, light up while a drag
 * edits, and after an edit carried, offer Only Page 2 instead of keeping the new spots.
 */
const state = (
    pageId: number,
    follows: number[],
    from: string[] = ["2"],
): PageKeepState => ({
    pageId,
    pageName: String(pageId),
    box: { start: pageId * 8 - 15, end: pageId * 8 - 7 },
    follows,
    fromStart: [],
    kept: [],
    from,
    selected: 2,
});

const states = [
    state(2, [], []),
    state(3, [1, 2]),
    state(4, [1, 2]),
    state(5, []),
    state(6, [1, 2], ["5"]),
];
const translate = (_key: string, value: string, params?: object) =>
    Object.entries(params ?? {}).reduce(
        (text, [k, v]) => text.replace(`{${k}}`, String(v)),
        value,
    );
const chains: PageKeepChains = pageKeepChains(states, translate);
const run = (
    extra: Partial<Parameters<typeof followLinkChains>[0]> = {},
): PageKeepChains =>
    followLinkChains({
        chains,
        states,
        currentPageId: 2,
        homePageId: 1,
        editing: false,
        carried: null,
        translate,
        ...extra,
    });

describe("followLinkChains", () => {
    it("shows the chains on the pages that follow the selected page, and no others", () => {
        const out = run();
        expect(out.get(3)?.shown).toBe(true);
        expect(out.get(4)?.shown).toBe(true);
        // Page 6 follows page 5, not the selected page
        expect(out.get(6)?.shown).toBeUndefined();
        expect(out.get(3)?.lit).toBe(false);
    });

    it("words a linked chain as a link a click undoes", () => {
        const chain = run().get(4)!;
        expect(chain.label).toBe(
            "Linked to Page 2: changes there move this page too",
        );
        expect(chain.hint).toBe(
            "Click to unlink, so Page 4 and the pages after it stay put",
        );
    });

    it("a carry's chains go quiet once the moment passes, and still put the pages back", () => {
        const onlyThisPage = vi.fn();
        const out = run({
            carried: {
                editedName: "2",
                pages: ["3", "4"],
                marcherIds: [1, 2],
                onlyThisPage,
            },
            carriedLit: false,
        });
        expect(out.get(3)?.lit).toBe(false);
        out.get(3)!.onToggle();
        expect(onlyThisPage).toHaveBeenCalledOnce();
    });

    it("lights them while a drag edits", () => {
        const out = run({ editing: true });
        expect(out.get(3)?.lit).toBe(true);
        expect(out.get(4)?.lit).toBe(true);
        expect(out.get(6)?.lit).toBeUndefined();
    });

    it("leaves the chains alone with no page selected", () => {
        expect(run({ currentPageId: null })).toBe(chains);
    });

    it("after a carry, a click does Only Page 2 and the words say so", () => {
        const onlyThisPage = vi.fn();
        const carried: CarriedEdit = {
            editedName: "2",
            pages: ["3", "4"],
            marcherIds: [1, 2],
            onlyThisPage,
        };
        const out = run({ carried });
        const chain = out.get(3)!;
        expect(chain.lit).toBe(true);
        expect(chain.label).toBe("Moved with your change to Page 2");
        expect(chain.hint).toBe(
            "Click to unlink and put Pages 3–4 back as they were",
        );
        chain.onToggle();
        expect(onlyThisPage).toHaveBeenCalledOnce();
        expect(out.get(4)?.lit).toBe(true);
        expect(out.get(6)?.lit).toBeUndefined();
    });
});
