/** The parts of `navigator` the device checks read (tests pass their own). */
export interface NavigatorLike {
    userAgent: string;
    maxTouchPoints?: number;
}

/**
 * Whether this is an iPad, iPhone or iPod. iPadOS Safari says it is a Mac,
 * so a "Macintosh" with a touch screen counts too (Macs have none).
 */
export function isAppleTouchDevice(nav: NavigatorLike = navigator): boolean {
    if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true;
    return /Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1;
}

/** The Apple device wording the web editor uses; `null` is "this browser". */
export type AppleDeviceName = "ipad" | "iphone" | null;

/**
 * Which Apple device this is, for wording like "Shows on this iPad". An iPod
 * touch gets the generic browser wording, as does everything that isn't an
 * iPad or iPhone.
 */
export function appleDeviceName(
    nav: NavigatorLike = navigator,
): AppleDeviceName {
    if (/iPhone/.test(nav.userAgent)) return "iphone";
    if (/iPad/.test(nav.userAgent)) return "ipad";
    if (/iPod/.test(nav.userAgent)) return null;
    // iPadOS Safari says it is a Mac with a touch screen.
    return isAppleTouchDevice(nav) ? "ipad" : null;
}

/**
 * Whether the browser has the origin private file system and workers to
 * write to it, e.g. to stream a video export to disk instead of memory.
 */
export function hasOpfs(): boolean {
    return (
        typeof Worker === "function" &&
        typeof navigator.storage?.getDirectory === "function"
    );
}
