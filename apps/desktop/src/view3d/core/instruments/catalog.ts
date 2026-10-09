/**
 * Which instrument a section carries and how (docs/3d/instruments.md §3).
 * Sections without a model carry nothing. Pure.
 */
import type { HoldFamily } from "./holds";
import type { ModelId } from "./model";

export type Finish = "brass" | "silver";

export interface Carry {
    model: ModelId;
    family: HoldFamily;
}

const SECTIONS: Record<string, Carry> = {
    trumpet: { model: "trumpet", family: "brass" },
    mellophone: { model: "mellophone", family: "brass" },
    baritone: { model: "baritone", family: "brass" },
    euphonium: { model: "euphonium", family: "brass" },
    trombone: { model: "trombone", family: "trombone" },
    "bass trombone": { model: "bassTrombone", family: "trombone" },
    tuba: { model: "contra", family: "contra" },
    piccolo: { model: "piccolo", family: "flute" },
    flute: { model: "flute", family: "flute" },
    clarinet: { model: "clarinet", family: "clarinet" },
    "bass clarinet": { model: "bassClarinet", family: "clarinet" },
    "soprano sax": { model: "sopranoSax", family: "clarinet" },
    "alto sax": { model: "altoSax", family: "sax" },
    "tenor sax": { model: "tenorSax", family: "sax" },
    "bari sax": { model: "bariSax", family: "sax" },
    snare: { model: "snare", family: "snare" },
    tenors: { model: "tenors", family: "tenors" },
    "bass drum": { model: "bass", family: "bass" },
    "flub drum": { model: "bass", family: "bass" },
    cymbals: { model: "cymbals", family: "cymbals" },
};

export function carryForSection(section: string): Carry | null {
    return SECTIONS[section.trim().toLowerCase()] ?? null;
}
