import { create } from "zustand";
import type { VenueKitId } from "@/view3d/core/types";

/**
 * PROTOTYPE (venue underlay exploration). How the editor shows the 3D View's
 * venue under the 2D grid. Kept in localStorage so a tester's pick survives a
 * reload; exposed on `window.__venueUnderlay` so capture scripts can set it.
 */
export type UnderlayLook = "plain" | "faint" | "venue" | "ink" | "turf";
export type UnderlaySurroundings = "none" | "apron" | "stands";

export interface UnderlayState {
    look: UnderlayLook;
    surroundings: UnderlaySurroundings;
    /** Shows a different kit than the show's, for comparing; null = the show's. */
    kit: VenueKitId | null;
    set(partial: Partial<Omit<UnderlayState, "set">>): void;
}

const KEY = "om.proto.venueUnderlay";

function load(): Partial<UnderlayState> {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? (JSON.parse(raw) as Partial<UnderlayState>) : {};
    } catch {
        return {};
    }
}

export const useUnderlayStore = create<UnderlayState>((setState, get) => ({
    look: "faint",
    surroundings: "apron",
    kit: null,
    ...load(),
    set(partial) {
        setState(partial);
        try {
            const { look, surroundings, kit } = get();
            localStorage.setItem(
                KEY,
                JSON.stringify({ look, surroundings, kit }),
            );
        } catch {
            // Storage blocked: the pick lasts for this session only
        }
    },
}));

if (typeof window !== "undefined")
    (window as unknown as Record<string, unknown>).__venueUnderlay =
        useUnderlayStore;

/** Per-look numbers for the shader (see VenueUnderlayLayer). */
export interface LookParams {
    /** Share of venue color mixed into the field background (0 = plain). */
    amount: number;
    /** Saturation kept, 0..1. */
    saturation: number;
    /** Extra contrast for detail against the turf base (stripes, logo, end zones). */
    detail: number;
    /** Ink look: only markings, as grey ink on the background. */
    ink: boolean;
    /** Keep the turf's own yard lines, hashes and numbers. */
    keepMarkings: boolean;
    /** Surroundings mix share (stands render). */
    surroundAmount: number;
}

export const LOOKS: Record<Exclude<UnderlayLook, "plain">, LookParams> = {
    faint: {
        amount: 0.17,
        saturation: 0.5,
        detail: 0.35,
        ink: false,
        keepMarkings: false,
        surroundAmount: 0.22,
    },
    venue: {
        amount: 0.38,
        saturation: 0.7,
        detail: 0.45,
        ink: false,
        keepMarkings: false,
        surroundAmount: 0.42,
    },
    ink: {
        amount: 0.2,
        saturation: 0,
        detail: 0,
        ink: true,
        keepMarkings: false,
        surroundAmount: 0.18,
    },
    turf: {
        amount: 0.88,
        saturation: 0.9,
        detail: 0,
        ink: false,
        keepMarkings: true,
        surroundAmount: 0.8,
    },
};
