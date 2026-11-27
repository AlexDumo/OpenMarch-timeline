// Argument parsing for page-shots.mjs, apart from the script so tests can run it without a
// browser or a built site.

const VALUE_FLAGS = new Set(["--out", "--theme"]);
const SWITCH_FLAGS = new Set(["--all", "--tiles"]);

/**
 * Splits the command line into flags and the pages named. Every argument that is not a flag, or
 * the value of a flag, is a page, whether or not `--out` or `--theme` is passed and wherever
 * they sit. `--out dir`, `--out=dir`, `--theme dark` and `--theme=dark` both work; everything
 * after a bare `--` is a page. A page without a leading slash gets one.
 *
 * @param {string[]} argv the arguments after the script name
 * @returns {{ pages: string[], out: string | undefined, theme: string | undefined,
 *   all: boolean, tiles: boolean }}
 */
export function parsePageShotsArgs(argv) {
    const result = {
        pages: [],
        out: undefined,
        theme: undefined,
        all: false,
        tiles: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--") {
            result.pages.push(...argv.slice(i + 1).map(asPage));
            break;
        }
        const [flag, inline] = arg.startsWith("--")
            ? splitOnce(arg, "=")
            : [arg, undefined];
        if (VALUE_FLAGS.has(flag)) {
            const value = inline ?? argv[++i];
            if (value === undefined || value === "") {
                throw new Error(`${flag} needs a value`);
            }
            result[flag.slice(2)] = value;
        } else if (SWITCH_FLAGS.has(flag)) {
            if (inline !== undefined) throw new Error(`${flag} takes no value`);
            result[flag.slice(2)] = true;
        } else if (arg.startsWith("--")) {
            throw new Error(`Unknown option ${flag}`);
        } else {
            result.pages.push(asPage(arg));
        }
    }
    if (result.theme && !["light", "dark"].includes(result.theme)) {
        throw new Error(`--theme takes light or dark, not ${result.theme}`);
    }
    return result;
}

/** A page address as the site serves it, with its leading slash. @param {string} page */
function asPage(page) {
    return page.startsWith("/") ? page : `/${page}`;
}

/** @param {string} text @param {string} separator */
function splitOnce(text, separator) {
    const at = text.indexOf(separator);
    return at < 0
        ? [text, undefined]
        : [text.slice(0, at), text.slice(at + separator.length)];
}
