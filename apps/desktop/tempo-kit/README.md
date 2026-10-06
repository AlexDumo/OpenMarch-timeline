# Tempo test-show kit

Shows, audio and scores with known answers, for the tempo experiments in the tempo experiment plan (section K) and for hands-on sessions. Every count's exact time is known, so "is it lined up?" is a number from a script, not a judgement by ear.

This folder is dev-only. It isn't part of the app build (`electron-builder` packages `dist`, `dist-electron` and the migrations only) and isn't in the app's `tsconfig.json`.

## Make the kit

From the repo root, with Node 24 and the workspace packages built (`pnpm --filter "@openmarch/desktop^..." build`):

```sh
pnpm --dir apps/desktop run tempo-kit
```

It takes about a minute. It writes:

- **Text fixtures** (ground-truth JSON and MusicXML) to `apps/desktop/tempo-kit/fixtures/` (committed) and to the output folder.
- **Audio and shows** (`.wav`, `.mp3`, `.dots`, about 210 MB) to the output folder only, never to git: `~/om-capture/fixtures/tempo/` by default, or `TEMPO_KIT_OUT=/some/dir`.
- `manifest.json` (every file and what it's for), and `scores.txt` (each show scored against its truth, plus what today's MusicXML parser makes of each export).

The output is deterministic: the same maps give the same files. After changing a map in `maps.ts`, regenerate and commit the new `fixtures/`; `__test__/kit.test.ts` fails until the committed fixtures match the maps.

## What's in it

All times are seconds from the start of the audio file. Each `<map>.json` lists every count (`index`, `time`, `duration`, `measure`, `beat`, `unit` in quarter notes, played `qpm`, printed `markedQpm`, `mark`, `events`) and every measure (`number`, `firstCount`, `counts`, `meter`, `grouping`, `mark`, printed `text`). The types are in `truth.ts`.

| Map          | For                       | What's in the music                                                                                                                                                                                                                                                                                                                           |
| ------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `steady`     | Dana (E1, E6, E7, E8)     | 2:32 of 4/4. 1.6 s of silence, then ♩=138 to letter C, ♩=112 from C. A big hit on count 1 of C (m41, 71.17 s) and a final hit (m78). Letters A–D. No pickup notes.                                                                                                                                                                            |
| `score`      | Marcus (E3, E7, E11, E12) | Letters A–M over m0–m96. A one-count pickup (m0). 4/4 ♩=132, a rit. over m53–54 to ♩=100 into H ("a tempo"). 6/8 at I with ♩.=88, and m67 at ♩.=85 (♩=127.5). One 3/4 bar (m70) before J. This is v2, with F at ♩=132.                                                                                                                        |
| `score-live` | Marcus (E7)               | The band's take of `score`: every tempo 3% slower, the rit. down to ♩=92, and the last count of I (m70 beat 3) held for 1.2 s. Same counts as `score`.                                                                                                                                                                                        |
| `score-v3`   | Marcus, Priya (E12)       | Truth only (no audio): v2 with two bars added before L, so L moves from m83 to m85.                                                                                                                                                                                                                                                           |
| `rubato`     | Jo (E4, E5, E9)           | A pickup at 1.84 s. Ballad ♩=72 with a 3.2 s fermata on m5 beat 4 (inside a page). A rit. from 72 to 44 over m11–12 (8 counts). A 6.5 s fermata on m13 beat 1 (a page start), then ♩=60. A 1.5 s caesura after m14 beat 4. A drum break at C (m15, with a hit) accelerating from 132 to 141 over 32 counts. ♩=141 at D and a final hit (m31). |
| `corps`      | Sam (E2, E3, E11)         | m0 pickup. ♩=176 4/4 for 16 bars (A, B). 7/8 counted 2+2+3 for 8 bars (C, m17). 5/8 counted 3+2 for 4 bars (D, m25). One 3/2 bar counted in quarters (E, m29). ♩=152.5 for 8 bars (F, m30). Then ♩.=♩ into 12/8 for 8 bars (G, m38, ♩.=152.5, with a hit), and a final 12/8 bar with a hit (m46).                                             |
| `priya`      | Priya (E10, E12)          | Her written show: opener ♩=168 (A–C, m1–24), ballad ♩=72 (D–F, m25–64, F at m41), closer ♩=176 (G–J, m65–96). Hits on F and G.                                                                                                                                                                                                                |

### Audio (`<map>.wav`, `<map>.mp3`)

Rendered from the truth, so the truth is exact to the sample:

- The app's metronome click (`createMetronomeWav` from `@openmarch/metronome`) on every count, with downbeats louder and higher.
- A louder full-band "hit" (noise, a low thump and a chord) on each hit.
- A quiet sustained chord that changes at each rehearsal mark and swells a little on each count, so the waveform isn't only clicks. It's silent in the lead-in and the caesura.

Score against the WAV. The MP3s are for Dana's "I only have the MP3" sessions, and the encoder adds about 25 ms of delay at the start.

### MusicXML (`fixtures/*.musicxml`)

| File                  | Dialect | Notes                                                     |
| --------------------- | ------- | --------------------------------------------------------- |
| `score-v1-*.musicxml` | both    | F printed ♩=138: the typo that v2 fixes. The audio is v2. |
| `score-v2-*.musicxml` | both    | F printed ♩=132. Matches `score.json`.                    |
| `score-v3-*.musicxml` | both    | v2 plus two bars before L. Matches `score-v3.json`.       |
| `corps-*.musicxml`    | both    | Matches `corps.json`.                                     |

- **MuseScore style** (`*-musescore.musicxml`): every metronome mark has `<sound tempo>` in quarters per minute, with decimals (♩.=85 is `tempo="127.5"`, ♩.=152.5 is `228.75`). Dotted marks use `<beat-unit-dot/>`. Meters are plain (`<beats>7</beats>`).
- **Sibelius style** (`*-sibelius.musicxml`): metronome marks only, no `<sound tempo>`. K is printed "c. 132" (`<per-minute>c. 132</per-minute>`), and the 12/8 modulation is "♩. = ♩" with no number. Compound meters are `<beats>2+2+3</beats>` and `<beats>3+2</beats>`.
- Both: "rit.", "accel." and "a tempo" are `<words>` with no tempo attached. The pickup is `<measure number="0" implicit="yes">`. One note per count.

All of them are checked as well-formed XML. `scores.txt` shows how today's parser reads each one (the pickup becomes 4 counts, the 7/8 becomes 7 counts, "c. 132" gives NaN durations, and so on). E3 should bring every file to zero counts off and every measure start within 2 ms.

### Shows (`.dots`, in the output folder only)

Every show is in timeline mode, built with the app's schema and converter. Each has the map's counts, measure lines and rehearsal marks, page flags at the map's `pages` (a page at each letter, otherwise about every 16 counts, or every 8 for `rubato`), page-to-page drill for 24 marchers (70 in Priya's), and the map's WAV embedded and selected.

| Show                    | Timing                                                                           | Use it for                                                                  |
| ----------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `steady-wrong.dots`     | Flat ♩=120 (the new-show default), no audio offset                               | Dana: tap 8 beats, show length, drag C onto the hit                         |
| `score-wrong.dots`      | Every count 4% fast, no audio offset                                             | Marcus: fixing the speed while keeping the score's shape                    |
| `rubato-wrong.dots`     | The printed tempos only (no rit., accel., fermatas or caesura), no audio offset  | Jo: punch-in tap, tap every count, holds                                    |
| `corps-wrong.dots`      | Flat 0.5 s per count, whatever the note value                                    | Sam: the tempo map table, typed exact tempos                                |
| `score-live-wrong.dots` | Lined up exactly with the render (`score.wav`), with `score-live.wav` swapped in | Marcus: refit to the live take by letters                                   |
| `<map>-synced.dots`     | Lined up exactly                                                                 | Checking an edit doesn't break good timing; retime-in-place re-import (E12) |
| `priya.dots`            | Lined up exactly with `priya.wav`                                                | Priya: cuts, vamps, page +2 (E10)                                           |

`priya.dots` has 25 pages (page 23 is an 8-count page in the closer at m85) and three breakaway clips, made with the app's Create Track into line shapes:

- **Guard feature**: the 20 guard into a line, m39–m45 (counts 153–177). It spans pages 10 and 11 and crosses m41, the start of the 16-measure cut (m41–56).
- **Rifle break**: the 6 rifles, m46–m50 (counts 181–197), entirely inside the cut.
- **Drum feature**: the 6 snares, m63–m67 (counts 249–265). It crosses the ballad-to-closer seam at m65, where the 4-count vamp goes.

Opening it lists some info-level D-REBASE diagnostics: marchers resuming a page move after a clip, which is expected.

## Scoring

```sh
node apps/desktop/tempo-kit/score.mts <show.dots> <truth.json> [--json] [--worst N]
# or, from apps/desktop:
pnpm run tempo-kit:score <show.dots> <truth.json>
```

Node 24 runs the `.mts` file directly. The scorer only reads the file, so it can score a show saved from the app after an experiment.

- Count k of the show is its k-th beat by position after beat 0. It's compared with count k of the truth.
- A count's audio time is the sum of the durations before it, minus the show's `audioOffsetSeconds`.
- Error is show minus truth: negative means the count comes early. It's given in ms and in counts (divided by the truth count's length without any fermata or caesura).
- It reports max, median, p95 and mean signed error for all counts, for downbeats, and for page starts (the show's own page flags), then the worst counts and pages.
- Measures and rehearsal marks are compared by the count they start on: missing or extra measure lines, measure numbers (with the show's `measurementOffset`), and marks.
- If the show has a different number of counts, it says so and compares the counts both have.

Example, Dana's show before lining up:

```text
steady-wrong.dots vs steady.json (Steady (Dana))
counts       312 in the show and the truth
all counts   n=312  max 8834.8 ms (20.170 counts)  median 5237.7 ms (10.458 counts)  p95 8458.9 ms (17.838 counts)  mean signed 4828.8 ms
...
measures     0 mismatches
marks        0 mismatches
```

A synced show scores 0.0 ms everywhere.

## Opening a show in the app

```sh
~/om-capture/capture ~/om-capture/scenarios/tempo-kit.mjs --repo <worktree> --dots ~/om-capture/fixtures/tempo/priya.dots
```

On a desktop, open the `.dots` file with File → Open. The audio is embedded. To try another recording, use the Music panel's audio import (for example `score-live.wav`), and set the audio offset in the workspace settings to `-leadIn` from its JSON.

## Files

- `truth.ts`: the ground-truth types.
- `maps.ts`: the maps as bar lists, `buildTruth` (exact count times) and `formatTruthJson`.
- `audio.ts`: renders a truth to samples and WAV.
- `musicxml.ts`: writes a map as MuseScore- or Sibelius-style MusicXML.
- `dots.ts`: builds a `.dots` show with the app's db-functions and converter.
- `score.mts`: the scorer (CLI and functions).
- `generate.kit.ts` with `vitest.kit.config.mts`: the generator. It runs through vitest only so the app's `@/` imports resolve.
- `__test__/kit.test.ts`: the maps' invariants, the dialect differences, the scorer, and that `fixtures/` matches the maps. It runs in the desktop suite.

## Not in the kit yet

- A MuseScore render of the score (MuseScore isn't on the capture box). The click render stands in, and its truth is exact.
- A public-domain band recording (US Marine Band) annotated by two people, for the noise floor.
- Room reverb on `rubato`, to soften the attacks for the onset-snapping check (E5).
