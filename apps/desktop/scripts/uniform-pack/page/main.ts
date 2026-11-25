/**
 * The tool page's entry: `window.uniformTool`, which `build.ts` and `render.ts` call. Rendering
 * loads on first use, so a build never opens a WebGL context.
 */
import { rasterItem, rasterLayer } from "./raster";

const tool = {
    rasterLayer,
    rasterItem,
    render: () => import("./render"),
};

declare global {
    interface Window {
        uniformTool: typeof tool;
    }
}

window.uniformTool = tool;
document.title = "uniform-tool-ready";
