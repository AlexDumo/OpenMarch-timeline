/**
 * Reading a MusicXML file: from the file's bytes to its XML text, and from the text to a DOM.
 *
 * - **Compressed (.mxl).** A zip whose `META-INF/container.xml` names the score (`<rootfile
 *   full-path>`). Without a container, the first .musicxml or .xml file outside META-INF is used.
 * - **Text encoding.** Finale and some older exporters write UTF-16 with a byte order mark, and a
 *   few write ISO-8859-1 or Windows-1252 and say so in the XML declaration. Both are honored;
 *   everything else is read as UTF-8, including files that say UTF-16 but aren't.
 * - **Parsing** uses @xmldom/xmldom everywhere (Electron, the web editor's worker and tests) so a
 *   file reads the same in all of them. The DTD a file names is never fetched.
 */

import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import { descendants, type XmlElement } from "./scan";

const toBytes = (data: ArrayBuffer | Uint8Array) =>
    data instanceof Uint8Array ? data : new Uint8Array(data);

/** True when the bytes are a zip archive (an .mxl file), whatever the file is called. */
export const isZip = (data: ArrayBuffer | Uint8Array) => {
    const b = toBytes(data);
    return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
};

/** Decodes XML bytes, honoring a byte order mark or the encoding the XML declaration names. */
export function decodeXmlBytes(data: ArrayBuffer | Uint8Array): string {
    const b = toBytes(data);
    if (b[0] === 0xff && b[1] === 0xfe)
        return new TextDecoder("utf-16le").decode(b.subarray(2));
    if (b[0] === 0xfe && b[1] === 0xff)
        return new TextDecoder("utf-16be").decode(b.subarray(2));
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)
        return new TextDecoder("utf-8").decode(b.subarray(3));
    // UTF-16 without a byte order mark: "<" followed or preceded by a zero byte
    if (b[0] === 0x3c && b[1] === 0x00)
        return new TextDecoder("utf-16le").decode(b);
    if (b[0] === 0x00 && b[1] === 0x3c)
        return new TextDecoder("utf-16be").decode(b);
    const head = new TextDecoder("latin1").decode(b.subarray(0, 200));
    const declared = head.match(/^<\?xml[^>]*encoding=["']([^"']+)["']/)?.[1];
    // A declared 16-bit encoding on bytes that aren't 16-bit (no zero bytes, checked above) is a
    // mislabel: some exporters write encoding="UTF-16" on a UTF-8 file
    if (declared && !/^utf-?(8|16|32)/i.test(declared)) {
        try {
            return new TextDecoder(declared).decode(b);
        } catch {
            // An encoding TextDecoder doesn't know: fall through to UTF-8
        }
    }
    return new TextDecoder("utf-8").decode(b);
}

/** Parses XML text into a DOM. Throws when the text isn't well-formed XML. */
export function parseXmlDocument(xmlText: string): {
    documentElement: XmlElement | null;
} {
    const errors: string[] = [];
    const doc = new DOMParser({
        locator: {},
        errorHandler: {
            warning: () => {},
            // Recoverable (an unknown entity, a stray character): keep reading
            error: () => {},
            fatalError: (message: string) => errors.push(message),
        },
    }).parseFromString(xmlText, "text/xml");
    if (errors.length > 0 || !doc.documentElement)
        throw new Error(
            `Not well-formed XML: ${errors[0] ?? "no root element"}`,
        );
    return doc as unknown as { documentElement: XmlElement | null };
}

/** The score's path inside an .mxl archive. */
async function rootfilePath(zip: JSZip): Promise<string | undefined> {
    const container = zip.file("META-INF/container.xml");
    if (container) {
        try {
            const doc = parseXmlDocument(
                decodeXmlBytes(await container.async("uint8array")),
            );
            const rootfiles = descendants(doc.documentElement!, "rootfile");
            // The first rootfile is the score; later ones may be PDFs or other renderings
            const score =
                rootfiles.find((r) =>
                    /musicxml|^$/.test(r.getAttribute("media-type") ?? ""),
                ) ?? rootfiles[0];
            const path = score?.getAttribute("full-path");
            if (path && zip.file(path)) return path;
        } catch {
            // A broken container: look for the score by name below
        }
    }
    return Object.keys(zip.files).find(
        (name) =>
            /\.(musicxml|xml)$/i.test(name) &&
            !name.startsWith("META-INF/") &&
            !zip.files[name]!.dir,
    );
}

/** The score's XML text from a compressed MusicXML (.mxl) file. */
export async function extractXmlFromMxlFile(
    fileBuffer: ArrayBuffer | Uint8Array,
): Promise<string> {
    const zip = await JSZip.loadAsync(fileBuffer);
    const path = await rootfilePath(zip);
    if (!path) throw new Error("No XML file found.");
    return decodeXmlBytes(await zip.file(path)!.async("uint8array"));
}

/** The score's XML text from a MusicXML file's bytes, compressed (.mxl) or not. */
export async function readMusicXmlFile(
    data: ArrayBuffer | Uint8Array,
): Promise<string> {
    return isZip(data) ? extractXmlFromMxlFile(data) : decodeXmlBytes(data);
}
