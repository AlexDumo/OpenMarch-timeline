import {
    corpsMap,
    METERS,
    scoreMap,
    type MeterSpec,
    type PrintedTempo,
    type TempoMap,
} from "./maps";

/**
 * Writes a map as MusicXML 4.0 partwise in two dialects, matching what each notation program
 * exports (22-persona-marcus.md, 25-persona-sam.md):
 *
 * - **musescore**: every metronome mark also has `<sound tempo>` in quarter notes per minute, with
 *   decimals (♩.=85 is `tempo="127.5"`); dotted marks use `<beat-unit-dot/>`; meters are plain
 *   (`<beats>7</beats>`).
 * - **sibelius**: metronome marks only, no `<sound tempo>`; a mark may be text ("c. 132"); a metric
 *   modulation prints "♩. = ♩" with no number; compound meters are written `<beats>2+2+3</beats>`.
 *
 * Both write "rit.", "accel." and "a tempo" as `<words>`, which no tempo is attached to. One note
 * per count (B4), so the measures have real durations; the pickup bar is `implicit="yes"`, numbered
 * 0. The output is deterministic (fixed encoding date).
 */

export type Dialect = "musescore" | "sibelius";

/** Divisions per quarter note: 2, so an eighth is 1. */
const DIVISIONS = 2;

const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const fmt = (n: number) => String(Number(n.toFixed(4)));

const beatUnit = (unit: PrintedTempo["unit"]) =>
    unit === "dotted-quarter"
        ? "<beat-unit>quarter</beat-unit><beat-unit-dot/>"
        : "<beat-unit>quarter</beat-unit>";

/** Quarter notes per minute that a printed mark means. */
const markQpm = (p: PrintedTempo) =>
    p.unit === "dotted-quarter" ? p.perMinute * 1.5 : p.perMinute;

const metronomeDirection = (p: PrintedTempo, dialect: Dialect): string => {
    let metronome: string;
    if (p.modulation && dialect === "sibelius")
        metronome = `${beatUnit(p.unit)}${beatUnit("quarter")}`;
    else {
        const perMinute =
            dialect === "sibelius" && p.sibeliusText
                ? p.sibeliusText
                : fmt(p.perMinute);
        metronome = `${beatUnit(p.unit)}<per-minute>${esc(perMinute)}</per-minute>`;
    }
    const sound =
        dialect === "musescore" ? `<sound tempo="${fmt(markQpm(p))}"/>` : "";
    return `      <direction placement="above">
        <direction-type>
          <metronome parentheses="no">${metronome}</metronome>
        </direction-type>${sound ? `\n        ${sound}` : ""}
      </direction>`;
};

const wordsDirection = (words: string) => `      <direction placement="above">
        <direction-type>
          <words font-style="italic">${esc(words)}</words>
        </direction-type>
      </direction>`;

const rehearsalDirection = (
    mark: string,
) => `      <direction placement="above">
        <direction-type>
          <rehearsal enclosure="square">${esc(mark)}</rehearsal>
        </direction-type>
      </direction>`;

const timeElement = (meter: MeterSpec, dialect: Dialect) => {
    const beats =
        dialect === "sibelius" || !meter.beats.includes("+")
            ? meter.beats
            : String(meter.beats.split("+").reduce((s, v) => s + Number(v), 0));
    return `<time><beats>${beats}</beats><beat-type>${meter.beatType}</beat-type></time>`;
};

const noteElement = (unit: number, fermata: boolean) => {
    const duration = unit * DIVISIONS;
    const type = unit >= 1 ? "quarter" : "eighth";
    const dot = unit === 1.5 ? "<dot/>" : "";
    const notations = fermata
        ? `\n        <notations><fermata type="upright"/></notations>`
        : "";
    return `      <note>
        <pitch><step>B</step><octave>4</octave></pitch>
        <duration>${duration}</duration>
        <voice>1</voice>
        <type>${type}</type>${dot}
        <stem>down</stem>${notations}
      </note>`;
};

/** The map as MusicXML text in the given dialect. */
export const toMusicXml = (map: TempoMap, dialect: Dialect): string => {
    const software =
        dialect === "musescore" ? "MuseScore 4.4.2" : "Sibelius 2024.3";
    const measures: string[] = [];
    let number = map.bars[0]?.pickup ? 0 : 1;
    let lastMeter: string | null = null;
    for (const spec of map.bars) {
        const meter: MeterSpec = METERS[spec.meter];
        for (let b = 0; b < (spec.bars ?? 1); b++) {
            const parts: string[] = [];
            const units = spec.pickup ? [1] : meter.units;
            const meterKey = spec.meter;
            if (number === 0 || measures.length === 0 || lastMeter !== meterKey)
                parts.push(
                    `      <attributes>${
                        measures.length === 0
                            ? `<divisions>${DIVISIONS}</divisions><key><fifths>0</fifths></key>`
                            : ""
                    }${timeElement(meter, dialect)}${
                        measures.length === 0
                            ? "<clef><sign>G</sign><line>2</line></clef>"
                            : ""
                    }</attributes>`,
                );
            lastMeter = meterKey;
            if (b === 0) {
                if (spec.mark) parts.push(rehearsalDirection(spec.mark));
                if (spec.print)
                    parts.push(metronomeDirection(spec.print, dialect));
                for (const w of spec.words ?? []) parts.push(wordsDirection(w));
            }
            const held = new Set(
                map.events
                    .filter((e) => e.kind === "fermata" && e.measure === number)
                    .map((e) => e.beat),
            );
            units.forEach((unit, k) =>
                parts.push(noteElement(unit, held.has(k + 1))),
            );
            measures.push(
                `    <measure number="${number}"${spec.pickup ? ' implicit="yes"' : ""}>\n${parts.join("\n")}\n    </measure>`,
            );
            number++;
        }
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work>
    <work-title>${esc(map.title)}</work-title>
  </work>
  <identification>
    <encoding>
      <software>${software}</software>
      <encoding-date>2026-10-05</encoding-date>
    </encoding>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>Click</part-name>
    </score-part>
  </part-list>
  <part id="P1">
${measures.join("\n")}
  </part>
</score-partwise>
`;
};

/** The kit's MusicXML files: file name, map, dialect, and the truth of the music it describes. */
export const kitMusicXml = (): {
    name: string;
    map: TempoMap;
    dialect: Dialect;
    truthName: string;
}[] =>
    (["musescore", "sibelius"] as const).flatMap((dialect) => [
        {
            name: `score-v1-${dialect}.musicxml`,
            map: scoreMap({ fTempo: 138 }),
            dialect,
            truthName: "score",
        },
        {
            name: `score-v2-${dialect}.musicxml`,
            map: scoreMap(),
            dialect,
            truthName: "score",
        },
        {
            name: `score-v3-${dialect}.musicxml`,
            map: scoreMap({ barsBeforeL: 2 }),
            dialect,
            truthName: "score-v3",
        },
        {
            name: `corps-${dialect}.musicxml`,
            map: corpsMap,
            dialect,
            truthName: "corps",
        },
    ]);
