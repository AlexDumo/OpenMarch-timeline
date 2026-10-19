// cspell:ignore NONFOUNDING
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

    // The resolver's diagnostics, worded for the inspector's Show checks (ADR 0002 D-22)
    "inspector.timeline.diagnostics.dVacant":
        "Slot {slot} has no marcher assigned, so nobody goes to that place.",
    "inspector.timeline.diagnostics.dRebase":
        "This marcher joined or resumed this move partway, so its path was rebased to start where it was.",
    "inspector.timeline.diagnostics.dFtlNonFounding":
        "This marcher joined or resumed a follow-the-leader move partway, so it isn't part of the trail's order and heads to its target on its own.",
    "inspector.timeline.diagnostics.dFtlEmpty":
        "Nobody founds this follow-the-leader move, so there's no trail: the marchers fill the shape from its far end.",
    "inspector.timeline.diagnostics.dOrderFallback":
        "This move couldn't inherit an order from a single earlier move, so it uses slot order.",
} as const;

export type TimelineInspectorStringKey =
    keyof typeof TIMELINE_INSPECTOR_STRINGS;

/** The diagnostic codes' string keys. */
export const DIAGNOSTIC_STRING_KEYS = {
    "D-VACANT": "inspector.timeline.diagnostics.dVacant",
    "D-REBASE": "inspector.timeline.diagnostics.dRebase",
    "D-FTL-NONFOUNDING": "inspector.timeline.diagnostics.dFtlNonFounding",
    "D-FTL-EMPTY": "inspector.timeline.diagnostics.dFtlEmpty",
    "D-ORDER-FALLBACK": "inspector.timeline.diagnostics.dOrderFallback",
} as const satisfies Record<string, TimelineInspectorStringKey>;
