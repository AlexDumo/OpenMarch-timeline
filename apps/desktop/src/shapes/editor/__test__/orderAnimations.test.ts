import { describe, expect, it } from "vitest";
import { ORDER_CHOICES } from "../../assign";
import {
    animationCrossings,
    animationSequence,
    ORDER_ANIMATION_SIZE,
    orderAnimation,
} from "../orderAnimations";

/**
 * Who goes where's walking pictures in each option's tip (09-who-goes-where.md, change log rows
 * 12 and 16): seven marchers walk to a new form in a scene that shows why you'd pick the option,
 * who goes where worked out by the real assignment
 */

const sequence = (choice: (typeof ORDER_CHOICES)[number]) =>
    animationSequence(orderAnimation(choice));

describe("who goes where's walking pictures", () => {
    it("shows each option's rule on the new line, read left to right", () => {
        // A ring opened in order around it; a line turned around
        expect(sequence("keep")).toBe("1 2 3 4 5 6 7");
        expect(sequence("reverse")).toBe("7 6 5 4 3 2 1");
        // Each half flipped: the middle of the line at the ends, its ends meeting in the middle
        expect(sequence("inside")).toBe("3 2 1 4 7 6 5");
        // Two lines taking turns, the longer one's last at the end
        expect(sequence("zipper")).toBe("1 1b 2 2b 3 3b 4");
    });

    it("keeps each section on one run of spots, where Least travel mixes them", () => {
        // One section in front, one behind: side by side on the arc
        expect(sequence("sections")).toBe("1 2 3 4 5b 6b 7b");
        const sections = orderAnimation("sections");
        const groups = [...sections.marchers]
            .sort((a, b) => a.to.x - b.to.x)
            .map((m) => m.group)
            .join("");
        expect(groups).toMatch(/^0+1+$|^1+0+$/);
        // Least travel starts from the same block, and interleaves the two sections' spots
        const nearest = orderAnimation("nearest");
        expect(nearest.marchers.map((m) => m.from)).toEqual(
            sections.marchers.map((m) => m.from),
        );
        expect(sequence("nearest")).not.toBe(sequence("sections"));
        expect(animationCrossings(nearest)).toBe(0);
    });

    it("tells every option apart", () => {
        const all = ORDER_CHOICES.map(sequence);
        expect(new Set(all).size).toBe(ORDER_CHOICES.length);
        // Reverse order's walks all cross; Keep order's none
        expect(animationCrossings(orderAnimation("keep"))).toBe(0);
        expect(animationCrossings(orderAnimation("reverse"))).toBe(21);
    });

    it("rings the leader where order matters, and Inside out's two ends", () => {
        const leads = (choice: (typeof ORDER_CHOICES)[number]) => {
            const picture = orderAnimation(choice);
            return picture.marchers
                .filter((m) => m.lead)
                .map((m) => picture.spots.indexOf(m.to));
        };
        // The leader opens the ring at the arc's first spot, and turns around to its last
        expect(leads("keep")).toEqual([0]);
        expect(leads("reverse")).toEqual([6]);
        // The ends meet either side of the middle
        expect(leads("inside")).toEqual([2, 4]);
        for (const choice of ["nearest", "zipper", "sections"] as const)
            expect(leads(choice)).toEqual([]);
    });

    it("gives every marcher their own spot, all inside the picture", () => {
        const { width, height } = ORDER_ANIMATION_SIZE;
        for (const choice of ORDER_CHOICES) {
            const { marchers, spots } = orderAnimation(choice);
            expect(marchers).toHaveLength(7);
            const taken = new Set(marchers.map((m) => `${m.to.x},${m.to.y}`));
            expect(taken.size).toBe(spots.length);
            for (const { from, to } of marchers)
                for (const p of [from, to]) {
                    expect(p.x).toBeGreaterThan(6);
                    expect(p.x).toBeLessThan(width - 6);
                    expect(p.y).toBeGreaterThan(6);
                    expect(p.y).toBeLessThan(height - 6);
                }
        }
    });
});
