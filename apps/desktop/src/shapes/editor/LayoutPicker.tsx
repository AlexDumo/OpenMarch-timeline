import clsx from "clsx";
import {
    missingLine,
    nearestVersion,
    shapeKey,
    versionDots,
    type LayoutVersion,
} from "../distribute/layouts";
import { layoutOf, layoutRowsOf, withLayout } from "../distribute/modes";
import { useLastLayoutStore } from "../tool/lastLayout";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeEditTarget } from "./editTargets";
import { keepFocus } from "./keepFocus";

/**
 * The box's layout picker (#387, spec #385): Full · Stagger · Rounded · Short back · Notched, each
 * version a live thumbnail labelled by its block ("5 × 5"), the counts in its tooltip. Rows the
 * count can't make are listed on one line with how many would make them. Picking a version is
 * one change of the shape and becomes the layout a new box starts in.
 */

type Target = Pick<ShapeEditTarget, "kind" | "params" | "spots" | "apply">;

interface PickerProps {
    target: Target;
    /** The field's tool environment when a version is picked; null with no field */
    envFor: () => ToolEnv | null;
}

/** Picks `version` for the shape, and remembers its layout for the next new box */
function usePick({ target, envFor }: PickerProps) {
    const remember = useLastLayoutStore((s) => s.remember);
    return (version: LayoutVersion) => {
        const env = envFor();
        if (!env) return;
        remember(version.layout.family);
        const next = withLayout(
            target.kind,
            target.params,
            target.spots,
            version.layout,
            env,
        );
        if (next !== target.params) target.apply(next);
    };
}

/** The shape's layout now, as a key to compare versions with; null without layouts */
function currentKey(target: Target): string | null {
    const now = layoutOf(target.kind, target.params, target.spots);
    return now ? shapeKey(now.lines, now.layout.byFile) : null;
}

const keyOf = (v: LayoutVersion) => shapeKey(v.lines, v.layout.byFile);

/** The inspector's picker, in the shape section under the mode switch */
export function LayoutPicker(props: PickerProps) {
    const { target } = props;
    const pick = usePick(props);
    const current = currentKey(target);
    const rows = layoutRowsOf(target.kind, target.spots);
    if (current === null || rows.length === 0) return null;
    const missing = missingLine(target.spots, rows);
    return (
        <div
            className="flex flex-col gap-6"
            role="group"
            aria-label="Layout"
            data-testid="shape-layout-picker"
        >
            {rows
                .filter((row) => row.versions.length > 0)
                .map((row) => (
                    <div
                        key={row.family}
                        className="flex flex-col gap-2"
                        data-testid={`shape-layout-row-${row.family}`}
                    >
                        <span className="text-sub text-text/80">
                            {row.label}
                        </span>
                        <div className="flex flex-wrap gap-4">
                            {row.versions.map((version, i) => (
                                <VersionButton
                                    key={i}
                                    name={`${row.label} ${version.label}`}
                                    version={version}
                                    on={keyOf(version) === current}
                                    onPick={() => pick(version)}
                                    testId={`shape-layout-${row.family}-${i}`}
                                    showLabel
                                />
                            ))}
                        </div>
                    </div>
                ))}
            {missing && (
                <p
                    className="text-sub text-text/60"
                    data-testid="shape-layout-missing"
                >
                    {missing}
                </p>
            )}
        </div>
    );
}

/**
 * The picker under the floating chip: one thumbnail per layout the count makes, its version
 * nearest the shape's proportions (the shape's own for its layout). Versions of the chosen
 * layout are the size number's − and +.
 */
export function CompactLayoutPicker(props: PickerProps) {
    const { target } = props;
    const pick = usePick(props);
    const now = layoutOf(target.kind, target.params, target.spots);
    if (!now) return null;
    const current = shapeKey(now.lines, now.layout.byFile);
    const aspect = now.across / now.deep;
    const choices = layoutRowsOf(target.kind, target.spots).flatMap((row) => {
        const own = row.versions.find((v) => keyOf(v) === current);
        const version = own ?? nearestVersion(row.family, target.spots, aspect);
        return version ? [{ row, version, on: own !== undefined }] : [];
    });
    if (choices.length === 0) return null;
    return (
        <div
            className="flex items-center gap-2"
            role="group"
            aria-label="Layout"
            data-testid="shape-layout-compact"
        >
            {choices.map(({ row, version, on }) => (
                <VersionButton
                    key={row.family}
                    name={`${row.label} ${version.label}`}
                    version={version}
                    on={on}
                    onPick={() => pick(version)}
                    testId={`shape-layout-compact-${row.family}`}
                    small
                />
            ))}
        </div>
    );
}

function VersionButton({
    name,
    version,
    on,
    onPick,
    testId,
    showLabel,
    small,
}: {
    /** "Stagger 5 × 5" */
    name: string;
    version: LayoutVersion;
    on: boolean;
    onPick: () => void;
    testId: string;
    showLabel?: boolean;
    small?: boolean;
}) {
    return (
        <button
            type="button"
            aria-label={name}
            aria-pressed={on}
            title={`${name}: ${version.tooltip}`}
            onPointerDown={keepFocus}
            onClick={onPick}
            data-testid={testId}
            className={clsx(
                "rounded-4 flex flex-col items-center gap-2 border p-2",
                on
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-stroke hover:border-accent text-text",
            )}
        >
            <Thumbnail version={version} small={small} />
            {showLabel && <span className="text-xs">{version.label}</span>}
        </button>
    );
}

/** The version's spots as dots, drawn from the layout itself */
function Thumbnail({
    version,
    small,
}: {
    version: LayoutVersion;
    small?: boolean;
}) {
    const dots = versionDots(version.lines, version.layout.byFile);
    // Half an interval per unit; a box of the most spots that are listed stays a thumbnail
    const most = Math.max(version.across, version.deep);
    const unit = Math.min(small ? 1.75 : 3, (small ? 18 : 36) / (2 * most));
    const w = version.across * 2 * unit;
    const h = version.deep * 2 * unit;
    return (
        <svg
            width={w}
            height={h}
            viewBox={`${-w / 2} ${-h / 2} ${w} ${h}`}
            aria-hidden
        >
            {dots.map((d, i) => (
                <circle
                    key={i}
                    cx={d.x * unit}
                    cy={d.y * unit}
                    r={unit * 0.6}
                    fill="currentColor"
                />
            ))}
        </svg>
    );
}
