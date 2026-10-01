// cspell:ignore NONFOUNDING
/**
 * The timeline inspector's strings (P8.5): Tolgee key to English text. The component reads the
 * text as each key's default, and `i18n/en.json` carries the same keys (a test keeps them equal).
 * `{name}` placeholders are ICU arguments.
 */
export const TIMELINE_INSPECTOR_STRINGS = {
    "inspector.timeline.title": "Timeline",
    "inspector.timeline.marcherTitle": "{marcher} at beat {beat}",
    "inspector.timeline.noPage":
        "Select a page to see why each marcher is where it is.",
    "inspector.timeline.omitted": "and {count} more selected marchers",
    "inspector.timeline.notInTimeline": "{marcher} isn't in the timeline yet.",

    "inspector.timeline.label.span": "Span",
    "inspector.timeline.label.beats": "Beats",
    "inspector.timeline.label.transition": "Transition",
    "inspector.timeline.label.layer": "Layer",
    "inspector.timeline.label.slot": "Slot",
    "inspector.timeline.label.progress": "Progress",
    "inspector.timeline.label.origin": "Starts from",
    "inspector.timeline.label.pathStyle": "Path style",
    "inspector.timeline.label.bulge": "Bulge",
    "inspector.timeline.label.waypoints": "Waypoints",
    "inspector.timeline.label.destination": "Destination",
    "inspector.timeline.label.orderMode": "Order mode",
    "inspector.timeline.label.memberOrder": "Member order",
    "inspector.timeline.label.orderSource": "Order source",
    "inspector.timeline.label.target": "Target",

    "inspector.timeline.span.hold": "Hold",
    "inspector.timeline.span.founding": "Founding",
    "inspector.timeline.span.join": "Join",
    "inspector.timeline.span.resume": "Resume",
    "inspector.timeline.span.holdHelp":
        "Not moving: no move is active, so the marcher stays where it is.",
    "inspector.timeline.span.foundingHelp":
        "In this transition from its start, so its path starts from the marcher's position at the start of the transition.",
    "inspector.timeline.span.joinHelp":
        "Joined this transition after it started, so its path starts from where the marcher was when it joined.",
    "inspector.timeline.span.resumeHelp":
        "Back in this transition after another move took over, so its path starts from where the marcher was.",

    "inspector.timeline.beats.range": "{start} to {end}",
    "inspector.timeline.beats.showStart": "the start of the show",
    "inspector.timeline.beats.showEnd": "the end of the show",
    "inspector.timeline.transition.onTimeline": "{id} on {timeline}",
    "inspector.timeline.transition.plain": "{id}",
    "inspector.timeline.slot.value": "{slot} of {count}",
    "inspector.timeline.progress.value": "{percent}%",
    "inspector.timeline.origin.home": "Home ({x}, {y})",
    "inspector.timeline.origin.spanFounding":
        "End of the previous founding span in transition {transition} ({x}, {y})",
    "inspector.timeline.origin.spanJoin":
        "End of the previous join span in transition {transition} ({x}, {y})",
    "inspector.timeline.origin.spanResume":
        "End of the previous resume span in transition {transition} ({x}, {y})",
    "inspector.timeline.origin.spanHold": "Where it was holding ({x}, {y})",

    "inspector.timeline.pathStyle.direct": "Direct",
    "inspector.timeline.pathStyle.arc": "Arc",
    "inspector.timeline.pathStyle.follow_the_leader": "Follow the leader",
    "inspector.timeline.orderMode.inherit": "Inherit the upstream order",
    "inspector.timeline.orderMode.slot": "Slot order",
    "inspector.timeline.destination.shape": "{name} ({kind})",
    "inspector.timeline.destination.shapeUnnamed": "Shape {id} ({kind})",
    "inspector.timeline.destination.points":
        "{count} individually placed points",

    "inspector.timeline.ftl.place": "Place {place} of {count} (1 is the tail)",
    "inspector.timeline.ftl.notMember":
        "Not a member of the trail (it didn't found this transition)",
    "inspector.timeline.ftl.sourceInherit":
        "Inherited from transition {transition}",
    "inspector.timeline.ftl.sourceSlot": "Slot order",
    "inspector.timeline.ftl.sourceFallback":
        "Slot order (no single upstream order to inherit)",
    "inspector.timeline.ftl.target": "({x}, {y})",

    "inspector.timeline.edit.title": "Edit transition {id}",
    "inspector.timeline.edit.range": "Beats {start} to {end}",
    "inspector.timeline.edit.ftlNeedsShape":
        "Follow the leader follows a path, so it needs a destination shape. Pick a shape first.",
    "inspector.timeline.edit.ftlNotBlock":
        "Follow the leader can't end in a block. Pick a line, freehand, circle or box shape first.",
    "inspector.timeline.edit.bulgeInput": "Bulge value",
    "inspector.timeline.edit.bulgeHelp":
        "From -0.5 to 0.5: 0 is straight and ±0.5 is a half circle. Larger arcs aren't supported, because they could carry a marcher farther from its target than where it started.",
    "inspector.timeline.edit.waypointsHelp":
        "Points the trail passes through before it reaches the shape, in field coordinates.",
    "inspector.timeline.edit.noWaypoints":
        "No waypoints: the trail runs straight onto the shape.",
    "inspector.timeline.edit.waypointX": "Waypoint {n} x",
    "inspector.timeline.edit.waypointY": "Waypoint {n} y",
    "inspector.timeline.edit.waypointUp": "Move waypoint {n} up",
    "inspector.timeline.edit.waypointDown": "Move waypoint {n} down",
    "inspector.timeline.edit.waypointRemove": "Remove waypoint {n}",
    "inspector.timeline.edit.waypointAdd": "Add waypoint",
    "inspector.timeline.edit.orderInheritHelp":
        "Follow the leader keeps the order the marchers had in their previous move.",
    "inspector.timeline.edit.orderSlotHelp":
        "Follow the leader orders the trail by slot number.",
    "inspector.timeline.edit.destinationShape": "Shape",
    "inspector.timeline.edit.destinationIndividual": "Individual points",
    "inspector.timeline.edit.pickShape": "Destination shape",
    "inspector.timeline.edit.shapeNoFtl":
        "{shape}: follow the leader can't end in a block",
    "inspector.timeline.edit.shapeTooSmall":
        "{shape}: holds only {capacity} of {slots} slots",
    "inspector.timeline.edit.noShapes":
        "There are no shapes yet. Draw one to use it as a destination.",
    "inspector.timeline.edit.individualHelp":
        "Each slot has its own point. Switching from a shape puts each point where the shape put that slot.",
    "inspector.timeline.edit.individualFtl":
        "Follow the leader needs a shape. Change the path style first to use individual points.",
    "inspector.timeline.edit.slotCount": "Slots",
    "inspector.timeline.edit.slotCountMin":
        "At least {min}, because slot {slot} has a marcher assigned.",
    "inspector.timeline.edit.slotCountPoints":
        "New slots start at the last slot's point.",

    "inspector.timeline.assign.title": "Slots in transition {id}",
    "inspector.timeline.assign.filled": "{filled} of {count} slots filled",
    "inspector.timeline.assign.noVacant": "No vacant slots.",
    "inspector.timeline.assign.vacantList":
        "Vacant slots, where nobody goes ({count}): {slots}",
    "inspector.timeline.assign.vacantSlot": "Slot {slot}: vacant",
    "inspector.timeline.assign.casting": "Casting",
    "inspector.timeline.assign.cast": "Cast selected marchers",
    "inspector.timeline.assign.castHelp":
        "Puts the selected marchers who aren't in this transition yet ({count}) into the vacant slots nearest to where they stand when it starts, one layer above any other move they have at these beats, so this one wins.",
    "inspector.timeline.assign.castNoneSelected":
        "Select marchers to cast them into this transition.",
    "inspector.timeline.assign.castAllCast":
        "Every selected marcher is already in this transition.",
    "inspector.timeline.assign.castNoVacancy":
        "Selected marchers who need a slot: {count}. Vacant slots: {vacant}. Raise the slot count first.",
    "inspector.timeline.assign.recast": "Recast by nearest slot",
    "inspector.timeline.assign.recastHelp":
        "Gives every marcher in this transition the slot nearest to where it starts, keeping its beats and layer.",
    "inspector.timeline.assign.recastNoMembers":
        "Nobody is in this transition yet.",
    "inspector.timeline.assign.tooManySlots":
        "Automatic casting handles up to {max} slots. Pick each marcher's slot instead.",
    "inspector.timeline.assign.slots": "Slots",
    "inspector.timeline.assign.layerHelp":
        "Where a marcher's moves overlap, the one on the higher layer wins, and the others are stolen for those beats.",
    "inspector.timeline.assign.slotMember": "Slot {slot}: {marcher}",
    "inspector.timeline.assign.slotFor": "Slot for {marcher}",
    "inspector.timeline.assign.slot": "Slot {slot}",
    "inspector.timeline.assign.slotVacant": "Slot {slot} (vacant)",
    "inspector.timeline.assign.slotTrade": "Slot {slot} (trade with {marcher})",
    "inspector.timeline.assign.layerFor": "Layer for {marcher}",
    "inspector.timeline.assign.startFor": "First beat for {marcher}",
    "inspector.timeline.assign.endFor": "End beat for {marcher}",
    "inspector.timeline.assign.remove": "Remove {marcher} from this transition",
    "inspector.timeline.assign.notStolen": "Wins all of its beats.",
    "inspector.timeline.assign.stolen":
        "Stolen from beat {start} to {end} by a higher layer.",
    "inspector.timeline.assign.stolenBy":
        "Stolen from beat {start} to {end} by transition {transition} on a higher layer.",
    "inspector.timeline.assign.moreSlots": "{count} more slots aren't listed.",

    "inspector.timeline.diagnostics.title": "Diagnostics",
    "inspector.timeline.diagnostics.none": "No diagnostics.",
    "inspector.timeline.diagnostics.showTitle": "Show diagnostics ({count})",
    "inspector.timeline.diagnostics.showNone":
        "No diagnostics for the whole show.",
    "inspector.timeline.diagnostics.warning": "Warning",
    "inspector.timeline.diagnostics.info": "Info",
    "inspector.timeline.diagnostics.transition": "Transition {id}",
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
