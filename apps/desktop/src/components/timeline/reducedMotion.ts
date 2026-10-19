/** The person asked the OS for less motion: glides cut and split boxes take their place at once */
export const prefersReducedMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
