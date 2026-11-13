/**
 * Stands in for PostCSS in the web build. sanitize-html imports it to check
 * `style` attributes against `allowedStyles`; the drill chart notes allow no
 * attributes at all, so it is never called. The real package would bring
 * Node's `fs` and `path` into the page.
 */
export function parse(): never {
    throw new Error("PostCSS isn't available in the web build");
}
