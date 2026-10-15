import type { FieldEditor } from "./fieldEditor";

let active: FieldEditor | null = null;

/**
 * The editor of the field on screen, for app actions that act on the field
 * (Ctrl/Cmd+A), or null while the Fabric field is on screen.
 */
export const activeFieldEditor = (): FieldEditor | null => active;

/** Called by the field that owns `editor` when it mounts (`editor`) and unmounts (null). */
export function setActiveFieldEditor(editor: FieldEditor | null) {
    active = editor;
}
