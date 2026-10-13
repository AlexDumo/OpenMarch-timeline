/**
 * Help ‣ Get the Blender starter kit…: asks where to save, then writes the
 * kit zip (package C1.13). Loaded with a dynamic `import()` from the menu,
 * so the zip and template code stay out of the startup bundle.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import {
    buildStarterKitZip,
    readKitVersion,
    STARTER_KIT_DIRNAME,
    starterKitFilename,
} from "./kit";

/** Where the kit is, in development and in a packaged build. */
export const starterKitDir = () =>
    path.join(app.getAppPath(), STARTER_KIT_DIRNAME);

export async function saveStarterKit(
    window: BrowserWindow | null = BrowserWindow.getFocusedWindow(),
): Promise<void> {
    const kitDir = starterKitDir();
    try {
        const version = await readKitVersion(kitDir);
        const spec = {
            title: "Save the Blender starter kit",
            defaultPath: path.join(
                app.getPath("downloads"),
                starterKitFilename(version),
            ),
            filters: [{ name: "Zip archive", extensions: ["zip"] }],
        };
        const result = window
            ? await dialog.showSaveDialog(window, spec)
            : await dialog.showSaveDialog(spec);
        if (result.canceled || !result.filePath) return;
        await writeFile(result.filePath, await buildStarterKitZip(kitDir));
        shell.showItemInFolder(result.filePath);
    } catch (error) {
        console.error("Couldn't save the Blender starter kit:", error);
        dialog.showErrorBox(
            "Couldn't save the Blender starter kit",
            error instanceof Error ? error.message : String(error),
        );
    }
}
