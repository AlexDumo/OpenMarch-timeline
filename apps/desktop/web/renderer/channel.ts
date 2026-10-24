/**
 * The release channel this build was made for.
 */
export const WEB_CHANNEL: string =
    import.meta.env.VITE_PUBLIC_WEB_CHANNEL || "dev";

/**
 * What a build keeps in the browser (settings, the stored show, its lock, the
 * hand-off between reloads, the channels between windows) is namespaced, so
 * builds served from one origin don't share a show: one migrated by nightly
 * may not open in stable. That is the channel, such as `web:dev` and
 * `web:preview` on localhost, or for a lab build `lab-<test id>`, since every
 * lab test is served from lab.openmarch.com. The worker uses it too.
 */
export const STORAGE_NAMESPACE: string =
    import.meta.env.VITE_PUBLIC_WEB_STORAGE_NAMESPACE || WEB_CHANNEL;

export function storageKey(name: string) {
    return `openmarch-web:${STORAGE_NAMESPACE}:${name}`;
}
