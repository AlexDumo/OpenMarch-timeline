/** The person asked the OS for less motion: glides cut, and clips out of page boxes appear in place */
export const prefersReducedMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
