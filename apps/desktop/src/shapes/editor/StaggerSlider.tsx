import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Slider, Switch } from "@openmarch/ui";
import { NO_STAGGER, type Fraction } from "../distribute/distribution";
import { staggerOf, withStagger } from "../distribute/modes";
import {
    FREE_STAGGER_STEP,
    snapStagger,
    STAGGER_DETENTS,
    STAGGER_ON,
    staggerReadout,
    staggerValue,
    stepStagger,
} from "../distribute/stagger";
import type { ToolEnv } from "../tool/toolKind";
import type { ShapeEditTarget } from "./editTargets";

type Target = Pick<
    ShapeEditTarget,
    "kind" | "params" | "spots" | "apply" | "begin" | "preview" | "end"
>;

const ARROWS: Readonly<Record<string, -1 | 1>> = {
    ArrowRight: 1,
    ArrowUp: 1,
    ArrowLeft: -1,
    ArrowDown: -1,
};

/**
 * The box's stagger offset (#388, spec #385), in the inspector's shape section for a box in Files
 * laid out Full or Short back: a switch, then a slider from ½ left to ½ right that rests on 0, ±⅙,
 * ±¼, ±⅓ and ±½ (Alt for any hundredth), with a readout ("⅓ right · lines up every 3 ranks"). +
 * moves each rank toward the audience's right going back. A drag shows on the field as it goes
 * and is one change when let go; the arrow keys step between the rests. Hidden for the layouts
 * that fix or center their lines.
 */
export function StaggerSlider({
    target,
    envFor,
}: {
    target: Target;
    /** The field's tool environment when the stagger changes; null with no field */
    envFor: () => ToolEnv | null;
}) {
    const { kind, params, spots } = target;
    const now = staggerOf(kind, params, spots);
    // Switched on, the slider stays out at 0 until switched off
    const [switchedOn, setSwitchedOn] = useState(false);
    const [dragged, setDragged] = useState<Fraction | null>(null);
    const drag = useRef<{ base: unknown } | null>(null);
    const free = useRef(false);
    if (now === null) return null;
    const on = switchedOn || now[0] !== 0;
    const shown = dragged ?? now;

    const staggered = (base: unknown, stagger: Fraction) => {
        const env = envFor();
        return env ? withStagger(kind, base, spots, stagger, env) : base;
    };
    const set = (stagger: Fraction) => {
        const next = staggered(params, stagger);
        if (next !== params) target.apply(next);
    };
    const slideTo = (value: number) => {
        const stagger = snapStagger(value, free.current);
        if (!drag.current) return set(stagger);
        setDragged(stagger);
        target.preview(staggered(drag.current.base, stagger));
    };
    const letGo = (keep: boolean) => {
        if (!drag.current) return;
        drag.current = null;
        setDragged(null);
        target.end(keep);
    };

    return (
        <div className="flex flex-col gap-6" data-testid="shape-stagger">
            <div className="flex items-center gap-8">
                <span className="text-sub text-text/80 w-64">Stagger</span>
                <Switch
                    aria-label="Stagger"
                    data-testid="shape-stagger-switch"
                    checked={on}
                    onCheckedChange={(checked) => {
                        setSwitchedOn(checked);
                        set(checked ? STAGGER_ON : NO_STAGGER);
                    }}
                />
            </div>
            {on && (
                <>
                    <div className="relative">
                        <Slider
                            className="w-full"
                            aria-label="Stagger offset"
                            data-testid="shape-stagger-slider"
                            min={-0.5}
                            max={0.5}
                            step={FREE_STAGGER_STEP}
                            value={[staggerValue(shown)]}
                            onPointerDown={(e: PointerEvent) => {
                                free.current = e.altKey;
                                drag.current = { base: params };
                                target.begin();
                            }}
                            onPointerMove={(e: PointerEvent) => {
                                free.current = e.altKey;
                            }}
                            onPointerUp={() => letGo(true)}
                            onPointerCancel={() => letGo(false)}
                            onKeyDown={(e: KeyboardEvent) => {
                                const by = ARROWS[e.key];
                                if (!by) return;
                                e.preventDefault();
                                set(stepStagger(now, by, e.altKey));
                            }}
                            onValueChange={([value]) => {
                                if (value !== undefined) slideTo(value);
                            }}
                        />
                        <Detents />
                    </div>
                    <span
                        className="text-sub text-text/70"
                        data-testid="shape-stagger-readout"
                    >
                        {staggerReadout(shown)}
                    </span>
                </>
            )}
        </div>
    );
}

/**
 * Ticks under the slider where it rests. Inset by half the thumb, as the slider keeps its thumb
 * inside the track, so each tick sits under the thumb's center at that rest.
 */
function Detents() {
    return (
        <div className="pointer-events-none absolute inset-x-8 -bottom-4 h-4">
            {STAGGER_DETENTS.map((d) => (
                <span
                    key={`${d[0]}/${d[1]}`}
                    className="bg-text/40 absolute top-0 h-4 w-px"
                    style={{ left: `${(staggerValue(d) + 0.5) * 100}%` }}
                />
            ))}
        </div>
    );
}
