/**
 * uniform:render — renders a uniform pack on the 7 body types with the 3D View's own renderer, on
 * the GPU. See README.md. Run from apps/desktop: `pnpm uniform:render <pack> <outDir> [options]`.
 *
 * Exit codes: 0 rendered, 2 render error, 3 no GPU (refused, nothing drawn), 4 bad arguments or
 * pack.
 */
import { RENDER_USAGE, UsageError, parseRenderArgs } from "./lib/args";
import { EXIT, runRender } from "./lib/render";

async function main(argv: string[]): Promise<number> {
    let args;
    try {
        args = parseRenderArgs(argv);
    } catch (error) {
        if (!(error instanceof UsageError)) throw error;
        console.error(`error: ${error.message}\n${RENDER_USAGE}`);
        return EXIT.refused;
    }
    return runRender(args);
}

main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
        console.error(`error: ${(error as Error)?.stack ?? String(error)}`);
        process.exit(EXIT.failed);
    },
);
