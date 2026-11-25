/* eslint-disable no-console -- a command line tool: it prints its results */
/**
 * uniform:image — photo helpers for the uniform-from-photos skill, and the app's template
 * downloads. See README.md. Run from apps/desktop:
 *
 *   pnpm uniform:image template <outDir>
 *   pnpm uniform:image grid <photo> <out.png> [--step 100]
 *   pnpm uniform:image sample <photo> <x,y[,w,h]> ...
 *   pnpm uniform:image crop <photo> <x,y,w,h> <out.png> [--size WxH]
 *
 * Exit codes: 0 done, 4 bad arguments, 2 anything else.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveFromCaller } from "./lib/args";
import { openToolPage } from "./lib/browser";

const USAGE = `usage: pnpm uniform:image <command> ...
  template <outDir>                          the app's uniform-template.png/.svg and uniform-regions.json
  grid <photo> <out.png> [--step 100]        the photo with a labelled pixel grid, to read coordinates off
  sample <photo> <x,y[,w,h]> ...             mean and median hex color of each box (photo pixels)
  crop <photo> <x,y,w,h> <out.png> [--size WxH]   a box of the photo, for a print's tile texture`;

const numbers = (s: string | undefined, n: number[]) => {
    const v = (s ?? "").split(/[,x]/).map(Number);
    return n.includes(v.length) && v.every(Number.isFinite) ? v : null;
};

async function main(argv: string[]): Promise<number> {
    const [command, ...rest] = argv;
    const flag = (name: string) => {
        const i = rest.indexOf(name);
        if (i < 0) return undefined;
        const v = rest[i + 1];
        rest.splice(i, 2);
        return v;
    };
    const step = Number(flag("--step") ?? 100);
    const size = flag("--size");
    const bad = (why: string) => {
        console.error(`error: ${why}\n${USAGE}`);
        return 4;
    };
    const photo = () => {
        const p = resolveFromCaller(rest[0]);
        if (!fs.existsSync(p)) throw new Error(`${p} doesn't exist`);
        return fs.readFileSync(p).toString("base64");
    };
    const write = (file: string, b64: string) => {
        const p = resolveFromCaller(file);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, Buffer.from(b64, "base64"));
        return p;
    };
    if (command === "template" && rest.length !== 1)
        return bad("template needs an output folder");
    if (command === "grid" && (rest.length !== 2 || !(step > 0)))
        return bad("grid needs a photo and an output PNG");
    if (command === "sample" && rest.length < 2)
        return bad("sample needs a photo and at least one box");
    if (
        command === "crop" &&
        (rest.length !== 3 ||
            !numbers(rest[1], [4]) ||
            (size && !numbers(size, [2])))
    )
        return bad("crop needs a photo, x,y,w,h and an output PNG");
    if (!["template", "grid", "sample", "crop"].includes(command))
        return bad(`unknown command ${command ?? ""}`);
    const boxes =
        command === "sample"
            ? rest.slice(1).map((b) => numbers(b, [2, 4]))
            : [];
    if (boxes.some((b) => !b))
        return bad("a box is x,y or x,y,w,h in photo pixels");

    const page = await openToolPage({ gpu: false });
    try {
        if (command === "template") {
            const files = await page.image<Record<string, string>>("template");
            for (const [name, b64] of Object.entries(files))
                console.log(`wrote ${write(path.join(rest[0], name), b64)}`);
        } else if (command === "grid") {
            const r = await page.image<{
                png: string;
                width: number;
                height: number;
            }>("grid", photo(), step);
            console.log(
                `wrote ${write(rest[1], r.png)} (${r.width} × ${r.height} px, grid every ${step} px)`,
            );
        } else if (command === "sample") {
            const r = await page.image<unknown[]>("sample", photo(), boxes);
            for (const box of r) console.log(JSON.stringify(box));
        } else {
            const r = await page.image<{
                png: string;
                width: number;
                height: number;
            }>(
                "crop",
                photo(),
                numbers(rest[1], [4]),
                size ? numbers(size, [2]) : undefined,
            );
            console.log(
                `wrote ${write(rest[2], r.png)} (${r.width} × ${r.height} px)`,
            );
        }
        return 0;
    } finally {
        await page.close();
    }
}

main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
        console.error(`error: ${(error as Error)?.stack ?? String(error)}`);
        process.exit(2);
    },
);
