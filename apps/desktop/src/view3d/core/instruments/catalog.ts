/**
 * Which instrument a section carries and how (docs/3d/instruments.md §3).
 * Sections without a model carry nothing. Pure.
 */
import type { BrassModelId } from "./brass";
import type { HoldFamily } from "./holds";

export type Finish = "brass" | "silver";

export interface Carry {
    model: BrassModelId;
    family: HoldFamily;
}

const BRASS_SECTIONS: Record<string, Carry> = {
    trumpet: { model: "trumpet", family: "brass" },
    mellophone: { model: "mellophone", family: "brass" },
    baritone: { model: "baritone", family: "brass" },
    euphonium: { model: "euphonium", family: "brass" },
    trombone: { model: "trombone", family: "trombone" },
    "bass trombone": { model: "bassTrombone", family: "trombone" },
    tuba: { model: "contra", family: "contra" },
};

export function carryForSection(section: string): Carry | null {
    return BRASS_SECTIONS[section.trim().toLowerCase()] ?? null;
}
