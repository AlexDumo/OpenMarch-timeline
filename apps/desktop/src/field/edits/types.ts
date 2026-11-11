import type { Checkpoint, FieldProperties } from "@openmarch/core";

/**
 * Field edits (#823): every change to the field's properties (checkpoints and settings) is a
 * named, pure function `(fieldProperties, args) → { next, diff }`. Args and diffs are plain data
 * (JSON-serializable), so the editor UI, the command palette and agents call the same edits, and a
 * preview is just a rendered dry run. See `index.ts`.
 */

export type FieldAxis = "x" | "y";

/** A checkpoint. Ids are unique per axis only, so a reference always names the axis. */
export interface CheckpointRef {
    readonly axis: FieldAxis;
    readonly id: number;
}

/**
 * Why an edit was refused (`errors`) or what it is worth knowing about it (`warnings`). `code` is
 * stable for code and agents; `message` is English for logs and agents (the UI translates by
 * `code`, see `fieldEditIssueKey`).
 */
export interface FieldEditIssue {
    readonly code: FieldEditIssueCode;
    readonly message: string;
    readonly axis?: FieldAxis;
    /** The checkpoints it is about, when any */
    readonly checkpoints?: readonly CheckpointRef[];
}

export type FieldEditIssueCode =
    /** No edit has that name */
    | "unknown-edit"
    /** An argument is missing, of the wrong type or out of range */
    | "invalid-args"
    /** A checkpoint id doesn't exist on its axis */
    | "not-found"
    /** An axis would have fewer than 2 checkpoints */
    | "min-checkpoints"
    /** Two checkpoints on an axis would share an id */
    | "duplicate-id"
    /** Two checkpoints on an axis would sit at the same steps */
    | "duplicate-position"
    /** A Y checkpoint would be in front of the front (steps > 0) */
    | "y-in-front"
    /** The step size would be 0 or less */
    | "invalid-step-size"
    /** With mirror on, the X checkpoint at the center can't move */
    | "center-locked"
    /** No position given and the axis has no gap to put a checkpoint in */
    | "no-gap"
    /** A series would make too many checkpoints */
    | "too-many"
    /** setFieldSettings: a key that isn't a setting (checkpoints have their own edits) */
    | "unknown-setting"
    /** applyTemplate: no template has that id */
    | "unknown-template"
    /** Warning: the leftmost and rightmost X checkpoints are no longer equidistant from center */
    | "asymmetric-x"
    /** Warning: mirror only applies to the X axis */
    | "mirror-ignored"
    /** Warning: a series skipped positions that already have a checkpoint */
    | "skipped-existing";

/** One changed value. `key` is dotted for nested settings: "theme.background", "sideDescriptions.terseLeft" */
export interface FieldValueChange {
    readonly key: string;
    readonly from: unknown;
    readonly to: unknown;
}

export interface CheckpointMove {
    readonly axis: FieldAxis;
    readonly id: number;
    /** The checkpoint's name after the edit */
    readonly name: string;
    readonly from: number;
    readonly to: number;
}

export interface CheckpointRename {
    readonly axis: FieldAxis;
    readonly id: number;
    readonly from: { readonly name: string; readonly terseName: string };
    readonly to: { readonly name: string; readonly terseName: string };
}

/** visible, useAsReference or fieldLabel changed */
export interface CheckpointChange {
    readonly axis: FieldAxis;
    readonly id: number;
    readonly name: string;
    readonly changes: readonly FieldValueChange[];
}

/** The field's extents in steps and the pixel values marchers are stored against */
export interface FieldGeometry {
    readonly minXSteps: number;
    readonly maxXSteps: number;
    readonly minYSteps: number;
    readonly maxYSteps: number;
    readonly widthSteps: number;
    readonly heightSteps: number;
    readonly stepSizeInches: number;
    /** Canvas pixels; marchers are stored in these */
    readonly widthPixels: number;
    readonly heightPixels: number;
    readonly centerFrontPoint: {
        readonly xPixels: number;
        readonly yPixels: number;
    };
}

export interface FieldEditDiff {
    /** The edit's name, e.g. "addCheckpoint" */
    readonly edit: string;
    /** False when the edit was refused: `errors` say why, nothing else is listed, `next` is the input */
    readonly ok: boolean;
    /** True when the edit would change nothing (applying it writes nothing) */
    readonly empty: boolean;
    readonly checkpoints: {
        readonly added: readonly Checkpoint[];
        readonly removed: readonly Checkpoint[];
        readonly moved: readonly CheckpointMove[];
        readonly renamed: readonly CheckpointRename[];
        readonly changed: readonly CheckpointChange[];
    };
    /** Everything outside the checkpoints that changed, flattened one level into dotted keys */
    readonly settings: readonly FieldValueChange[];
    /**
     * Whether the field's size, its center front point (in canvas pixels) or its step size
     * changed. Marchers are stored in canvas pixels, so any of these moves the drill relative to
     * the grid; a UI should warn (#826 decides whether marchers follow).
     */
    readonly geometry: {
        readonly sizeChanged: boolean;
        readonly centerChanged: boolean;
        readonly stepSizeChanged: boolean;
        readonly before: FieldGeometry;
        readonly after: FieldGeometry;
    };
    readonly errors: readonly FieldEditIssue[];
    readonly warnings: readonly FieldEditIssue[];
    /**
     * applyTemplate only: the current field's settings kept instead of the template's, by key
     * (top-level, e.g. "theme", "xCheckpoints"), where they differ from the template's
     */
    readonly kept?: readonly string[];
}

export interface FieldEditResult {
    /** The field after the edit; the input itself when refused or empty */
    readonly next: FieldProperties;
    readonly diff: FieldEditDiff;
}

/* ----------------------------------------------------------------------------------------------
 * Args. Every one is plain data.
 * -------------------------------------------------------------------------------------------- */

/** Patch for updateCheckpoints. `shortName` is the checkpoint's `terseName`. */
export interface CheckpointPatch {
    readonly name?: string;
    readonly shortName?: string;
    readonly visible?: boolean;
    readonly useAsReference?: boolean;
    /** "" or null removes the label */
    readonly fieldLabel?: string | null;
}

export interface AddCheckpointArgs {
    readonly axis: FieldAxis;
    /**
     * Where, in steps from center (X) or from the front (Y, ≤ 0). Without it (and without
     * `between`) it goes halfway into the largest gap, nearest the center among equal gaps.
     */
    readonly steps?: number;
    /** Two checkpoint ids on `axis`: it goes halfway between them */
    readonly between?: readonly [number, number];
    /** Default: named from its position ("47.5 yard line") */
    readonly name?: string;
    /** Default: named from its position ("47.5") */
    readonly shortName?: string;
    /** Default: a yard number when it lands on a multiple of 10 on a football field */
    readonly fieldLabel?: string;
    /** Default true */
    readonly visible?: boolean;
    /** Default true */
    readonly useAsReference?: boolean;
    /** X only: also add the twin at -steps (skipped when one is there), side names swapped */
    readonly mirror?: boolean;
}

export interface AddCheckpointSeriesArgs {
    readonly axis: FieldAxis;
    /** Steps between checkpoints, > 0 */
    readonly every: number;
    /** First position, in steps; the series runs from `from` toward `to`, both included */
    readonly from: number;
    readonly to: number;
    /** X only: also add each one's twin at -steps */
    readonly mirror?: boolean;
}

export interface RemoveCheckpointsArgs {
    readonly ids: readonly CheckpointRef[];
    /** Also remove each X checkpoint's twin (the one at -steps) */
    readonly mirror?: boolean;
}

export interface MoveCheckpointsArgs {
    readonly ids: readonly CheckpointRef[];
    /** Steps to move by. Give `by` or `to`, not both */
    readonly by?: number;
    /** Steps to move to (one checkpoint, or one and its twin with mirror) */
    readonly to?: number;
    /**
     * Also move each X checkpoint's twin to the mirrored position. When a checkpoint and its twin
     * are both listed, the first listed leads and the twin follows it.
     */
    readonly mirror?: boolean;
    /** Positions round to this many steps. Default FIELD_STEP_RESOLUTION (0.01) */
    readonly snap?: number;
    /**
     * Default true: a checkpoint whose names are still the automatic ones for where it was is
     * renamed for where it goes ("45 yard line" → "42.5 yard line"). Typed names and field labels
     * never change.
     */
    readonly followNames?: boolean;
}

export interface UpdateCheckpointsArgs {
    readonly ids: readonly CheckpointRef[];
    readonly patch: CheckpointPatch;
    /** Also patch each X checkpoint's twin, with side names swapped in its names */
    readonly mirror?: boolean;
}

/** Every setting outside the checkpoints. Nested objects merge. */
export interface FieldSettingsPatch {
    readonly name?: string;
    readonly stepSizeInches?: number;
    readonly stepSizeWarningThresholdInches?: number;
    readonly measurementSystem?: "imperial" | "metric";
    /** Steps; 0 = no half lines */
    readonly halfLineXInterval?: number;
    readonly halfLineYInterval?: number;
    readonly sideDescriptions?: Partial<
        Record<
            "verboseLeft" | "verboseRight" | "terseLeft" | "terseRight",
            string
        >
    >;
    /** null removes a value */
    readonly yardNumberCoordinates?: Partial<
        Record<
            | "homeStepsFromFrontToOutside"
            | "homeStepsFromFrontToInside"
            | "awayStepsFromFrontToInside"
            | "awayStepsFromFrontToOutside",
            number | null
        >
    >;
    readonly topLabelsVisible?: boolean;
    readonly bottomLabelsVisible?: boolean;
    readonly leftLabelsVisible?: boolean;
    readonly rightLabelsVisible?: boolean;
    readonly useHashes?: boolean;
    readonly isCustom?: boolean;
    readonly showFieldImage?: boolean;
    readonly imageFillOrFit?: "fill" | "fit";
    /** 0–1 */
    readonly backgroundImageOpacity?: number;
    /** Merged into the theme; `defaultMarcher` merges too */
    readonly theme?: Readonly<Record<string, unknown>>;
}

export interface SetFieldSettingsArgs {
    readonly patch: FieldSettingsPatch;
}

/**
 * What applyTemplate keeps from the current field:
 * - "none": everything comes from the template (the old Apply Field Type).
 * - "look": the template's geometry (checkpoints, step size, hashes, half lines, yard numbers)
 *   with the current look (theme, image settings, edge labels, side names, measurement system,
 *   step-size warning).
 * - "lines": the current geometry with the template's look.
 */
export type TemplateKeep = "none" | "look" | "lines";

export interface ApplyTemplateArgs {
    /** A key of FieldPropertiesTemplates, e.g. "COLLEGE_FOOTBALL_FIELD_NO_END_ZONES" */
    readonly template: string;
    /** Default "look" */
    readonly keep?: TemplateKeep;
}

/** Every edit by name, with its args */
export interface FieldEditArgsMap {
    addCheckpoint: AddCheckpointArgs;
    addCheckpointSeries: AddCheckpointSeriesArgs;
    removeCheckpoints: RemoveCheckpointsArgs;
    moveCheckpoints: MoveCheckpointsArgs;
    updateCheckpoints: UpdateCheckpointsArgs;
    setFieldSettings: SetFieldSettingsArgs;
    applyTemplate: ApplyTemplateArgs;
}

export type FieldEditName = keyof FieldEditArgsMap;

/** One edit as data: `{ edit: "addCheckpoint", args: { axis: "x" } }` */
export type FieldEditRequest = {
    [K in FieldEditName]: {
        readonly edit: K;
        readonly args: FieldEditArgsMap[K];
    };
}[FieldEditName];
