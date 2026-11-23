import clsx from "clsx";
import { useTranslate } from "@tolgee/react";
import { useShallow } from "zustand/react/shallow";
import type { VenueKitId } from "@/view3d/core/types";
import {
    useUnderlayStore,
    type UnderlayLook,
    type UnderlaySurroundings,
} from "./underlayStore";

/** PROTOTYPE: picks the venue underlay's look while we explore. */
const LOOK_OPTIONS: { id: UnderlayLook; label: string }[] = [
    { id: "plain", label: "Plain" },
    { id: "faint", label: "Faint" },
    { id: "venue", label: "Venue" },
    { id: "ink", label: "Ink" },
    { id: "turf", label: "Turf" },
];
const SURROUND_OPTIONS: { id: UnderlaySurroundings; label: string }[] = [
    { id: "none", label: "Field only" },
    { id: "apron", label: "Apron" },
    { id: "stands", label: "Stands" },
];
const KIT_OPTIONS: { id: VenueKitId | null; label: string }[] = [
    { id: null, label: "Show's venue" },
    { id: "hs", label: "High school" },
    { id: "bighs", label: "Big high school" },
    { id: "college", label: "College" },
    { id: "pro", label: "Pro dome" },
    { id: "gym", label: "Gym" },
    { id: "arena", label: "Arena" },
];

function Segment<T extends string>({
    options,
    value,
    onPick,
}: {
    options: { id: T; label: string }[];
    value: T;
    onPick: (id: T) => void;
}) {
    return (
        <div className="border-stroke rounded-6 flex overflow-hidden border">
            {options.map((o) => (
                <button
                    key={o.id}
                    type="button"
                    data-underlay={o.id}
                    onClick={() => onPick(o.id)}
                    className={clsx(
                        "text-sub px-8 py-2 transition-colors",
                        o.id === value
                            ? "bg-accent text-text-invert"
                            : "text-text hover:bg-fg-2",
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

export default function UnderlaySwitcher() {
    const { t } = useTranslate();
    const { look, surroundings, kit, set } = useUnderlayStore(
        useShallow((s) => ({
            look: s.look,
            surroundings: s.surroundings,
            kit: s.kit,
            set: s.set,
        })),
    );
    return (
        <div
            className="bg-modal border-stroke rounded-6 absolute top-8 left-1/2 z-20 flex -translate-x-1/2 flex-wrap items-center gap-8 border p-6 shadow-md"
            data-testid="underlaySwitcher"
            onPointerDown={(e) => e.stopPropagation()}
        >
            <span className="text-sub text-text-subtitle">
                {t("field.venueUnderlay.prototypeLabel")}
            </span>
            <Segment
                options={LOOK_OPTIONS}
                value={look}
                onPick={(id) => set({ look: id })}
            />
            <Segment
                options={SURROUND_OPTIONS}
                value={surroundings}
                onPick={(id) => set({ surroundings: id })}
            />
            <select
                className="bg-fg-2 border-stroke rounded-6 text-sub text-text border px-6 py-2"
                value={kit ?? ""}
                onChange={(e) =>
                    set({
                        kit: (e.target.value || null) as VenueKitId | null,
                    })
                }
            >
                {KIT_OPTIONS.map((o) => (
                    <option key={o.label} value={o.id ?? ""}>
                        {o.label}
                    </option>
                ))}
            </select>
        </div>
    );
}
