import type { SheetModel } from "../sheetData";

/**
 * A stand-in field image for the drill-chart check: a football field with
 * yard lines, hashes and one dot per marcher (positions are made up). The
 * real export would use the app's own field SVG.
 */
export function fieldSvg(model: SheetModel): string {
    const W = 1200;
    const H = 640;
    const step = W / 20;
    const lines: string[] = [];
    for (let i = 0; i <= 20; i++) {
        const x = i * step;
        lines.push(
            `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#888" stroke-width="${i % 2 ? 1 : 2}"/>`,
        );
        if (i % 2 === 0 && i > 0 && i < 20) {
            const yard = 50 - Math.abs(10 - i) * 5;
            lines.push(
                `<text x="${x}" y="${H - 30}" font-size="22" text-anchor="middle" fill="#666" font-family="Liberation Sans">${yard}</text>`,
            );
        }
    }
    for (const y of [H * 0.37, H * 0.63]) {
        for (let i = 0; i <= 100; i++) {
            const x = (i * W) / 100;
            lines.push(
                `<line x1="${x}" y1="${y - 5}" x2="${x}" y2="${y + 5}" stroke="#aaa"/>`,
            );
        }
    }
    const dots = model.marchers.map((m, i) => {
        const x = 300 + (i % 4) * 160;
        const y = 220 + Math.floor(i / 4) * 160;
        const label = m.drillNumber.replace(/[<&>"]/g, "");
        return `<circle cx="${x}" cy="${y}" r="9" fill="${i === 0 ? "#d00" : "#222"}"/><text x="${x}" y="${y - 16}" font-size="18" text-anchor="middle" font-family="Liberation Sans">${label}</text>`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff" stroke="#000" stroke-width="3"/>${lines.join("")}${dots.join("")}</svg>`;
}
