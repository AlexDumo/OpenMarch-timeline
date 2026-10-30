import {
    createContext,
    useContext,
    type ReactElement,
    type ReactNode,
} from "react";
import {
    ShortcutTooltip,
    TransportTooltipProvider,
} from "@/components/timeline/ShortcutTooltip";

const InRichTips = createContext(false);

/**
 * One tooltip timing for the controls inside, as the timeline's transport has: moving along a
 * row reads each control in turn (the floating editor). {@link Tip} works without it too.
 */
export function RichTips({ children }: { children: ReactNode }) {
    return (
        <TransportTooltipProvider disableHoverableContent>
            <InRichTips.Provider value={true}>{children}</InRichTips.Provider>
        </TransportTooltipProvider>
    );
}

/**
 * A control's tooltip in the shapes UI: the app's own (the timeline's `ShortcutTooltip`), never
 * a browser `title` (owner, #429). It never shows while the control is pressed, so a number's
 * drag goes on undisturbed. `children` is one element that takes a ref, such as a `<button>`;
 * with no `label` it has no tooltip. `shortcut` adds its keys as keycaps, `hint` a second line.
 */
export function Tip({
    label,
    shortcut,
    hint,
    children,
}: {
    label: string | undefined;
    shortcut?: string;
    /** A second, quieter line: the whole of a description shown cut short */
    hint?: string;
    children: ReactElement;
}) {
    const shared = useContext(InRichTips);
    if (!label) return children;
    const tip = (
        <ShortcutTooltip
            label={label}
            shortcut={shortcut}
            hint={hint}
            closeOnPress
        >
            {children}
        </ShortcutTooltip>
    );
    return shared ? (
        tip
    ) : (
        <TransportTooltipProvider disableHoverableContent>
            {tip}
        </TransportTooltipProvider>
    );
}
