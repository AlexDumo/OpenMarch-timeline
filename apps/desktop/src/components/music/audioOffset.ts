/**
 * The Music panel's Audio Offset in words (FX-5). The offset pads silence before the music when
 * positive, so a click track whose count 1 is 0.5 s in needs -0.5: the field says which way its
 * sign goes instead of leaving it to trial and error. Pure.
 */

/** "-0.5", "0.123": milliseconds at most, no float noise ("-0.5000000000000002") */
export const formatAudioOffset = (seconds: number): string =>
    String(Math.round(seconds * 1000) / 1000 || 0);

/** What the field's sign means, as a translation key and its params */
export function audioOffsetHint(seconds: number): {
    key: string;
    params: Record<string, string>;
} {
    const ms = Math.round(seconds * 1000);
    const abs = (Math.abs(ms) / 1000).toFixed(3);
    if (ms === 0) return { key: "music.audioOffsetHint.on", params: {} };
    return ms < 0
        ? { key: "music.audioOffsetHint.before", params: { seconds: abs } }
        : { key: "music.audioOffsetHint.after", params: { seconds: abs } };
}
