import { useMemo } from "react";
import {
    forEachWaveformBar,
    WAVEFORM_PEAKS_PER_BEAT,
    waveformBarHalfHeight,
    waveformBarRadius,
    type WaveformStyle,
} from "@/timeline/timelineWaveform";

const BEATS = 6;
const PIXELS_PER_BEAT = 28;
const WIDTH = BEATS * PIXELS_PER_BEAT;
const HEIGHT = 32;

/**
 * A made-up bar of music for the preview: a hit on each beat that rings out, quiet for the first
 * half and loud for the second, so the two scales differ where it matters (the quiet half).
 */
const SAMPLE_PEAKS: readonly (readonly number[])[] = Array.from(
    { length: BEATS },
    (_, beat) => {
        const loudness = [0.05, 0.07, 0.1, 0.6, 0.85, 1][beat]!;
        return Array.from({ length: WAVEFORM_PEAKS_PER_BEAT }, (_, slice) => {
            const ring = 0.25 + 0.75 * Math.exp(-slice / 5);
            const texture = 0.85 + 0.15 * Math.sin(slice * 2.3 + beat);
            return loudness * ring * texture;
        });
    },
);

/** A small sample waveform drawn in a style, through the same bar layout as the timeline */
export default function WaveformStylePreview({
    style,
}: {
    style: WaveformStyle;
}) {
    const bars = useMemo(() => {
        const rects: { x: number; width: number; half: number }[] = [];
        forEachWaveformBar(
            SAMPLE_PEAKS,
            style,
            PIXELS_PER_BEAT,
            0,
            WIDTH,
            (x, width, level) =>
                rects.push({
                    x,
                    width,
                    half: waveformBarHalfHeight(level, HEIGHT),
                }),
        );
        return rects;
    }, [style]);
    const radius = waveformBarRadius(style);

    return (
        <svg
            aria-hidden="true"
            width={WIDTH}
            height={HEIGHT}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="fill-current"
        >
            <rect
                x={0}
                y={HEIGHT / 2}
                width={WIDTH}
                height={1}
                opacity={0.25}
            />
            {bars.map((bar) => (
                <rect
                    key={bar.x}
                    x={bar.x}
                    y={HEIGHT / 2 - bar.half}
                    width={bar.width}
                    height={bar.half * 2}
                    rx={radius}
                />
            ))}
        </svg>
    );
}
