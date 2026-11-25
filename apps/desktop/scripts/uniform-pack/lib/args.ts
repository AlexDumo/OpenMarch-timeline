// cspell:words omasset
/** The command lines of `uniform:build` and `uniform:render` (README.md) */
import path from "node:path";

/**
 * A path as the caller typed it: pnpm runs scripts in apps/desktop, so relative paths resolve
 * against the folder the command was typed in (`INIT_CWD`), not the script's.
 */
export function resolveFromCaller(
    p: string,
    cwd = process.env.INIT_CWD ?? process.cwd(),
): string {
    return path.resolve(cwd, p);
}

export const BODIES = [
    "neutral-slim",
    "neutral-average",
    "neutral-athletic",
    "neutral-broad",
    "neutral-full",
    "feminine-average",
    "masculine-average",
] as const;

export const VIEWS = [
    "front",
    "back",
    "left",
    "right",
    "three-quarter",
] as const;
export const DEFAULT_VIEWS = ["front", "back", "left", "three-quarter"];

export const RENDER_USAGE = `usage: pnpm uniform:render <pack> <outDir> [options]
  pack      a .omasset file, or a pack folder (built first, into <outDir>/pack.omasset)
  outDir    where the PNGs, contact sheets and report.json go; must not be inside the pack folder
  --modes a,b          modes to render (default: all; a pack without modes has one, "default")
  --views a,b          ${VIEWS.join(", ")} (default: ${DEFAULT_VIEWS.join(", ")})
  --dpi 16|32          atlas resolution in px/in: 16 is the app's low quality, 32 its high (default 32)
  --save-atlas         also write the median body's composed atlas per mode
  --no-stands          skip the stands views (faster)`;

export class UsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UsageError";
    }
}

export interface RenderArgs {
    pack: string;
    out: string;
    /** Mode ids to render; null for all */
    modes: string[] | null;
    views: string[];
    dpi: 16 | 32;
    saveAtlas: boolean;
    stands: boolean;
}

const list = (v: string | undefined, flag: string) => {
    if (!v || v.startsWith("--"))
        throw new UsageError(`${flag} needs a comma-separated list`);
    return v.split(",").filter(Boolean);
};

/** Parses `uniform:render`'s arguments; throws {@link UsageError} */
export function parseRenderArgs(
    argv: readonly string[],
    cwd?: string,
): RenderArgs {
    const positional: string[] = [];
    const args: Omit<RenderArgs, "pack" | "out"> = {
        modes: null,
        views: DEFAULT_VIEWS,
        dpi: 32,
        saveAtlas: false,
        stands: true,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case "--modes":
                args.modes = list(argv[++i], a);
                break;
            case "--views": {
                const views = list(argv[++i], a);
                const bad = views.filter(
                    (v) => !(VIEWS as readonly string[]).includes(v),
                );
                if (bad.length)
                    throw new UsageError(
                        `unknown view ${bad.join(", ")}: use ${VIEWS.join(", ")}`,
                    );
                args.views = views;
                break;
            }
            case "--dpi": {
                const v = Number(argv[++i]);
                if (v !== 16 && v !== 32)
                    throw new UsageError(
                        "--dpi is 16 (the app's low quality) or 32 (high)",
                    );
                args.dpi = v;
                break;
            }
            case "--save-atlas":
                args.saveAtlas = true;
                break;
            case "--no-stands":
                args.stands = false;
                break;
            default:
                if (a.startsWith("-"))
                    throw new UsageError(`unknown option ${a}`);
                positional.push(a);
        }
    }
    if (positional.length !== 2)
        throw new UsageError("give a pack and an output folder");
    const pack = resolveFromCaller(positional[0], cwd);
    const out = resolveFromCaller(positional[1], cwd);
    const inside = (child: string, parent: string) =>
        child === parent || child.startsWith(parent + path.sep);
    if (!/\.(omasset|zip)$/i.test(pack) && inside(out, pack))
        throw new UsageError(
            "the output folder must not be inside the pack folder",
        );
    return { pack, out, ...args };
}
