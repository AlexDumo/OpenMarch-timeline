import type { Checkpoint, FieldProperties } from "@openmarch/core";
import {
    fieldGeometry,
    positionKey,
    samePosition,
    SETTING_KEYS,
} from "./fieldModel";
import type {
    CheckpointChange,
    CheckpointMove,
    CheckpointRename,
    FieldAxis,
    FieldEditDiff,
    FieldEditIssue,
    FieldValueChange,
} from "./types";

/**
 * How checkpoints before and after are paired: by id (edits, which keep ids) or by axis and
 * position (a template switch, whose ids restart at 0 and mean nothing across fields).
 */
export type CheckpointMatch = "id" | "position";

const sameValue = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);

/** Changes between two values, one level of nesting flattened into dotted keys */
function valueChanges(
    key: string,
    from: unknown,
    to: unknown,
): FieldValueChange[] {
    if (sameValue(from, to)) return [];
    const isObject = (v: unknown): v is Record<string, unknown> =>
        typeof v === "object" && v !== null && !Array.isArray(v);
    if (isObject(from) && isObject(to)) {
        const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])];
        return keys
            .filter((k) => !sameValue(from[k], to[k]))
            .map((k) => ({ key: `${key}.${k}`, from: from[k], to: to[k] }));
    }
    return [{ key, from, to }];
}

export function settingsChanges(
    before: FieldProperties,
    after: FieldProperties,
): FieldValueChange[] {
    return SETTING_KEYS.flatMap((key) =>
        valueChanges(key, before[key], after[key]),
    );
}

function checkpointChanges(
    axis: FieldAxis,
    before: readonly Checkpoint[],
    after: readonly Checkpoint[],
    match: CheckpointMatch,
) {
    const keyOf = (c: Checkpoint) =>
        match === "id" ? String(c.id) : positionKey(c.stepsFromCenterFront);
    const beforeByKey = new Map(before.map((c) => [keyOf(c), c]));
    const afterKeys = new Set(after.map(keyOf));
    const added: Checkpoint[] = [];
    const moved: CheckpointMove[] = [];
    const renamed: CheckpointRename[] = [];
    const changed: CheckpointChange[] = [];
    for (const c of after) {
        const old = beforeByKey.get(keyOf(c));
        if (!old) {
            added.push(c);
            continue;
        }
        if (!samePosition(old.stepsFromCenterFront, c.stepsFromCenterFront))
            moved.push({
                axis,
                id: c.id,
                name: c.name,
                from: old.stepsFromCenterFront,
                to: c.stepsFromCenterFront,
            });
        if (old.name !== c.name || old.terseName !== c.terseName)
            renamed.push({
                axis,
                id: c.id,
                from: { name: old.name, terseName: old.terseName },
                to: { name: c.name, terseName: c.terseName },
            });
        const flags: FieldValueChange[] = [];
        for (const key of ["visible", "useAsReference"] as const)
            if (old[key] !== c[key])
                flags.push({ key, from: old[key], to: c[key] });
        // An empty label is no label
        if ((old.fieldLabel || undefined) !== (c.fieldLabel || undefined))
            flags.push({
                key: "fieldLabel",
                from: old.fieldLabel,
                to: c.fieldLabel,
            });
        if (flags.length > 0)
            changed.push({ axis, id: c.id, name: c.name, changes: flags });
    }
    const removed = before.filter((c) => !afterKeys.has(keyOf(c)));
    return { added, removed, moved, renamed, changed };
}

/**
 * Everything that differs between two fields, as an edit's diff. `errors` and `warnings` are the
 * edit's own; this only compares.
 */
export function diffFieldProperties(
    edit: string,
    before: FieldProperties,
    after: FieldProperties,
    {
        match = "id",
        errors = [],
        warnings = [],
        kept,
    }: {
        match?: CheckpointMatch;
        errors?: readonly FieldEditIssue[];
        warnings?: readonly FieldEditIssue[];
        kept?: readonly string[];
    } = {},
): FieldEditDiff {
    const x = checkpointChanges(
        "x",
        before.xCheckpoints,
        after.xCheckpoints,
        match,
    );
    const y = checkpointChanges(
        "y",
        before.yCheckpoints,
        after.yCheckpoints,
        match,
    );
    const checkpoints = {
        added: [...x.added, ...y.added],
        removed: [...x.removed, ...y.removed],
        moved: [...x.moved, ...y.moved],
        renamed: [...x.renamed, ...y.renamed],
        changed: [...x.changed, ...y.changed],
    };
    const settings = settingsChanges(before, after);
    const geometryBefore = fieldGeometry(before);
    const geometryAfter = fieldGeometry(after);
    const empty =
        Object.values(checkpoints).every((list) => list.length === 0) &&
        settings.length === 0;
    return {
        edit,
        ok: errors.length === 0,
        empty,
        checkpoints,
        settings,
        geometry: {
            sizeChanged:
                !samePosition(
                    geometryBefore.widthSteps,
                    geometryAfter.widthSteps,
                ) ||
                !samePosition(
                    geometryBefore.heightSteps,
                    geometryAfter.heightSteps,
                ),
            centerChanged:
                !samePosition(
                    geometryBefore.centerFrontPoint.xPixels,
                    geometryAfter.centerFrontPoint.xPixels,
                ) ||
                !samePosition(
                    geometryBefore.centerFrontPoint.yPixels,
                    geometryAfter.centerFrontPoint.yPixels,
                ),
            stepSizeChanged: !samePosition(
                geometryBefore.stepSizeInches,
                geometryAfter.stepSizeInches,
            ),
            before: geometryBefore,
            after: geometryAfter,
        },
        errors,
        warnings,
        ...(kept ? { kept } : {}),
    };
}
