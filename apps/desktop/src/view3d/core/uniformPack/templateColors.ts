/**
 * The uniform template's fills, as numbers, for telling a template layer left visible in an
 * export from the art. They are `COLORS.region` and `COLORS.band` in
 * `artworkTemplates/uniform/drawing.ts` (a test holds them equal), written out here so the import
 * worker doesn't bundle the template's drawing code.
 */

/** The pale fill inside every region */
export const REGION_FILL = 0xe8f0fe;
/** The shaded wrap band inside each outline */
export const WRAP_BAND_FILL = 0xc3d6f6;
