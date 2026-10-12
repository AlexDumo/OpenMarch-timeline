import type { EditorMode } from "@/stores/EditorModeStore";
// Placeholders until real screenshots (webp) are captured; swap them here only.
import basic from "@/assets/editor-mode/basic.svg";
import expert from "@/assets/editor-mode/expert.svg";

/** The picture on each editor mode card, in Settings and the welcome flow. */
export const editorModeImages: Record<EditorMode, string> = { basic, expert };

export { basic, expert };
