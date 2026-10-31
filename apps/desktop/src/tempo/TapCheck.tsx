/**
 * PROTOTYPE (tempo mode): a quick tapping check before tapping along to the music (Sibelius
 * calibrates Live Tempo the same way). It plays 4 clicks to listen to, then 12 to tap T along
 * with, and measures how late the taps land on average (latency: the person, the keyboard, the
 * speakers) and how much they wander (jitter). Taps along to the music are moved earlier by the
 * latency; a lot of jitter means taps get close and dragging finishes the job.
 *
 * The result is kept for this computer only (local storage).
 */
import { useEffect, useRef, useState } from "react";

const KEY = "tempoProto.tapCheck";
const BPM = 100;
const LISTEN = 4;
const TAPS = 12;
/** More than this (ms, median distance from the average) and taps are called uneven */
export const UNEVEN_JITTER_MS = 35;

export interface TapCheckResult {
    /** How late taps land on average, in seconds (negative: early) */
    latency: number;
    /** How far taps stray from that, in seconds (median absolute deviation) */
    jitter: number;
    /** How many taps it heard */
    taps: number;
    /** When the check was done (ISO) */
    at: string;
}

export function readTapCheck(): TapCheckResult | null {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? (JSON.parse(raw) as TapCheckResult) : null;
    } catch {
        return null;
    }
}

function saveTapCheck(result: TapCheckResult) {
    try {
        localStorage.setItem(KEY, JSON.stringify(result));
    } catch {
        /* a per-computer convenience only */
    }
}

const median = (values: readonly number[]) => {
    const s = [...values].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Each tap against the click nearest it (within half a click), as seconds late */
export function tapOffsets(
    clicks: readonly number[],
    taps: readonly number[],
): number[] {
    const period = 60 / BPM;
    const out: number[] = [];
    for (const t of taps) {
        let best = clicks[0]!;
        for (const c of clicks)
            if (Math.abs(t - c) < Math.abs(t - best)) best = c;
        if (Math.abs(t - best) < period / 2) out.push(t - best);
    }
    return out;
}

export function summarize(offsets: readonly number[]): TapCheckResult | null {
    if (offsets.length < 6) return null;
    // the first couple of taps are often a settling-in; drop the two furthest from the rest
    const m0 = median(offsets);
    const kept = [...offsets]
        .sort((a, b) => Math.abs(a - m0) - Math.abs(b - m0))
        .slice(0, Math.max(6, offsets.length - 2));
    const latency = median(kept);
    const jitter = median(kept.map((o) => Math.abs(o - latency)));
    return {
        latency,
        jitter,
        taps: offsets.length,
        at: new Date().toISOString(),
    };
}

type Phase =
    | { kind: "ready" }
    | { kind: "running"; heard: number; beat: number }
    | { kind: "done"; result: TapCheckResult | null };

export function TapCheckPanel({
    onClose,
    beforeTapping = false,
}: {
    /** `tapAnyway`: tap along without a check (taps aren't moved to make up for lateness) */
    onClose: (result: TapCheckResult | null, tapAnyway?: boolean) => void;
    /** Offered before tapping along: the check is optional, and tapping can go ahead without it */
    beforeTapping?: boolean;
}) {
    const [phase, setPhase] = useState<Phase>({ kind: "ready" });
    const ctxRef = useRef<AudioContext | null>(null);
    const clicks = useRef<number[]>([]);
    const taps = useRef<number[]>([]);
    const previous = readTapCheck();

    const start = async () => {
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        await ctx.resume();
        const period = 60 / BPM;
        const t0 = ctx.currentTime + 0.4;
        clicks.current = [];
        taps.current = [];
        for (let i = 0; i < LISTEN + TAPS; i++) {
            const at = t0 + i * period;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = i < LISTEN ? 1500 : 1000;
            gain.gain.setValueAtTime(0.0001, at);
            gain.gain.exponentialRampToValueAtTime(0.6, at + 0.002);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
            osc.connect(gain).connect(ctx.destination);
            osc.start(at);
            osc.stop(at + 0.06);
            if (i >= LISTEN) clicks.current.push(at);
        }
        setPhase({ kind: "running", heard: 0, beat: 0 });
        // a light on each click, so it can be followed without sound too
        const tick = () => {
            if (ctxRef.current !== ctx) return;
            const n = Math.floor((ctx.currentTime - t0) / period);
            if (n >= LISTEN + TAPS + 1) {
                const result = summarize(
                    tapOffsets(clicks.current, taps.current),
                );
                if (result) saveTapCheck(result);
                setPhase({ kind: "done", result });
                void ctx.close();
                ctxRef.current = null;
                return;
            }
            setPhase({ kind: "running", heard: taps.current.length, beat: n });
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    };

    const panelRef = useRef<HTMLDivElement>(null);
    const primaryRef = useRef<HTMLButtonElement>(null);
    // The focus starts on the main button (Start, then Done), so Enter presses it
    useEffect(() => {
        if (phase.kind !== "running") primaryRef.current?.focus();
    }, [phase.kind]);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopImmediatePropagation();
                void ctxRef.current?.close();
                ctxRef.current = null;
                onClose(null);
                return;
            }
            const key = e.key.toLowerCase();
            // While it's open, T, Space and Enter are the check's alone: they never reach
            // playback or the tempo lanes' tapping (jo)
            if (key !== "t" && key !== " " && key !== "enter") return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.repeat) return;
            const ctx = ctxRef.current;
            if (key === "enter" || (key === " " && !ctx)) {
                // Enter (or Space) presses the focused button in the panel, else its main one
                const focused = document.activeElement;
                const button =
                    focused instanceof HTMLButtonElement &&
                    panelRef.current?.contains(focused)
                        ? focused
                        : primaryRef.current;
                button?.click();
                return;
            }
            // T, or Space, taps while the clicks play
            if (!ctx) return;
            // when the press happened, in the audio clock's time as heard at the speakers
            const stamp = ctx.getOutputTimestamp();
            const heardNow = stamp.contextTime ?? ctx.currentTime;
            const since =
                (performance.now() -
                    (stamp.performanceTime ?? performance.now())) /
                1000;
            const late = (performance.now() - e.timeStamp) / 1000;
            taps.current.push(heardNow + since - late);
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onClose]);

    const ms = (s: number) => `${Math.round(s * 1000)} ms`;
    const tapAnyway = beforeTapping ? (
        <button
            type="button"
            className="rounded-6 border-stroke border px-10 py-3 text-[12px]"
            onClick={() => onClose(null, true)}
        >
            Tap without it
        </button>
    ) : null;
    const describe = (r: TapCheckResult) => {
        const when =
            Math.abs(r.latency) < 0.015
                ? "right on the click"
                : r.latency > 0
                  ? `${ms(r.latency)} after the click`
                  : `${ms(-r.latency)} before the click`;
        return `Your taps land ${when} on average, give or take ${ms(r.jitter)}.`;
    };
    return (
        <div
            ref={panelRef}
            role="dialog"
            aria-label="Check your tapping"
            data-testid="tempo-tap-check"
            className="bg-modal shadow-modal text-text border-stroke rounded-6 fixed top-1/3 left-1/2 z-[100] flex max-h-[calc(100vh-32px)] w-[380px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col gap-8 overflow-y-auto border p-12 backdrop-blur-md"
            onPointerDown={(e) => e.stopPropagation()}
        >
            <div className="text-[13px] font-bold">Check your tapping</div>
            {phase.kind === "ready" && (
                <>
                    <div className="text-text-subtitle text-[12px]">
                        You'll hear 4 high clicks to get the feel, then 12 lower
                        ones. Tap T along with the lower ones. It takes about 10
                        seconds, and measures how late your taps land on this
                        computer, so taps on the music can be moved to match.
                    </div>
                    {beforeTapping && (
                        <div className="text-text-subtitle text-[12px]">
                            The check is optional: you can tap along without it,
                            and your taps are used as they land.
                        </div>
                    )}
                    {previous && (
                        <div className="text-text-subtitle text-[11px]">
                            Last check: {describe(previous)}
                        </div>
                    )}
                    <div className="flex gap-6">
                        <button
                            ref={primaryRef}
                            type="button"
                            className="rounded-6 border-accent text-accent focus-visible:ring-accent border px-10 py-3 text-[12px] outline-hidden focus-visible:ring-2"
                            onClick={() => void start()}
                        >
                            Start
                        </button>
                        {tapAnyway}
                        <button
                            type="button"
                            className="rounded-6 border-stroke border px-10 py-3 text-[12px]"
                            onClick={() => onClose(null)}
                        >
                            Cancel
                        </button>
                    </div>
                </>
            )}
            {phase.kind === "running" && (
                <div className="flex items-center gap-10">
                    <div
                        className={`size-16 rounded-full ${phase.beat >= 0 && phase.beat < LISTEN + TAPS ? (phase.beat < LISTEN ? "bg-text-subtitle" : "bg-accent") : "bg-stroke"}`}
                        style={{ opacity: phase.beat >= 0 ? 1 : 0.3 }}
                    />
                    <div className="text-[12px]">
                        {phase.beat < LISTEN
                            ? `Listen… ${Math.max(1, phase.beat + 1)} of ${LISTEN}`
                            : `Tap T (or Space) with the clicks: ${phase.heard} tap(s)`}
                    </div>
                </div>
            )}
            {phase.kind === "done" && (
                <>
                    {phase.result ? (
                        <>
                            <div className="text-[12px]">
                                {describe(phase.result)}
                            </div>
                            <div className="text-text-subtitle text-[12px]">
                                {phase.result.jitter * 1000 > UNEVEN_JITTER_MS
                                    ? "Your taps vary quite a bit. Tapping will get the counts close; drag them onto the hits in the music to finish."
                                    : `Taps on the music will be moved ${ms(Math.abs(phase.result.latency))} ${phase.result.latency >= 0 ? "earlier" : "later"} to match.`}
                            </div>
                        </>
                    ) : (
                        <div className="text-[12px]">
                            Not enough taps landed near the clicks to tell. Try
                            again, tapping T on each lower click.
                        </div>
                    )}
                    <div className="flex gap-6">
                        <button
                            ref={primaryRef}
                            type="button"
                            className="rounded-6 border-accent text-accent focus-visible:ring-accent border px-10 py-3 text-[12px] outline-hidden focus-visible:ring-2"
                            onClick={() => onClose(phase.result)}
                        >
                            Done
                        </button>
                        <button
                            type="button"
                            className="rounded-6 border-stroke border px-10 py-3 text-[12px]"
                            onClick={() => setPhase({ kind: "ready" })}
                        >
                            Again
                        </button>
                        {!phase.result && tapAnyway}
                    </div>
                </>
            )}
        </div>
    );
}
