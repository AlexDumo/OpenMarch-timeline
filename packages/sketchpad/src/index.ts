/**
 * @openmarch/sketchpad: free drawing on a marching field (ADR 0006).
 *
 * A host:
 * - renders `<Sketchpad store initialField assetPath />` and implements `SketchStore`
 * - serves this package's `dist/fonts` so that `<assetPath>/fonts/...` resolves (no CDN fetches)
 * - imports `@openmarch/sketchpad/index.css` and adds this package's `src` to Tailwind with
 *   `@source`, next to `@openmarch/ui/src/tailwind.css`
 * - bundles with the "production" or "development" export condition (Excalidraw's CSS) and
 *   defines `process.env.IS_PREACT` as "false"
 */
import "@excalidraw/excalidraw/index.css";
import "./styles.css";
import { registerOmFillers } from "./fills/roughFiller";

registerOmFillers();

export * from "./types";
export {
    Sketchpad,
    setSketchpadAssetPath,
    downloadBlob,
    type SketchpadHandle,
    type SketchpadProps,
} from "./editor/Sketchpad";
export type { SketchMenuItem, SaveStatus } from "./editor/SketchTab";
export * from "./doc/sketchDoc";
export * from "./field/fieldStyle";
export * from "./drill/coordinates";
export * from "./drill/position";
export * from "./drill/snap";
export { mirrorAcross50, offsetCopy } from "./drill/mirror";
export * from "./fills/omFills";
export { countDots, hasDotFill } from "./fills/dotCount";
export { dataUrlToBlob } from "./editor/scene";
export { sha256Hex } from "./hash";
export { uuid } from "./ids";
export { registerOmFillers } from "./fills/roughFiller";
export {
    exportBounds,
    exportPagePdf,
    exportPagePng,
    exportPageSvg,
    renderPage,
    renderThumbnail,
} from "./export/exportPage";
export { thumbnailBounds } from "./export/thumbnailBounds";
