/**
 * Prototype (#968): stands in for the desktop app's translation singleton, which the shape
 * engine's distribution modules import for their menu labels. The hero never shows a label, so
 * this only has to exist (see the alias in `astro.config.mjs`).
 */
const stub = {
    t: (key: string, fallback?: string): string => fallback ?? key,
};
export default stub;
