import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { parseMusicXml } from "@openmarch/musicxml-parser";
import { encodeWav, renderAudio } from "./audio";
import { buildShow, marchingBand, type KitClip } from "./dots";
import { buildTruth, formatTruthJson, kitMaps } from "./maps";
import { kitMusicXml, toMusicXml } from "./musicxml";
import { formatReport, readShow, scoreShow } from "./score.mts";
import type { TempoTruth } from "./truth";

/**
 * Generates the tempo test-show kit (README.md). Run with `pnpm --dir apps/desktop run tempo-kit`;
 * it runs through vitest only so the app's `@/` modules resolve. Text fixtures (truth JSON,
 * MusicXML) go to `tempo-kit/fixtures/` and the output folder; audio and shows only to the output
 * folder (`TEMPO_KIT_OUT`, default `~/om-capture/fixtures/tempo`).
 */

const OUT =
    process.env.TEMPO_KIT_OUT ??
    path.join(homedir(), "om-capture", "fixtures", "tempo");
const FIXTURES = path.join(__dirname, "fixtures");

/** The show's durations for each "wrong" show: what the director has before lining up. */
const WRONG: Record<
    string,
    { why: string; durations: (t: TempoTruth) => number[] }
> = {
    steady: {
        why: "flat ♩=120 (the new-show default), no audio offset",
        durations: (t) => t.counts.map(() => 0.5),
    },
    score: {
        why: "every count 4% fast (the score's shape, wrong speed), no audio offset",
        durations: (t) => t.counts.map((c) => c.duration / 1.04),
    },
    rubato: {
        why: "the printed tempos only (♩=72, ♩=60, ♩=132, ♩=141): no rit., accel., fermatas or caesura, no audio offset",
        durations: (t) => t.counts.map((c) => (c.unit * 60) / c.markedQpm),
    },
    corps: {
        why: "flat 0.5 s per count (♩=120 whatever the note value), no audio offset",
        durations: (t) => t.counts.map(() => 0.5),
    },
};

const BAND = marchingBand([
    ["Trumpet", "T", 8],
    ["Mellophone", "M", 4],
    ["Baritone", "B", 4],
    ["Snare", "S", 4],
    ["Bass Drum", "D", 4],
]);

const PRIYA_BAND = marchingBand([
    ["Trumpet", "T", 10],
    ["Mellophone", "M", 8],
    ["Baritone", "B", 6],
    ["Tuba", "U", 8],
    ["Color Guard", "G", 20],
    ["Rifle", "R", 6],
    ["Snare", "S", 6],
    ["Bass Drum", "D", 6],
]);

/** Count index of a 4/4 downbeat in Priya's show (no pickup). */
const priyaDownbeat = (measure: number) => (measure - 1) * 4 + 1;

const PRIYA_CLIPS: KitClip[] = [
    {
        name: "Guard feature",
        marchers: { prefix: "G", from: 1, to: 20 },
        start: priyaDownbeat(39),
        end: priyaDownbeat(45),
        line: [
            [520, 260],
            [1280, 260],
        ],
    },
    {
        name: "Rifle break",
        marchers: { prefix: "R", from: 1, to: 6 },
        start: priyaDownbeat(46),
        end: priyaDownbeat(50),
        line: [
            [760, 320],
            [1040, 320],
        ],
    },
    {
        name: "Drum feature",
        marchers: { prefix: "S", from: 1, to: 6 },
        start: priyaDownbeat(63),
        end: priyaDownbeat(67),
        line: [
            [780, 720],
            [1020, 720],
        ],
    },
];

const write = (dir: string, name: string, data: string | Uint8Array) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, name), data);
    return path.join(dir, name);
};

const hasFfmpeg = () => {
    try {
        execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
};

/** Throws when the text isn't well-formed XML. */
const assertWellFormed = (name: string, xml: string) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const error = doc.getElementsByTagName("parsererror")[0];
    if (error)
        throw new Error(`${name} is not well-formed: ${error.textContent}`);
};

/**
 * How today's parser reads a MusicXML file: its counts, and each measure's start time (from the
 * first count) against the truth's, by measure number.
 */
const parserCheck = (xml: string, truth: TempoTruth) => {
    const measures = parseMusicXml(xml);
    const counts = measures.flatMap((m) => m.beats);
    const truthStart = new Map(
        truth.measures.map((m) => [
            m.number,
            truth.counts[m.firstCount - 1]!.time - truth.counts[0]!.time,
        ]),
    );
    let t = 0;
    let maxMs = 0;
    let firstBad: number | null = null;
    for (const m of measures) {
        const want = truthStart.get(m.number);
        if (want !== undefined) {
            const err = Math.abs(t - want) * 1000;
            if (!(err <= 2) && firstBad === null) firstBad = m.number;
            if (Number.isFinite(err)) maxMs = Math.max(maxMs, err);
        }
        for (const b of m.beats) t += b.duration;
    }
    return {
        counts: counts.length,
        truthCounts: truth.counts.length,
        maxMeasureStartErrorMs: Math.round(maxMs),
        firstMeasureOffBy2ms: firstBad,
        nanDurations: counts.filter((b) => !Number.isFinite(b.duration)).length,
    };
};

interface ManifestEntry {
    file: string;
    what: string;
    score?: string;
}

// eslint-disable-next-line max-lines-per-function
test("generate the tempo kit", async () => {
    mkdirSync(OUT, { recursive: true });
    const manifest: ManifestEntry[] = [];
    const truths = new Map<string, TempoTruth>();
    const ffmpeg = hasFfmpeg();

    for (const map of kitMaps()) {
        const truth = buildTruth(map);
        truths.set(map.name, truth);
        const json = formatTruthJson(truth);
        write(FIXTURES, `${map.name}.json`, json);
        write(OUT, `${map.name}.json`, json);
        manifest.push({ file: `${map.name}.json`, what: truth.description });
        if (map.name === "score-v3") continue; // the v3 score is never played
        const wav = write(
            OUT,
            `${map.name}.wav`,
            encodeWav(renderAudio(truth)),
        );
        manifest.push({
            file: `${map.name}.wav`,
            what: `click + hits + tone rendered from ${map.name}.json`,
        });
        if (ffmpeg) {
            execFileSync("ffmpeg", [
                "-y",
                "-loglevel",
                "error",
                "-i",
                wav,
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "160k",
                path.join(OUT, `${map.name}.mp3`),
            ]);
            manifest.push({
                file: `${map.name}.mp3`,
                what: `MP3 of ${map.name}.wav (the encoder adds ~25 ms of delay; score against the WAV)`,
            });
        }
    }

    // MusicXML
    const parserReport: Record<string, unknown> = {};
    for (const { name, map, dialect, truthName } of kitMusicXml()) {
        const truth = truths.get(truthName)!;
        const xml = toMusicXml(map, dialect);
        assertWellFormed(name, xml);
        write(FIXTURES, name, xml);
        write(OUT, name, xml);
        parserReport[name] = parserCheck(xml, truth);
        manifest.push({
            file: name,
            what: `${dialect}-style export of ${map.title}`,
        });
    }

    // Shows
    const shows: {
        file: string;
        truth: string;
        what: string;
        durations: number[];
        offset: number;
        audio: string;
        clips?: KitClip[];
        band?: typeof BAND;
    }[] = [];
    for (const name of ["steady", "score", "rubato", "corps"]) {
        const truth = truths.get(name)!;
        shows.push(
            {
                file: `${name}-wrong.dots`,
                truth: name,
                what: `${truth.title}: right counts, measures and marks, wrong timing: ${WRONG[name]!.why}`,
                durations: WRONG[name]!.durations(truth),
                offset: 0,
                audio: name,
            },
            {
                file: `${name}-synced.dots`,
                truth: name,
                what: `${truth.title}: lined up exactly with the audio (the answer)`,
                durations: truth.counts.map((c) => c.duration),
                offset: truth.syncedAudioOffsetSeconds,
                audio: name,
            },
        );
    }
    const score = truths.get("score")!;
    shows.push(
        {
            file: "score-live-wrong.dots",
            truth: "score-live",
            what: "Marcus's show lined up with the score render, with the live take swapped in: needs refitting to the live take",
            durations: score.counts.map((c) => c.duration),
            offset: score.syncedAudioOffsetSeconds,
            audio: "score-live",
        },
        {
            file: "priya.dots",
            truth: "priya",
            what: "Priya's written show: 25 pages of page-to-page moves, a guard feature clip (m39–45, pages 10–11, across the start of the m41–56 cut), a rifle break clip inside the cut (m46–50) and a drum feature clip across the ballad-to-closer seam (m63–67), lined up with priya.wav",
            durations: truths.get("priya")!.counts.map((c) => c.duration),
            offset: truths.get("priya")!.syncedAudioOffsetSeconds,
            audio: "priya",
            clips: PRIYA_CLIPS,
            band: PRIYA_BAND,
        },
    );
    const scores: Record<string, string> = {};
    for (const show of shows) {
        const truth = truths.get(show.truth)!;
        const file = path.join(OUT, show.file);
        await buildShow({
            file,
            truth,
            durations: show.durations,
            audioOffsetSeconds: show.offset,
            audio: {
                name: `${show.audio}.wav`,
                bytes: readFileSync(path.join(OUT, `${show.audio}.wav`)),
            },
            marchers: show.band ?? BAND,
            clips: show.clips,
        });
        const report = scoreShow(readShow(file), truth);
        scores[show.file] = formatReport(report);
        manifest.push({
            file: show.file,
            what: show.what,
            score: `vs ${show.truth}.json: counts max ${report.counts.maxMs.toFixed(1)} ms, median ${report.counts.medianMs.toFixed(1)} ms; page starts max ${report.pageStarts.maxMs.toFixed(1)} ms; ${report.measureMismatches.length} measure and ${report.markMismatches.length} mark mismatches`,
        });
    }

    write(
        OUT,
        "manifest.json",
        `${JSON.stringify({ generated: "pnpm --dir apps/desktop run tempo-kit", files: manifest, currentParser: parserReport }, null, 2)}\n`,
    );
    const summary = [
        ...Object.entries(scores).map(([file, text]) => `== ${file}\n${text}`),
        `== today's MusicXML parser on the kit's exports\n${JSON.stringify(parserReport, null, 2)}`,
    ].join("\n\n");
    write(OUT, "scores.txt", `${summary}\n`);
    process.stderr.write(`${summary}\n\ntempo kit written to ${OUT}\n`);
}, 600_000);
