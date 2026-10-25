/** A random id like Excalidraw's (nanoid-style, 21 characters) */
export function randomId(): string {
    const alphabet =
        // cspell:disable-next-line
        "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
    const bytes = new Uint8Array(21);
    crypto.getRandomValues(bytes);
    let id = "";
    for (const b of bytes) id += alphabet[b & 63];
    return id;
}

/**
 * A uuid for sketches, pages and templates. `crypto.randomUUID` exists only in secure contexts
 * (HTTPS, localhost, file:), so a page served over plain HTTP builds a v4 uuid itself.
 */
export function uuid(): string {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A random 31-bit integer, for Excalidraw seeds and version nonces */
export const randomInteger = () => Math.floor(Math.random() * 2 ** 31);
