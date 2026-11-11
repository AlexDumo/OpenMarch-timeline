import type { FieldEditIssue, FieldEditIssueCode } from "./types";

type Translate = (
    key: string,
    params?: Record<string, string | number>,
) => string;

/** The translated text for each issue, by code. Issues carry English `message`s for agents/logs. */
const ISSUE_KEYS: Record<FieldEditIssueCode, string> = {
    "unknown-edit": "fieldEdits.issues.invalid",
    "invalid-args": "fieldEdits.issues.invalid",
    "not-found": "fieldEdits.issues.notFound",
    "min-checkpoints": "fieldProperties.checkpoint.minimumRequired",
    "duplicate-id": "fieldEdits.issues.invalid",
    "duplicate-position": "fieldEdits.issues.duplicatePosition",
    "y-in-front": "fieldEdits.issues.yInFront",
    "invalid-step-size": "fieldEdits.issues.invalidStepSize",
    "center-locked": "fieldEdits.issues.centerLocked",
    "no-gap": "fieldEdits.issues.noGap",
    "too-many": "fieldEdits.issues.tooMany",
    "unknown-setting": "fieldEdits.issues.invalid",
    "unknown-template": "fieldEdits.issues.invalid",
    "asymmetric-x": "fieldEdits.issues.asymmetricX",
    "mirror-ignored": "fieldEdits.issues.mirrorIgnored",
    "skipped-existing": "fieldEdits.issues.skippedExisting",
};

/** A field edit's error or warning as text for the user (toasts) */
export function fieldEditIssueMessage(
    issue: FieldEditIssue,
    t: Translate,
): string {
    return t(ISSUE_KEYS[issue.code], {
        axis: (issue.axis ?? "x").toUpperCase(),
    });
}
