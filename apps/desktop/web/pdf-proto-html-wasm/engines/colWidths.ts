// cspell:words fulgur fulgur's ironpress dompdf fontkit krilla stylo nosplit asis breakbefore
/**
 * fulgur ignores `<col style="width:…">`; copy each column's width onto the
 * matching header cell so `table-layout: fixed` gets the same columns as in
 * Chromium. A string transform, so it runs in a page, a worker or Node.
 */
export function colWidthsToHeaderCells(html: string): string {
    return html.replace(
        /<colgroup>(.*?)<\/colgroup>\s*<thead>(.*?)<\/thead>/gs,
        (_m, cols: string, thead: string) => {
            const widths = [
                ...cols.matchAll(/<col[^>]*style="[^"]*width:\s*([^;"]+)/g),
            ].map((c) => c[1]);
            let i = 0;
            const newThead = thead.replace(
                /<th([^>]*?)style="([^"]*)"/g,
                (th, attrs, style) => {
                    const w = widths[i++];
                    if (!w) return th;
                    const cleaned = style.replace(/(^|;)\s*width:[^;]*/g, "$1");
                    return `<th${attrs}style="${cleaned};width:${w}"`;
                },
            );
            return `<colgroup>${cols}</colgroup><thead>${newThead}</thead>`;
        },
    );
}
