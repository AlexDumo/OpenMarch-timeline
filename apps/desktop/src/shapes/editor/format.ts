/** Steps in half steps, as drill writers say them: 2½, 3, ½ */
export function formatSteps(steps: number): string {
    const halves = Math.round(steps * 2);
    if (Math.abs(steps * 2 - halves) > 1e-6)
        return String(Math.round(steps * 100) / 100);
    const whole = Math.floor(halves / 2);
    if (halves % 2 === 0) return String(whole);
    return whole === 0 ? "½" : `${whole}½`;
}
