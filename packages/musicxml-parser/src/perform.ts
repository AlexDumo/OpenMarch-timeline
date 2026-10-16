/**
 * Performance order: which written measures are played, in which order, once repeats, first and
 * second endings, D.C., D.S., To Coda and Fine are played out.
 *
 * The rules follow common engraving practice (and what MuseScore, Sibelius and Finale play back):
 *
 * - **Repeats.** A backward repeat jumps back to the nearest forward repeat after the last repeat
 *   that was already played out, or to the start of the piece when there is none. `times` says how
 *   often the section is played in all (2 unless the file says otherwise). A repeat inside an
 *   ending bracket that starts with its own forward repeat is nested: once played out, the outer
 *   section carries on.
 * - **Endings.** A bracket is played on the passes its numbers list ("1, 2" plays on the first two
 *   passes) and skipped on the others. A pass is how many times the current repeat section has been
 *   started. A backward repeat in a bracket repeats until every ending of its group has been
 *   played (endings "1", "2", "3, 5, 7", "4, 6", "8" play the section eight times).
 * - **Jumps.** D.C. goes to the first measure and D.S. to the segno, each at the end of its measure
 *   and only once. After a jump, repeats are not taken again and the last ending of a bracket group
 *   is played (the usual reading of "D.S. al Coda" over a repeat with endings). After a jump, To Coda
 *   goes to the coda, and Fine ends the piece. The coda is new music, so its repeats are taken.
 *
 * Every jump happens at the end of a measure, so a mark in the middle of a measure moves to its
 * end. A file that would loop forever stops after `MAX_PLAYS_PER_MEASURE` plays of its measures.
 */

/** How one written measure takes part in repeats and jumps. All fields are optional. */
export interface MeasureNavigation {
    /** A forward repeat barline at the start of the measure */
    forwardRepeat?: boolean;
    /** A backward repeat barline at the end; `times` is how often the section is played in all */
    backwardRepeat?: { times: number };
    /**
     * The ending bracket this measure is in. `numbers` are the passes it is played on and `start`
     * marks the bracket's first measure, so two brackets next to each other stay apart.
     */
    ending?: { numbers: number[]; start: boolean };
    /** A segno at the start of the measure, with its name ("segno" unless the file names it) */
    segno?: string;
    /** A coda at the start of the measure: where To Coda goes */
    coda?: string;
    /** To Coda at the end of the measure, naming the coda it goes to */
    toCoda?: string;
    /** Fine at the end of the measure */
    fine?: boolean;
    /** D.C. at the end of the measure */
    daCapo?: boolean;
    /** D.S. at the end of the measure, naming the segno it goes to */
    dalSegno?: string;
}

/** One played measure. */
export interface PlayedMeasure {
    /** Index of the written measure */
    index: number;
    /** How many times this written measure has been played, counting this time (1 the first time) */
    time: number;
}

export type PerformanceIssue =
    /** D.S. with no segno to go to: the jump is ignored */
    | { code: "missing-segno"; index: number; name: string }
    /** To Coda with no coda after it: the jump is ignored */
    | { code: "missing-coda"; index: number; name: string }
    /** A bracket for a later ending was reached with no repeat to play it from: it is played */
    | { code: "unreachable-ending"; index: number; numbers: number[] }
    /** The marks loop forever; playing stopped after this many measures */
    | { code: "endless"; index: number; played: number };

export const MAX_PLAYS_PER_MEASURE = 16;

/** The written measures in the order they are played. See the module comment for the rules. */
// eslint-disable-next-line max-lines-per-function
export function performanceOrder(navigation: MeasureNavigation[]): {
    order: PlayedMeasure[];
    issues: PerformanceIssue[];
} {
    const n = navigation.length;
    const order: PlayedMeasure[] = [];
    const issues: PerformanceIssue[] = [];
    const times = new Array<number>(n).fill(0);
    const usedJumps = new Set<number>();
    const limit = Math.max(1, n) * MAX_PLAYS_PER_MEASURE;

    /** The start of each bracket group (consecutive bracket measures), for each measure in one. */
    const groupStart: number[] = [];
    navigation.forEach((m, k) => {
        groupStart.push(
            m.ending
                ? navigation[k - 1]?.ending
                    ? groupStart[k - 1]!
                    : k
                : -1,
        );
    });
    /** The numbers of every bracket in the group `k` is in. */
    const groupNumbers = (k: number) => {
        const numbers: number[][] = [];
        for (let j = groupStart[k]!; j < n && navigation[j]!.ending; j++)
            if (navigation[j]!.ending!.start)
                numbers.push(navigation[j]!.ending!.numbers);
        return numbers;
    };
    /** The index just past the bracket that starts at `start`. */
    const bracketEnd = (start: number) => {
        let k = start + 1;
        while (k < n && navigation[k]!.ending && !navigation[k]!.ending!.start)
            k++;
        return k;
    };

    // Repeat sections, innermost last: where a backward repeat goes back to, and which pass this is.
    // The first one is the top-level section; sections nested in a bracket go on top of it
    const sections: { start: number; pass: number }[] = [{ start: 0, pass: 1 }];
    const top = () => sections[sections.length - 1]!;
    let afterJump = false;
    // True while landing on a measure because a backward repeat jumped back to it
    let landing = false;

    let i = 0;
    while (i < n) {
        if (order.length >= limit) {
            issues.push({ code: "endless", index: i, played: order.length });
            break;
        }
        const nav = navigation[i]!;

        // Past a bracket group, the top-level section is played out
        if (
            !landing &&
            !nav.ending &&
            navigation[i - 1]?.ending &&
            sections.length === 1
        )
            sections[0] = { start: i, pass: 1 };

        if (nav.ending?.start && !landing) {
            const groups = groupNumbers(i);
            const playOn = afterJump
                ? groups[groups.length - 1]!
                : [top().pass];
            if (!nav.ending.numbers.some((num) => playOn.includes(num))) {
                const end = bracketEnd(i);
                // A later bracket that no repeat can reach would never be played: play it instead
                const reachable = navigation
                    .slice(top().start, end)
                    .some((m) => m.backwardRepeat);
                if (reachable || afterJump) {
                    i = end;
                    continue;
                }
                issues.push({
                    code: "unreachable-ending",
                    index: i,
                    numbers: nav.ending.numbers,
                });
            }
        }

        if (nav.forwardRepeat && !landing) {
            if (nav.ending) sections.push({ start: i, pass: 1 });
            else sections.splice(0, sections.length, { start: i, pass: 1 });
        }
        landing = false;

        order.push({ index: i, time: ++times[i]! });

        if (afterJump && nav.fine) break;
        if (afterJump && nav.toCoda !== undefined) {
            const from = i;
            const coda = navigation.findIndex(
                (m, k) => k > from && m.coda === nav.toCoda,
            );
            if (coda !== -1) {
                // The coda is music not played before: its repeats and endings are taken
                afterJump = false;
                sections.splice(0, sections.length, { start: coda, pass: 1 });
                i = coda;
                continue;
            }
            issues.push({ code: "missing-coda", index: i, name: nav.toCoda });
        }

        if (nav.backwardRepeat && !afterJump) {
            const section = top();
            // In a bracket of the section's own group: repeat until a later ending has played
            const ownGroup =
                nav.ending &&
                (sections.length === 1 || !navigation[section.start]!.ending);
            const plays = ownGroup
                ? Math.max(...groupNumbers(i).flat(), nav.backwardRepeat.times)
                : nav.backwardRepeat.times;
            if (section.pass < plays) {
                section.pass++;
                i = section.start;
                landing = true;
                continue;
            }
            // Played out: a nested section hands back to the one around it, and a later
            // top-level section without a forward repeat starts after this one
            if (sections.length > 1) sections.pop();
            else if (!nav.ending) sections[0] = { start: i + 1, pass: 1 };
        }

        if ((nav.daCapo || nav.dalSegno !== undefined) && !usedJumps.has(i)) {
            usedJumps.add(i);
            let target = 0;
            if (nav.dalSegno !== undefined) {
                target = navigation.findIndex((m) => m.segno === nav.dalSegno);
                if (target === -1) {
                    issues.push({
                        code: "missing-segno",
                        index: i,
                        name: nav.dalSegno,
                    });
                    i++;
                    continue;
                }
            }
            afterJump = true;
            sections.splice(0, sections.length, { start: target, pass: 1 });
            i = target;
            continue;
        }
        i++;
    }
    return { order, issues };
}
