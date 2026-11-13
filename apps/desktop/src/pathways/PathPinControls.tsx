import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ClockCountdownIcon, PushPinIcon, XIcon } from "@phosphor-icons/react";
import tolgee from "@/global/singletons/Tolgee";
import { Tip } from "@/components/ui/Tip";
import { runAction } from "@/shortcuts/registry";
import { IconButton } from "@/shapes/editor/EditorBarParts";
import {
    pinOf,
    pinSelectedPoint,
    pointIdOf,
    shapeOf,
    unpinSelectedPoint,
    usePathPenStore,
    type PathSession,
} from "./pathPenStore";
import { pointOf } from "./pathEdit";
import { formatCount, passingCount } from "./pathPins";

/**
 * The selected point's count on the open path's bar (pathways step 5, AP-P1, AP-P3): a field
 * showing its pin, or empty with the count it is passed on now as a hint. Typing a whole count and
 * Enter pins the point there (one undo step); emptying it and Enter, or the ×, removes the pin.
 * "Pin to count…" in the point's menu and the palette puts the cursor here.
 */
export function PinCountField({ session }: { session: PathSession }) {
    const shape = shapeOf(session);
    const index = pointOf(shape, session.selected);
    const id = pointIdOf(session);
    const pin = pinOf(session, id);
    const passing = index >= 0 ? passingCount(session.target, shape, index) : 0;
    const shown = pin ? formatCount(pin.at) : "";
    const [draft, setDraft] = useState<string | null>(null);
    const ref = useRef<HTMLInputElement>(null);
    // Escape leaves the field without saving what was typed
    const dropDraft = useRef(false);
    const focus = usePathPenStore((s) => s.pinFocus);
    // A new point, or the pin changed under it: show what's stored
    useEffect(() => {
        setDraft(null);
    }, [id, pin?.at]);
    useEffect(() => {
        if (focus === 0) return;
        ref.current?.focus();
        ref.current?.select();
    }, [focus]);
    if (index < 0 || !id) return null;
    const last = session.target.end - session.target.start - 1;
    const commit = async (text: string): Promise<boolean> => {
        const trimmed = text.trim();
        if (trimmed === "") return pin ? await unpinSelectedPoint() : true;
        // Anything but a whole count inside the move is refused with its reason, in a toast
        const count = Number(trimmed);
        if (pin && count === pin.at) return true;
        return await pinSelectedPoint(count);
    };
    const label = tolgee.t(
        "pathways.editor.pinCountLabel",
        "Count this point is passed on: type a count from 1 to {last} and press Enter to pin it there",
        { last },
    );
    return (
        <span
            className="flex items-center gap-4"
            role="group"
            aria-label={tolgee.t("pathways.editor.pinGroup", "Pin")}
            data-testid="path-pin"
        >
            <Tip label={label} action="pathPinToCount">
                <span
                    className={clsx(
                        "flex items-center",
                        pin ? "text-accent" : "text-text-subtitle",
                    )}
                >
                    <PushPinIcon
                        size={14}
                        weight={pin ? "fill" : "regular"}
                        aria-hidden
                    />
                </span>
            </Tip>
            <input
                ref={ref}
                type="text"
                inputMode="numeric"
                spellCheck={false}
                aria-label={label}
                value={draft ?? shown}
                placeholder={`≈${formatCount(Math.round(passing * 10) / 10)}`}
                data-testid="path-pin-count"
                data-pinned={pin ? "true" : undefined}
                onChange={(e) => {
                    setDraft(e.target.value);
                }}
                // Leaving the field saves what was typed, as Enter does: a touch keyboard's
                // Done, or a tap elsewhere, has no Enter
                onBlur={() => {
                    const text = draft;
                    const drop = dropDraft.current;
                    dropDraft.current = false;
                    setDraft(null);
                    // A refused count says why in a toast; the field shows what's stored again
                    if (text !== null && !drop) void commit(text);
                }}
                onKeyDown={(e) => {
                    // The keys are the field's: Enter doesn't also finish the path, nor Space play
                    e.stopPropagation();
                    if (e.key === "Enter") ref.current?.blur();
                    else if (e.key === "Escape") {
                        e.preventDefault();
                        dropDraft.current = true;
                        ref.current?.blur();
                    }
                }}
                className={clsx(
                    "rounded-4 border-stroke bg-bg-1 w-40 border px-4 py-2 text-center font-mono",
                )}
            />
            {pin && (
                <IconButton
                    label={tolgee.t("actions.path.removePin", "Remove pin")}
                    action="pathRemovePin"
                    onClick={() => runAction("pathRemovePin")}
                    testId="path-pin-remove"
                >
                    <XIcon size={12} />
                </IconButton>
            )}
        </span>
    );
}

/**
 * Put corners on counts (AP-P4) on the open path's bar: a pin on every corner at the whole count
 * its share of the path's length gives, replacing the other pins.
 */
export function CornersOnCountsButton() {
    return (
        <IconButton
            label={tolgee.t(
                "pathways.editor.cornersOnCountsTip",
                "Pin every corner to the whole count it reaches at a steady speed. Replaces the path's other pins",
            )}
            action="putCornersOnCounts"
            onClick={() => runAction("putCornersOnCounts")}
            testId="path-corners-on-counts"
        >
            <ClockCountdownIcon size={14} />
            {tolgee.t("pathways.editor.cornersOnCounts", "Corners on counts")}
        </IconButton>
    );
}
