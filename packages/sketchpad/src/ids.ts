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

/** A uuid for sketches, pages and templates */
export function uuid(): string {
    return crypto.randomUUID();
}

/** A random 31-bit integer, for Excalidraw seeds and version nonces */
export const randomInteger = () => Math.floor(Math.random() * 2 ** 31);
