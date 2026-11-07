/* eslint-disable no-console -- a command-line script: it reports what it found */
// cspell:words rawvideo rgba sseof
// The scheduled refresh of the user guide's pictures and clips (.github/workflows/docs-media.yaml).
// Each step is a command, so each can be run and checked on its own machine:
//
//   node scripts/docs-media/refresh.mjs plan [--all | --only "<ids or chapters>"] [--since <commit>]
//       [--keep <ref>] [--shards <n>] [--github-output]
//       Which shots to record again, split into shards for parallel jobs. Prints JSON.
//   node scripts/docs-media/refresh.mjs pages <shot-id ...>
//       The guide pages that show each shot.
//   node scripts/docs-media/refresh.mjs compare --work <capture work folder> --out <dir>
//       After capture.mjs: compares each new recording with the committed one, puts back the
//       ones that didn't visibly change, and copies the changed ones (with before | after | diff
//       pictures and a contact sheet) to <dir>. Needs ffmpeg (run it with in-docker.sh).
//   node scripts/docs-media/refresh.mjs changed --out <dir>
//       The shots compare found changed, to record them again.
//   node scripts/docs-media/refresh.mjs confirm --work <second capture work folder> --out <dir>
//       After recording those again: keeps a change only if the second recording agrees with
//       the first, so recordings that differ run to run aren't committed (reported as unstable).
//   node scripts/docs-media/refresh.mjs publish --artifacts <dir> --base <branch> [--plan <json>]
//       [--run-url <url>] [--repo <owner/name>] [--dry-run]
//       Applies every shard's changed media to the checkout, opens or updates one pull request
//       with them, and opens an issue for each shot that failed to record. --dry-run prints
//       what it would do instead.
//
// Run from apps/desktop. See apps/website/AGENTS.md (Screenshots and clips).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DESKTOP, loadShots, showPath } from "./shot-list.mjs";

const REPO = path.resolve(DESKTOP, "../..");
const WEBSITE = path.join(REPO, "apps/website");
const DOCS = path.join(WEBSITE, "src/content/docs");
const MEDIA = "apps/website/public/docs/media";
const MANIFEST = "apps/website/src/data/docs-media.json";
const SHOTS_DIR = "apps/desktop/scripts/docs-media/shots";

/**
 * A change to any of these can change every picture, so every shot is recorded again: the
 * recorder itself, the shared components and styles, and the app's dependencies.
 * Labels (en.json) count per key instead: see `plan`.
 */
const EVERY_SHOT = [
    /^apps\/desktop\/scripts\/docs-media\/(capture|shot-list)\.mjs$/,
    /^apps\/desktop\/scripts\/media-kit\//,
    /^apps\/desktop\/src\/styles\//,
    /^apps\/desktop\/src\/.*\.css$/,
    /^apps\/desktop\/package\.json$/,
    /^apps\/desktop\/(vite|tailwind)\.config\./,
    /^packages\/ui\/src\//,
    /^packages\/ui\/package\.json$/,
    /^pnpm-lock\.yaml$/,
];
/** Tests and stories never change a picture. */
const NOT_APP = /(__test__|__mocks__|\.test\.|\.spec\.|\.stories\.)/;
const LABELS = "apps/desktop/i18n/en.json";

/** Leaf keys of a nested object, as dotted paths. */
function leaves(obj, prefix = "", out = new Map()) {
    for (const [k, v] of Object.entries(obj ?? {})) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === "object") leaves(v, p, out);
        else out.set(p, v);
    }
    return out;
}

/** How long a shot takes to record, relative to a still in one theme (for balancing shards). */
const COST = { still: 1, clip: 3 };
/** About this many still-equivalents per shard: about half an hour on a GitHub runner. */
const SHARD_COST = 24;

/**
 * When a recording counts as changed. Two recordings of the same state are never quite the
 * same pixels (software drawing and lossy WebP), so pixels are compared as the render
 * comparison does (e2e/browser/render/compare.mts): a pixel differs only when nothing within
 * one pixel of it in the other image is within 24 in every channel. A real change (a label, a
 * moved control, a new color) leaves a dense patch of differing pixels; noise leaves scattered
 * ones. So a recording changed when its size changed, or when any 32 × 32 block has more than
 * BLOCK of its pixels differing, or more than SPREAD of all its pixels differ.
 */
export const THRESHOLD = { block: 0.15, spread: 0.002, blockSize: 32 };

const git = (...args) =>
    execFileSync("git", args, {
        cwd: REPO,
        encoding: "utf8",
        maxBuffer: 1 << 28,
        stdio: ["ignore", "pipe", "pipe"],
    });
const gitBuffer = (...args) =>
    execFileSync("git", args, {
        cwd: REPO,
        maxBuffer: 1 << 28,
        stdio: ["ignore", "pipe", "pipe"],
    });
const tryGit = (...args) => {
    try {
        return git(...args).trim();
    } catch {
        return "";
    }
};
/** Whether a git command succeeds (`cat-file -e`, `merge-base --is-ancestor`). */
const gitOk = (...args) => {
    try {
        execFileSync("git", args, { cwd: REPO, stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
};
/** A path relative to the repo (capture.mjs reports absolute paths; shard.json keeps relative). */
const rel = (file) =>
    path.isAbsolute(file) ? path.relative(REPO, file) : file;

function parseArgs(argv) {
    const options = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        // in-docker.sh adds --software-gl for the recorder; nothing here draws
        if (arg === "--software-gl") continue;
        if (arg.startsWith("--")) {
            const key = arg.slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.startsWith("--"))
                options[key] = true;
            else options[key] = argv[++i];
        } else options._.push(arg);
    }
    return options;
}

/** The media files a shot writes, repo-relative. */
function mediaFiles(shot, theme) {
    const themes = theme ? [theme] : (shot.themes ?? ["light", "dark"]);
    return themes.flatMap((t) => {
        const base = `${MEDIA}/${shot.chapter}/${shot.id}.${t}`;
        return shot.kind === "clip"
            ? [`${base}.mp4`, `${base}.webp`]
            : [`${base}.webp`];
    });
}

// ── Pages ────────────────────────────────────────────────────────────────────────────────

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : /\.mdx?$/.test(e.name) ? [p] : [];
    });
}

/** Every guide page: its file, URL, `covers`, and the shot ids it shows. */
export function guidePages() {
    return walk(DOCS).map((file) => {
        const text = fs.readFileSync(file, "utf8");
        const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
        const coversBlock = fm.match(/^covers:\n((?:\s+-.*\n?)*)/m)?.[1] ?? "";
        const covers = [...coversBlock.matchAll(/^\s*-\s*(.+)$/gm)].map((m) =>
            m[1].trim().replace(/^["']|["']$/g, ""),
        );
        const shots = [
            ...text.matchAll(/<Media\b[^>]*?\bid=["']([^"']+)["']/gs),
        ].map((m) => m[1]);
        const labels = [...text.matchAll(/<Ui\s+k=["']([^"']+)["']/g)].map(
            (m) => m[1],
        );
        const slug = path
            .relative(DOCS, file)
            .replace(/\.mdx?$/, "")
            .replace(/(^|\/)index$/, "");
        return { file: rel(file), url: `/${slug}/`, covers, shots, labels };
    });
}

/** The pages that show `id`. */
export const pagesFor = (id, pages = guidePages()) =>
    pages.filter((p) => p.shots.includes(id));

// ── Plan ─────────────────────────────────────────────────────────────────────────────────

/** Whether `file` is `cover` or inside it (a cover can be a folder). */
const covered = (file, cover) =>
    file === cover || file.startsWith(`${cover.replace(/\/$/, "")}/`);

/** The chapter files each chapter imports (shots/x.mjs importing ./y.mjs), repo-relative. */
function chapterSources(chapter) {
    const own = `${SHOTS_DIR}/${chapter}.mjs`;
    const text = fs.readFileSync(path.join(REPO, own), "utf8");
    const imported = [...text.matchAll(/from\s+["']\.\/([^"']+)["']/g)].map(
        (m) => `${SHOTS_DIR}/${m[1]}`,
    );
    return [own, ...imported];
}

/**
 * Which shots to record again, and why. A shot is recorded again when something it depends
 * on changed since it was last recorded (the last commit that changed its media) or since
 * `since` (the last refresh), whichever is later:
 * - anything in EVERY_SHOT (tests and stories never count),
 * - a label (en.json key) that the page showing it uses, with <Ui k> or an `i18n:` cover,
 * - its chapter file (or one it imports), or the show it opens,
 * - a file in its own `covers`, or in the `covers` of a guide page that shows it.
 * A shot with no media yet is always recorded. `all` records every shot; `keep` (a branch,
 * e.g. the open refresh pull request) adds the shots whose media it changes, so a refresh that
 * hasn't been merged yet isn't lost when the next one replaces it. `only` (shot ids or
 * chapters) records just those.
 */
// eslint-disable-next-line max-lines-per-function -- one pass, read top to bottom
export async function plan({
    all = false,
    only,
    since,
    keep,
    shards: maxShards = 8,
} = {}) {
    const shots = await loadShots();
    const pages = guidePages();
    const head = git("rev-parse", "HEAD").trim();
    const sinceOk = since
        ? tryGit("rev-parse", "--verify", "--quiet", `${since}^{commit}`)
        : "";
    const diffs = new Map();
    const changedSince = (base) => {
        if (!diffs.has(base))
            diffs.set(
                base,
                git("diff", "--name-only", base, head)
                    .split("\n")
                    .filter(Boolean),
            );
        return diffs.get(base);
    };
    const labelDiffs = new Map();
    /** The en.json keys whose text changed or went away since `base`. */
    const changedLabels = (base) => {
        if (!labelDiffs.has(base)) {
            let before = {};
            try {
                before = JSON.parse(git("show", `${base}:${LABELS}`));
            } catch {
                /* no labels file then */
            }
            const now = leaves(
                JSON.parse(fs.readFileSync(path.join(REPO, LABELS), "utf8")),
            );
            labelDiffs.set(
                base,
                [...leaves(before)]
                    .filter(([k, v]) => now.get(k) !== v)
                    .map(([k]) => k),
            );
        }
        return labelDiffs.get(base);
    };
    const kept = new Set();
    if (keep && gitOk("rev-parse", "--verify", "--quiet", `${keep}^{commit}`)) {
        const files = git(
            "diff",
            "--name-only",
            `${head}...${keep}`,
            "--",
            MEDIA,
        )
            .split("\n")
            .filter(Boolean);
        for (const f of files) kept.add(path.basename(f).split(".")[0]);
    }

    const chosen = [];
    for (const shot of shots) {
        const why = [];
        if (only) {
            if (!only.includes(shot.id) && !only.includes(shot.chapter))
                continue;
            why.push("asked for");
        }
        if (all) why.push("every shot");
        if (kept.has(shot.id)) why.push(`changed in ${keep}`);
        const files = mediaFiles(shot).filter((f) =>
            fs.existsSync(path.join(REPO, f)),
        );
        let base = files.length
            ? tryGit("log", "-1", "--format=%H", "--", ...files)
            : "";
        if (!base && !only) why.push("no recording yet");
        else if (!why.length) {
            // The later of the last recording and the last refresh
            if (sinceOk && gitOk("merge-base", "--is-ancestor", base, sinceOk))
                base = sinceOk;
            const changed = changedSince(base);
            const sources = new Set([
                ...chapterSources(shot.chapter),
                rel(showPath(shot)),
            ]);
            const covers = [
                ...(shot.covers ?? []),
                ...pagesFor(shot.id, pages).flatMap((p) =>
                    p.covers.filter((c) => !/^(i18n|action):/.test(c)),
                ),
            ];
            for (const f of changed) {
                if (NOT_APP.test(f)) continue;
                if (EVERY_SHOT.some((r) => r.test(f))) why.push(f);
                else if (sources.has(f)) why.push(f);
                else if (covers.some((c) => covered(f, c))) why.push(f);
            }
            // A changed label: the shots on pages that use it (<Ui k> or an i18n: cover)
            if (changed.includes(LABELS))
                for (const key of changedLabels(base)) {
                    const page = pagesFor(shot.id, pages).find(
                        (p) =>
                            p.labels.includes(key) ||
                            p.covers.some(
                                (c) =>
                                    c.startsWith("i18n:") &&
                                    (key === c.slice(5) ||
                                        key.startsWith(`${c.slice(5)}.`)),
                            ),
                    );
                    if (page) why.push(`label ${key}`);
                }
        }
        if (why.length)
            chosen.push({
                id: shot.id,
                chapter: shot.chapter,
                kind: shot.kind,
                themes: shot.themes ?? ["light", "dark"],
                why: [...new Set(why)].slice(0, 5),
            });
    }

    // Shards balanced by cost, chapters kept in order inside each
    const cost = (s) => COST[s.kind] * s.themes.length;
    const total = chosen.reduce((sum, s) => sum + cost(s), 0);
    const count = Math.max(
        1,
        Math.min(Number(maxShards), Math.ceil(total / SHARD_COST)),
    );
    const bins = Array.from({ length: chosen.length ? count : 0 }, () => ({
        cost: 0,
        shots: [],
    }));
    for (const s of [...chosen].sort((a, b) => cost(b) - cost(a))) {
        const bin = bins.reduce((a, b) => (b.cost < a.cost ? b : a));
        bin.cost += cost(s);
        bin.shots.push(s.id);
    }
    const order = new Map(shots.map((s, i) => [s.id, i]));
    for (const b of bins) b.shots.sort((a, c) => order.get(a) - order.get(c));
    return {
        head,
        since: sinceOk || null,
        shots: chosen,
        cost: total,
        shards: bins.map((b, i) => ({
            name: `shard-${i + 1}`,
            cost: b.cost,
            shots: b.shots.join(" "),
        })),
    };
}

// ── Compare ──────────────────────────────────────────────────────────────────────────────

const ffmpeg = (args, input) =>
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], {
        input,
        maxBuffer: 1 << 30,
        stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
    });

function probe(file) {
    const out = execFileSync(
        "ffprobe",
        [
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
            file,
        ],
        { encoding: "utf8" },
    );
    const json = JSON.parse(out);
    return {
        width: json.streams[0].width,
        height: json.streams[0].height,
        seconds: Number(json.format?.duration) || 0,
    };
}

/** One frame of an image or clip as RGBA pixels: `at` is "first", "last" or seconds. */
export function decode(file, at = "first") {
    const { width, height, seconds } = probe(file);
    const seek =
        at === "last"
            ? ["-sseof", "-0.25"]
            : typeof at === "number"
              ? ["-ss", String(at)]
              : [];
    const raw = ffmpeg([
        ...seek,
        "-i",
        file,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "pipe:1",
    ]);
    const frame = width * height * 4;
    if (raw.length < frame) throw new Error(`${file}: no frame at ${at}`);
    // "last" decodes the final quarter second: keep its last frame
    const start = at === "last" ? raw.length - frame : 0;
    return { width, height, seconds, data: raw.subarray(start, start + frame) };
}

/**
 * How much two frames differ, as the render comparison counts it, and a before | after | diff
 * picture (RGBA) when asked. Frames of different sizes differ completely.
 */
// eslint-disable-next-line max-lines-per-function -- one pass, read top to bottom
export function diffFrames(
    a,
    b,
    { picture = false, threshold = THRESHOLD } = {},
) {
    if (a.width !== b.width || a.height !== b.height)
        return {
            sizeChanged: true,
            changed: true,
            differing: 1,
            ratio: 1,
            block: 1,
        };
    const { width: w, height: h } = a;
    const p = a.data;
    const q = b.data;
    const near = (src, dst, x, y) => {
        const i = (y * w + x) * 4;
        for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                if (nx < 0 || nx >= w) continue;
                const j = (ny * w + nx) * 4;
                if (
                    Math.abs(src[i] - dst[j]) <= 24 &&
                    Math.abs(src[i + 1] - dst[j + 1]) <= 24 &&
                    Math.abs(src[i + 2] - dst[j + 2]) <= 24
                )
                    return true;
            }
        }
        return false;
    };
    const size = threshold.blockSize;
    const bw = Math.ceil(w / size);
    const blocks = new Uint32Array(bw * Math.ceil(h / size));
    const diff = picture ? Buffer.alloc(w * h * 4) : null;
    let differing = 0;
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const same = near(p, q, x, y) && near(q, p, x, y);
            if (!same) {
                differing++;
                blocks[Math.floor(y / size) * bw + Math.floor(x / size)]++;
            }
            if (diff) {
                const la = (p[i] + p[i + 1] + p[i + 2]) / 3;
                if (same) {
                    const v = 255 - (255 - la) * 0.25;
                    diff[i] = diff[i + 1] = diff[i + 2] = v;
                } else if ((q[i] + q[i + 1] + q[i + 2]) / 3 < la) {
                    diff[i] = 220;
                } else {
                    diff[i + 1] = 90;
                    diff[i + 2] = 255;
                }
                diff[i + 3] = 255;
            }
        }
    const block = Math.max(...blocks) / (size * size);
    const ratio = differing / (w * h);
    const result = {
        sizeChanged: false,
        changed: block > threshold.block || ratio > threshold.spread,
        differing,
        ratio,
        block,
    };
    if (diff) {
        // Before, after and diff side by side
        const row = w * 4;
        const out = Buffer.alloc(row * 3 * h);
        for (let y = 0; y < h; y++) {
            p.copy(out, y * row * 3, y * row, (y + 1) * row);
            q.copy(out, y * row * 3 + row, y * row, (y + 1) * row);
            diff.copy(out, y * row * 3 + row * 2, y * row, (y + 1) * row);
        }
        result.picture = { width: w * 3, height: h, data: out };
    }
    return result;
}

/** Writes RGBA pixels as a PNG, at most `maxWidth` wide. */
function writePng({ width, height, data }, file, maxWidth = 2400) {
    ffmpeg(
        [
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-s",
            `${width}x${height}`,
            "-i",
            "pipe:0",
            "-vf",
            `scale='min(${maxWidth},iw)':-2:flags=area`,
            "-frames:v",
            "1",
            file,
        ],
        data,
    );
}

/** The committed version of a repo file at HEAD, written to a temporary file (or null). */
function committed(file, tmp) {
    try {
        const out = path.join(tmp, file.replaceAll("/", "__"));
        fs.writeFileSync(out, gitBuffer("show", `HEAD:${file}`));
        return out;
    } catch {
        return null;
    }
}

/**
 * How much two recordings of a shot differ. Stills: the image. Clips: the first, middle and
 * last frames, and the length. With `diffPng`, writes a before | after | diff picture there
 * when they differ.
 */
function compareFiles(before, after, kind, diffPng) {
    const points = kind === "clip" ? ["first", "middle", "last"] : ["first"];
    const beforeInfo = probe(before);
    const afterInfo = probe(after);
    const lengthChanged =
        kind === "clip" &&
        Math.abs(beforeInfo.seconds - afterInfo.seconds) > 0.1;
    let worst = null;
    for (const point of points) {
        const at = (info) => (point === "middle" ? info.seconds / 2 : point);
        const d = diffFrames(
            decode(before, at(beforeInfo)),
            decode(after, at(afterInfo)),
            {
                picture: Boolean(diffPng),
            },
        );
        if (!worst || d.block > worst.block || d.changed)
            worst = { ...d, point };
        if (d.changed) break;
    }
    const changed = worst.changed || lengthChanged;
    const metrics = {
        changed,
        reason: worst.sizeChanged
            ? `size ${beforeInfo.width}×${beforeInfo.height} → ${afterInfo.width}×${afterInfo.height}`
            : lengthChanged
              ? `length ${beforeInfo.seconds.toFixed(1)} s → ${afterInfo.seconds.toFixed(1)} s`
              : `${(worst.ratio * 100).toFixed(2)}% of pixels, ${(worst.block * 100).toFixed(0)}% of the worst block${kind === "clip" ? ` (${worst.point} frame)` : ""}`,
        ratio: worst.ratio,
        block: worst.block,
    };
    if (changed && worst.picture) {
        writePng(worst.picture, diffPng);
        metrics.diff = diffPng;
    }
    return metrics;
}

/** The file that's compared for a recording: the clip itself, or the still. */
const mainFile = (result) =>
    result.files
        .map(rel)
        .find((f) => f.endsWith(result.kind === "clip" ? ".mp4" : ".webp"));

/** Compares one recording (a shot in one theme) in the checkout with HEAD. */
function compareRecording(result, tmp, diffsDir) {
    const main = mainFile(result);
    const before = committed(main, tmp);
    if (!before) return { changed: true, reason: "new" };
    return compareFiles(
        before,
        path.join(REPO, main),
        result.kind,
        path.join(diffsDir, `${result.id}.${result.theme}.png`),
    );
}

/** A contact sheet of the changed clips in `out`, or none. */
async function clipSheet(report, out) {
    const sheet = path.join(out, "diffs", "clips-contact-sheet.png");
    fs.rmSync(sheet, { force: true });
    const clips = report.filter((r) => r.changed && r.kind === "clip");
    if (!clips.length) return;
    const { contactSheet } = await import("../media-kit/encode.mjs");
    contactSheet(
        clips.map((r) => {
            const mp4 = path.join(out, "media", mainFile(r));
            return { mp4, seconds: probe(mp4).seconds };
        }),
        sheet,
    );
}

/**
 * Compares every recording in a capture run with HEAD. Recordings that didn't visibly change
 * are put back (so the checkout keeps the committed bytes); changed ones are copied to `out`
 * with their diff pictures, the manifest entries and a contact sheet of changed clips.
 */
// eslint-disable-next-line max-lines-per-function -- one pass, read top to bottom
export async function compare({ work, out }) {
    const results = JSON.parse(
        fs.readFileSync(path.join(work, "results.json"), "utf8"),
    );
    fs.mkdirSync(path.join(out, "diffs"), { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docs-media-compare-"));
    const report = [];
    for (const result of results) {
        if (!result.ok) {
            report.push({
                ...result,
                screenshot: undefined,
                hasScreenshot: Boolean(result.screenshot),
            });
            if (result.screenshot)
                fs.copyFileSync(
                    result.screenshot,
                    path.join(
                        out,
                        "diffs",
                        `${result.id}.${result.theme}.failed.png`,
                    ),
                );
            continue;
        }
        const metrics = compareRecording(result, tmp, path.join(out, "diffs"));
        const files = result.files.map(rel);
        console.log(
            `${metrics.changed ? "changed  " : "unchanged"} ${result.id} (${result.theme}): ${metrics.reason}`,
        );
        if (metrics.changed)
            for (const f of files) {
                const to = path.join(out, "media", f);
                fs.mkdirSync(path.dirname(to), { recursive: true });
                fs.copyFileSync(path.join(REPO, f), to);
            }
        else
            for (const f of files)
                // The committed bytes back (without touching the index: in-docker.sh mounts
                // a worktree's git folder read-only)
                if (gitOk("cat-file", "-e", `HEAD:${f}`))
                    fs.writeFileSync(
                        path.join(REPO, f),
                        gitBuffer("show", `HEAD:${f}`),
                    );
        report.push({
            id: result.id,
            chapter: result.chapter,
            theme: result.theme,
            kind: result.kind,
            ok: true,
            files,
            ...metrics,
            diff: metrics.diff ? path.basename(metrics.diff) : undefined,
        });
    }
    fs.rmSync(tmp, { recursive: true, force: true });

    // Manifest entries: the new one for a shot that changed in any theme, else the committed one
    const changedIds = new Set(
        report.filter((r) => r.changed).map((r) => r.id),
    );
    const current = JSON.parse(
        fs.readFileSync(path.join(REPO, MANIFEST), "utf8"),
    );
    let atHead = {};
    try {
        atHead = JSON.parse(git("show", `HEAD:${MANIFEST}`));
    } catch {
        /* a manifest that's new in this checkout */
    }
    const manifest = {};
    for (const id of new Set(report.map((r) => r.id))) {
        if (changedIds.has(id)) manifest[id] = current[id];
        else if (atHead[id]) current[id] = atHead[id];
        else delete current[id];
    }
    fs.writeFileSync(
        path.join(REPO, MANIFEST),
        `${JSON.stringify(current, null, 4)}\n`,
    );

    await clipSheet(report, out);
    fs.writeFileSync(
        path.join(out, "shard.json"),
        `${JSON.stringify({ results: report, manifest }, null, 2)}\n`,
    );
    const changed = report.filter((r) => r.changed).length;
    const failed = report.filter((r) => !r.ok).length;
    console.log(
        `${report.length} recording(s): ${changed} changed, ${failed} failed. Output: ${out}`,
    );
    return { report, manifest };
}

/**
 * The second recording of the shots `compare` found changed (capture.mjs run again on just
 * those, into `work`). A change counts only if the second recording agrees with the first:
 * one that differs run to run (an animation caught at another moment, a layout that settles
 * at different times) is marked unstable and dropped from `out`, so it's reported, not committed.
 */
export async function confirm({ work, out }) {
    const shardFile = path.join(out, "shard.json");
    const shard = JSON.parse(fs.readFileSync(shardFile, "utf8"));
    const second = JSON.parse(
        fs.readFileSync(path.join(work, "results.json"), "utf8"),
    );
    for (const r of shard.results.filter((x) => x.ok && x.changed)) {
        const again = second.find((x) => x.id === r.id && x.theme === r.theme);
        let metrics = { changed: true, reason: "not recorded again" };
        if (again?.ok)
            metrics = compareFiles(
                path.join(out, "media", mainFile(r)),
                path.join(REPO, mainFile(again)),
                r.kind,
            );
        else if (again) metrics.reason = "failed the second time";
        if (!metrics.changed) {
            console.log(`confirmed ${r.id} (${r.theme})`);
            continue;
        }
        console.log(
            `unstable  ${r.id} (${r.theme}): the two new recordings differ, ${metrics.reason}`,
        );
        r.changed = false;
        r.unstable = `the two new recordings differ: ${metrics.reason}`;
        for (const f of r.files)
            fs.rmSync(path.join(out, "media", f), { force: true });
        if (r.diff)
            fs.renameSync(
                path.join(out, "diffs", r.diff),
                path.join(
                    out,
                    "diffs",
                    r.diff.replace(/\.png$/, ".unstable.png"),
                ),
            );
        r.diff = undefined;
    }
    for (const id of Object.keys(shard.manifest))
        if (!shard.results.some((x) => x.id === id && x.changed))
            delete shard.manifest[id];
    await clipSheet(shard.results, out);
    fs.writeFileSync(shardFile, `${JSON.stringify(shard, null, 2)}\n`);
    return shard;
}

// ── Publish ──────────────────────────────────────────────────────────────────────────────

const issueTitle = (id) => `User guide: the "${id}" shot no longer records`;
const code = (ids) => ids.map((id) => `\`${id}\``).join(", ");

function pageList(id, pages) {
    const using = pagesFor(id, pages);
    return using.length
        ? using
              .map(
                  (p) =>
                      `[\`${p.url}\`](https://openmarch.com${p.url}) (\`${p.file}\`)`,
              )
              .join(", ")
        : "no page (unused shot)";
}

/** Runs a command in the repo, or with `dryRun` prints it (and its input) and returns "". */
function commandRunner(dryRun) {
    return (cmd, args, input) => {
        if (dryRun) {
            console.log(
                `$ ${cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`,
            );
            if (input) console.log(input.replace(/^/gm, "  | "));
            return "";
        }
        return execFileSync(cmd, args, {
            cwd: REPO,
            encoding: "utf8",
            input,
            stdio: [input ? "pipe" : "ignore", "pipe", "inherit"],
        });
    };
}

/** Every shard's shard.json (download-artifact puts each artifact in a folder of its own). */
function readShards(artifacts) {
    return fs
        .readdirSync(artifacts, { withFileTypes: true })
        .map((e) => path.join(artifacts, e.name, "shard.json"))
        .filter((file) => fs.existsSync(file))
        .map((file) => ({
            dir: path.dirname(file),
            ...JSON.parse(fs.readFileSync(file, "utf8")),
        }));
}

/** Copies every shard's changed media into the checkout and merges its manifest entries. */
function applyShards(shards) {
    const manifestPath = path.join(REPO, MANIFEST);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const s of shards) {
        const media = path.join(s.dir, "media");
        if (fs.existsSync(media)) fs.cpSync(media, REPO, { recursive: true });
        Object.assign(manifest, s.manifest);
    }
    const sorted = Object.fromEntries(
        Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
    );
    fs.writeFileSync(manifestPath, `${JSON.stringify(sorted, null, 4)}\n`);
}

/**
 * Opens an issue for each shot that failed to record, naming the pages that show it, or
 * comments on the open one. Returns each shot's issue reference.
 */
function fileIssues(failures, { pages, run, repoArgs, runUrl, artifactsLink }) {
    const byId = Map.groupBy(failures, (r) => r.id);
    const links = new Map();
    for (const [id, fails] of byId) {
        const title = issueTitle(id);
        const error = fails[0].error.split("\n").slice(0, 12).join("\n");
        const existing = run("gh", [
            "issue",
            "list",
            ...repoArgs,
            "--state",
            "open",
            "--search",
            `"${title}" in:title`,
            "--json",
            "number,title",
            "--jq",
            `.[] | select(.title == ${JSON.stringify(title)}) | .number`,
        ])
            .trim()
            .split("\n")[0];
        if (existing) {
            run(
                "gh",
                ["issue", "comment", existing, ...repoArgs, "--body-file", "-"],
                `Still failing in ${runUrl || "the latest refresh"}:\n\n\`\`\`\n${error}\n\`\`\``,
            );
            links.set(id, `#${existing}`);
            continue;
        }
        const body = [
            `The scheduled user guide refresh couldn't record the \`${id}\` shot (\`${SHOTS_DIR}/${fails[0].chapter}.mjs\`) in ${fails.map((f) => f.theme).join(" and ")}. The app has probably changed under the shot's setup: a control moved, was renamed, or opens differently.`,
            `**Pages that show it:** ${pageList(id, pages)}. They keep the last good recording until the shot is fixed, so check their words too.`,
            ["```", error, "```"].join("\n"),
            `A screenshot of the window when it failed is \`diffs/${id}.<theme>.failed.png\` in ${artifactsLink}.`,
            `To fix: update the shot's \`setup\` or \`perform\` to match the app, record it (\`scripts/media-kit/in-docker.sh scripts/docs-media/capture.mjs ${id}\` from \`apps/desktop\`), look at the result, and update the pages if the steps changed. See \`apps/website/AGENTS.md\`.`,
        ].join("\n\n");
        const url = run(
            "gh",
            [
                "issue",
                "create",
                ...repoArgs,
                "--title",
                title,
                "--label",
                "documentation",
                "--body-file",
                "-",
            ],
            body,
        ).trim();
        links.set(id, url ? `#${url.split("/").pop()}` : "(new issue)");
    }
    return links;
}

/** Commits the changed media to `docs/media-refresh/<base>` and opens or updates its PR. */
function openPullRequest(
    changed,
    notes,
    { base, recorded, pages, run, repoArgs, runUrl, artifactsLink },
) {
    const branch = `docs/media-refresh/${base}`;
    const ids = [...new Set(changed.map((r) => r.id))];
    const rows = ids.map((id) => {
        const rs = changed.filter((r) => r.id === id);
        return `| \`${id}\` | ${rs.map((r) => `${r.theme}: ${r.reason}`).join("<br>")} | ${pageList(id, pages)} |`;
    });
    const body = [
        `The scheduled user guide refresh recorded ${recorded} shot(s) again from \`${base}\`, and these look different from the committed ones (each was recorded twice, and both recordings agreed). Look at each picture in **Files changed** and check that it still shows what its page says.`,
        [
            "| Shot | What changed | Pages |",
            "| --- | --- | --- |",
            ...rows,
        ].join("\n"),
        `Before \\| after \\| diff pictures for each changed recording (red: darker now, blue: lighter) and a contact sheet of the changed clips are in \`diffs/\` in ${artifactsLink}.`,
        ...notes,
        "## User guide",
        "Pictures only; no page text changed. If a picture now contradicts its page, fix the page in this pull request.",
    ].join("\n\n");
    run("git", ["switch", "-C", branch]);
    run("git", ["add", "--", MEDIA, MANIFEST]);
    run("git", [
        "commit",
        "-m",
        `docs: record ${ids.length} user guide picture(s) again`,
        "-m",
        `Recorded by the scheduled refresh${runUrl ? ` (${runUrl})` : ""}.`,
    ]);
    run("git", ["push", "--force", "origin", `HEAD:refs/heads/${branch}`]);
    const open = run("gh", [
        "pr",
        "list",
        ...repoArgs,
        "--head",
        branch,
        "--base",
        base,
        "--state",
        "open",
        "--json",
        "number",
        "--jq",
        ".[0].number",
    ]).trim();
    if (open)
        run("gh", ["pr", "edit", open, ...repoArgs, "--body-file", "-"], body);
    else
        run(
            "gh",
            [
                "pr",
                "create",
                ...repoArgs,
                "--base",
                base,
                "--head",
                branch,
                "--title",
                `docs: refresh the user guide's pictures (${ids.length})`,
                "--label",
                "documentation",
                "--body-file",
                "-",
            ],
            body,
        );
}

/**
 * Applies every shard's output to the checkout, opens an issue for each shot that failed, and
 * opens or updates one pull request with the changed media. Returns what it found.
 */
export async function publish({
    artifacts,
    base,
    planFile,
    runUrl = "",
    repo,
    dryRun = false,
}) {
    const shards = readShards(artifacts);
    const results = shards.flatMap((s) => s.results);
    const ids = (filter) => [
        ...new Set(results.filter(filter).map((r) => r.id)),
    ];
    const planned = planFile
        ? JSON.parse(fs.readFileSync(planFile, "utf8")).shots.map((s) => s.id)
        : [];
    const recorded = new Set(results.map((r) => r.id));
    const ctx = {
        base,
        recorded: recorded.size,
        pages: guidePages(),
        run: commandRunner(dryRun),
        repoArgs: repo ? ["-R", repo] : [],
        runUrl,
        artifactsLink: runUrl
            ? `${runUrl}#artifacts`
            : "the workflow run's artifacts",
    };
    if (dryRun)
        console.log(
            `(dry run: not copying ${shards.length} shard(s) into the checkout)`,
        );
    else applyShards(shards);

    const changed = results.filter((r) => r.ok && r.changed);
    const changedIds = ids((r) => r.ok && r.changed);
    const failed = ids((r) => !r.ok);
    const missing = planned.filter((id) => !recorded.has(id));
    const unchanged = ids((r) => r.ok && !r.changed && !r.unstable).filter(
        (id) => !changedIds.includes(id),
    );
    const unstable = results.filter((r) => r.unstable);
    const issues = fileIssues(
        results.filter((r) => !r.ok),
        ctx,
    );
    const notes = [
        unchanged.length &&
            `Recorded with no visible change: ${code(unchanged)}.`,
        unstable.length &&
            `Left out because two recordings of the same app differed (the shot isn't repeatable; make its setup wait for a steady state): ${unstable.map((r) => `\`${r.id}\` (${r.theme}: ${r.unstable.replace(/^the two new recordings differ: /, "")})`).join(", ")}.`,
        failed.length &&
            `Failed to record (issues opened): ${failed.map((id) => `\`${id}\` ${issues.get(id)}`).join(", ")}.`,
        missing.length &&
            `Not recorded because their job failed or timed out: ${code(missing)}.`,
    ].filter(Boolean);
    if (changed.length) openPullRequest(changed, notes, ctx);
    else console.log("No recording changed: no pull request.");
    const summary = [
        "### User guide media refresh",
        changedIds.length
            ? `Changed: ${code(changedIds)}.`
            : "No picture changed.",
        ...notes,
    ].join("\n\n");
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY)
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    return { changed: changedIds, failed, missing };
}

// ── Command line ─────────────────────────────────────────────────────────────────────────

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
    const [command, ...rest] = process.argv.slice(2);
    const o = parseArgs(rest);
    if (command === "plan") {
        const result = await plan({
            all: Boolean(o.all),
            only:
                typeof o.only === "string"
                    ? o.only.trim().split(/\s+/)
                    : undefined,
            since: o.since,
            keep: o.keep,
            shards: o.shards ?? 8,
        });
        console.log(JSON.stringify(result, null, 2));
        // In a workflow: the shards as job outputs, and why each shot is recorded in the log
        if (o["github-output"]) {
            for (const shot of result.shots)
                console.error(`${shot.id}: ${shot.why.join(", ")}`);
            fs.appendFileSync(
                process.env.GITHUB_OUTPUT,
                `shards=${JSON.stringify(result.shards)}\ncount=${result.shards.length}\n`,
            );
        }
    } else if (command === "pages") {
        const pages = guidePages();
        for (const id of o._) {
            const using = pagesFor(id, pages);
            console.log(
                `${id}: ${using.length ? using.map((p) => `${p.url} (${p.file})`).join(", ") : "no page"}`,
            );
        }
    } else if (command === "compare") {
        if (!o.work || !o.out)
            throw new Error("compare needs --work and --out");
        await compare({ work: path.resolve(o.work), out: path.resolve(o.out) });
    } else if (command === "confirm") {
        if (!o.work || !o.out)
            throw new Error("confirm needs --work and --out");
        await confirm({ work: path.resolve(o.work), out: path.resolve(o.out) });
    } else if (command === "changed") {
        // The shots compare found changed, space-separated (for recording them again)
        const shard = JSON.parse(
            fs.readFileSync(path.join(o.out, "shard.json"), "utf8"),
        );
        console.log(
            [
                ...new Set(
                    shard.results.filter((r) => r.changed).map((r) => r.id),
                ),
            ].join(" "),
        );
    } else if (command === "publish") {
        if (!o.artifacts || !o.base)
            throw new Error("publish needs --artifacts and --base");
        const { failed, missing } = await publish({
            artifacts: path.resolve(o.artifacts),
            base: o.base,
            planFile: o.plan,
            runUrl: o["run-url"],
            repo: o.repo,
            dryRun: Boolean(o["dry-run"]),
        });
        process.exit(failed.length || missing.length ? 1 : 0);
    } else {
        console.error(
            "usage: refresh.mjs plan|pages|compare|publish ... (see the top of this file)",
        );
        process.exit(2);
    }
}
