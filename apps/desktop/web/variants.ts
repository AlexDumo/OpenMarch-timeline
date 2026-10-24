/**
 * TEMPORARY (see LAB.md, "Comparing versions"). The version switch: when the
 * lab test lists `variants` in its manifest, testers pick one from the
 * toolbar and the app changes behavior at once, on the same show. The URL's
 * `variant` parameter says which (`src/lab/labVariant.ts` keeps it), so a
 * reload keeps it and the lab's feedback, which records the page's URL, says
 * which version was on.
 */
import { useLabVariantStore } from "@/lab/labVariant";

interface LabVariant {
    id: string;
    label: string;
    description: string;
}

/** From the manifest's front matter, at build time (vite.config.mts) */
declare const __LAB_VARIANTS__: LabVariant[];

const variants: LabVariant[] = __LAB_VARIANTS__;

const select = (variant: LabVariant) =>
    useLabVariantStore.getState().setVariant(variant.id);

/** Sets the version from the URL, or the first one. Call before the app loads. */
export function initVariants() {
    if (!variants.length) return;
    const current = useLabVariantStore.getState().variant;
    select(variants.find((v) => v.id === current) ?? variants[0]);
}

/** The switch for the toolbar, or null when the test compares nothing */
export function variantSwitch(): HTMLElement | null {
    if (!variants.length) return null;
    const group = document.createElement("div");
    group.className = "omw-variants";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "Version to try");
    const name = document.createElement("span");
    name.textContent = "Version";
    group.append(name);

    const buttons = variants.map((variant) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "radio");
        button.dataset.variant = variant.id;
        button.textContent = variant.label;
        button.title = variant.description || variant.label;
        button.addEventListener("click", () => {
            select(variant);
            // Back to the app, so its shortcuts work straight away
            button.blur();
        });
        return button;
    });
    const update = (current: string | null) =>
        variants.forEach((variant, index) =>
            buttons[index].setAttribute(
                "aria-checked",
                String(variant.id === current),
            ),
        );
    update(useLabVariantStore.getState().variant);
    useLabVariantStore.subscribe((state) => update(state.variant));
    group.append(...buttons);
    return group;
}
