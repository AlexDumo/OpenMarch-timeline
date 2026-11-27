import type { CSSProperties } from "react";
import { TOUCH_HIT_AREA_CLASS } from "./touchTargets";

/**
 * A small timeline target's finger-sized hit area (tablet plan 3.3): an invisible span inside the
 * target, so a finger's press on it is the target's. It shows only in the touch layout. Where hit
 * areas overlap, the timeline's gesture adapter gives the press to the selected object's target,
 * then to the nearest (`pickTouchTarget`). Its parent is the target; the target's child marked
 * `data-touch-drawn` (its line, bar or diamond) is what "nearest" measures to, or else the target.
 */
export function TouchHitArea({
    selected = false,
    group,
    line = false,
    overLines = false,
    className = TOUCH_HIT_AREA_CLASS,
    style,
}: {
    /** Part of the selected object: it wins where hit areas overlap */
    selected?: boolean;
    /** The object it belongs to (a clip): a press on that object's body may still reach it */
    group?: string;
    /** The start flag's or the playhead's line */
    line?: boolean;
    /** The selected clip's start or end: where a line sits on it, it wins the press (#593) */
    overLines?: boolean;
    /** Replaces the centered 44px area, for a target that reaches one way (a clip edge) */
    className?: string;
    style?: CSSProperties;
}) {
    return (
        <span
            aria-hidden="true"
            data-touch-hit=""
            data-touch-selected={selected || undefined}
            data-touch-group={group}
            data-touch-line={line || undefined}
            data-touch-over-lines={overLines || undefined}
            className={className}
            style={style}
        />
    );
}
