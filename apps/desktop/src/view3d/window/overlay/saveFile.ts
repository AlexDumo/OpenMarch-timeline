/** Hands a made file to the browser's download, as the template buttons do. */
export function saveFile(
    name: string,
    mimeType: string,
    data: string | Uint8Array,
): void {
    const blob = new Blob(
        [typeof data === "string" ? data : (data as Uint8Array<ArrayBuffer>)],
        { type: mimeType },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
