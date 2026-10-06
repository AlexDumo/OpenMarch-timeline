/**
 * Small MusicXML builders that write measures the way MuseScore and Sibelius export them, so
 * each test can state one musical situation in a few lines.
 *
 * - MuseScore writes a `<metronome>` and a `<sound tempo>` (quarters per minute) in one
 *   `<direction>`, rehearsal marks as `<rehearsal>`, and rit. as italic `<words>` with dashes.
 * - Sibelius often leaves out `<sound tempo>`, so only the printed `<metronome>` is there.
 */

/** Divisions per quarter note, as MuseScore 4 writes them. */
export const DIVISIONS = 480;

export const score = (measures: string, parts = 1) => {
    const part = (id: number) => `<part id="P${id}">${measures}</part>`;
    const list = Array.from(
        { length: parts },
        (_, i) =>
            `<score-part id="P${i + 1}"><part-name>Part ${i + 1}</part-name></score-part>`,
    ).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>Test</work-title></work>
  <part-list>${list}</part-list>
  ${Array.from({ length: parts }, (_, i) => part(i + 1)).join("\n")}
</score-partwise>`;
};

export const measure = (
    number: string | number,
    inner: string,
    { implicit = false }: { implicit?: boolean } = {},
) =>
    `<measure number="${number}"${implicit ? ' implicit="yes"' : ""} width="250">${inner}</measure>`;

export const time = (beats: string | number, beatType: number) =>
    `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>0</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`;

/** A note `quarters` long */
export const note = (quarters: number) =>
    `<note default-x="80"><pitch><step>C</step><octave>5</octave></pitch><duration>${Math.round(
        quarters * DIVISIONS,
    )}</duration><voice>1</voice><type>quarter</type><stem>down</stem></note>`;

/** A whole-measure rest `quarters` long */
export const rest = (quarters: number) =>
    `<note><rest measure="yes"/><duration>${Math.round(
        quarters * DIVISIONS,
    )}</duration><voice>1</voice></note>`;

/** A tempo marking as MuseScore exports it: printed metronome plus playback `<sound tempo>` */
export const museScoreTempo = (
    unit: string,
    dots: number,
    perMinute: string | number,
    soundTempo: string | number,
) =>
    `<direction placement="above"><direction-type><metronome parentheses="no"><beat-unit>${unit}</beat-unit>${"<beat-unit-dot/>".repeat(
        dots,
    )}<per-minute>${perMinute}</per-minute></metronome></direction-type><sound tempo="${soundTempo}"/></direction>`;

/** A tempo marking as Sibelius often exports it: the printed metronome only */
export const sibeliusTempo = (
    unit: string,
    dots: number,
    perMinute: string | number,
    text?: string,
) =>
    `<direction placement="above"><direction-type>${
        text ? `<words font-weight="bold">${text}</words>` : ""
    }</direction-type><direction-type><metronome parentheses="no"><beat-unit>${unit}</beat-unit>${"<beat-unit-dot/>".repeat(
        dots,
    )}<per-minute>${perMinute}</per-minute></metronome></direction-type></direction>`;

export const rehearsal = (mark: string) =>
    `<direction placement="above"><direction-type><rehearsal font-weight="bold" font-size="14" enclosure="square">${mark}</rehearsal></direction-type></direction>`;

export const words = (text: string, dashes?: "start" | "stop") =>
    `<direction placement="above"><direction-type><words font-style="italic">${text}</words></direction-type>${
        dashes
            ? `<direction-type><dashes type="${dashes}" number="1"/></direction-type>`
            : ""
    }</direction>`;

/** `n` measures of 4/4 rests, numbered from `from` */
export const restMeasures = (from: number, n: number, quarters = 4) =>
    Array.from({ length: n }, (_, i) => measure(from + i, rest(quarters))).join(
        "",
    );
