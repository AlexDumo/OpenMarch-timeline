/**
 * The timeline inspector's strings: Tolgee key to English text. The component reads the
 * text as each key's default, and `i18n/en.json` carries the same keys (a test keeps them equal).
 * `{name}` placeholders are ICU arguments.
 */
export const TIMELINE_INSPECTOR_STRINGS = {
    "inspector.timeline.move.title": "Move",
    "inspector.timeline.move.name": "Name",
    "inspector.timeline.move.counts": "Counts",
    "inspector.timeline.move.marchers":
        "{count, plural, one {# marcher} other {# marchers}}",
    "inspector.timeline.move.selectMarchers": "Select them",
    "inspector.timeline.move.delete": "Delete move",
    "inspector.timeline.move.paused": "Pause to delete a move.",
    "inspector.timeline.move.nameLimit": "{max} characters at most.",
    "inspector.timeline.move.endHelp":
        "To change where they end up, drag marchers on the field at the move's end.",
    "inspector.timeline.move.goToEnd": "Go to end",
} as const;

export type TimelineInspectorStringKey =
    keyof typeof TIMELINE_INSPECTOR_STRINGS;
