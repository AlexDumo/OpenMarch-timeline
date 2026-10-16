# musicxml-parser

Reads a MusicXML score into the counts OpenMarch puts on a show's timeline: every measure in the
order it is played, each with its counts and how long each count lasts.

```ts
import {
  readMusicXmlFile,
  parseMusicXmlWithReport,
} from "@openmarch/musicxml-parser";

const xml = await readMusicXmlFile(await file.arrayBuffer()); // .musicxml, .xml or .mxl
const { measures, warnings, summary } = parseMusicXmlWithReport(xml);
```

## How a score is read

The parser works in three steps, one module each:

1. **Reading** (`read.ts`, `scan.ts`). The file's bytes become XML text: a compressed `.mxl` is
   unzipped through its `META-INF/container.xml`, and UTF-16 or a declared 8-bit encoding is
   decoded. The text is parsed with `@xmldom/xmldom` (the same parser in Electron, the web
   editor's worker and tests). **Every part** is read: a measure takes its tempo marks, rehearsal
   marks, repeats and jumps from whichever parts have them, and its length from the longest
   part. Exporters differ here: Finale writes a tempo into every part, Sibelius only on the top
   staff, and a score's first part is often a rest-only part.
2. **Order** (`perform.ts`). Repeats (with `times`), first and second endings (including
   "1, 2" and unnumbered brackets), nested repeats, D.C., D.S., To Coda and Fine are played out,
   so measures come in **performance order**. A repeated measure appears once per time it is
   played, with `time` counting the plays and `writtenIndex` pointing at the written measure.
   Jumps are read from `<sound>` playback marks, then from symbols, and last from words ("D.S.
   al Coda"); a jump read only from words is reported so someone checks it. Pass
   `{ repeats: "once" }` to keep the written order instead.
3. **Counting** (`meter.ts`, `tempo.ts`, `parser.ts`). Each meter is counted the way a conductor
   beats it (6/8 is two dotted-quarter counts, 7/8 is 2+2+3 unless the file says otherwise), and
   each count's length comes from the tempo in effect: `<sound tempo>`, a `<metronome>` mark
   with dotted or tied beat units, or tempo text, including rit./accel. into a later marking. A
   pickup gets only the counts its music fills, and so does a short measure; a short measure
   that completes a pickup gets exactly the counts the pickup didn't take.

Anything the parser had to guess, couldn't read, or played out is in `warnings`, each with a
stable `code` and `params` (to translate) and an English `message`.

## Development

1. Ensure you have [Node](https://nodejs.org/en/download) installed
1. [pnpm](https://pnpm.io/installation) is optional but recommended
1. Install dependencies

   ```bash
   pnpm install
   ```

1. Run tests

   ```bash
   pnpm run test
   ```

### The corpus test

`src/__test__/corpus/files` holds 54 real scores from many exporters (Dorico, Finale, Sibelius,
MuseScore, Noteflight, Flat.io, LilyPond and MEI converters, and the MusicXML test suite), each
under its own license: see `src/__test__/corpus/ATTRIBUTION.md`. `corpus.test.ts` checks each
file's played order, counts per measure, length and warning codes against `expected.json`. When
a parser change moves any of them, review the change, then accept it:

```bash
pnpm exec tsx scripts/update-corpus-snapshot.ts
```

### Checking against a corpus

`scripts/corpus-report.ts` runs the parser over every MusicXML file in a folder and prints what
it read: failures, the warnings seen, and the software that wrote the files. With an output
path it also writes one JSON line per file, to compare two versions of the parser with a diff.

```bash
pnpm exec tsx scripts/corpus-report.ts <folder> [out.jsonl]
```

Good sources of real-world files from many programs are the
[W3C MusicXML test suite](https://github.com/w3c/musicxml), the
[OpenSheetMusicDisplay test data](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay/tree/develop/test/data),
the [MuseScore import tests](https://github.com/musescore/MuseScore/tree/master/src/importexport/musicxml/tests/data)
and the [music21 corpus](https://github.com/cuthbertLab/music21/tree/master/music21/corpus).
Check each source's license before copying files into this repository.

## Creating Tests

Most tests build a small score in code with `src/__test__/Report/scoreBuilders.ts`, so each one
states one musical situation in a few lines. To test a whole file:

1. **Copy the Template Directory**
   Duplicate the directory `src/__test__/Template Test` and give the new folder a descriptive name.
2. **Rename the TypeScript File**
   Inside your new folder, rename the `.ts` file (for example, `MyTest.test.ts`) to match your test case.
3. **Replace the Template XML File**
   Replace the `TEMPLATE.xml` file in your new folder with your actual `.musicxml`, `.XML`, or `.mxl` file.
4. **Update Variables in the Test File**
   Open the test file and update the following:
   - Change the value of the `filename` variable to match your MusicXML file name.
   - Change the `testName` variable to describe your test case.
5. **Add Your Measures**
   Edit the `expected` array in the test file to include the measures you want to test.

For a complete example, refer to the `src/__test__/Test Score 1/TestScore1.test.ts` file.
