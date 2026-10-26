import {
    cloneElement,
    createContext,
    useContext,
    type ReactElement,
    type ReactNode,
} from "react";
import {
    ShortcutTooltip,
    TransportTooltipProvider,
} from "@/components/timeline/ShortcutTooltip";

const RichTipsContext = createContext(false);

/**
 * The app's tooltips (the timeline's `ShortcutTooltip`) for the controls inside: the floating
 * editor's icon buttons need their names shown properly, not as a browser `title` (owner, #429)
 */
export function RichTips({ children }: { children: ReactNode }) {
    return (
        <TransportTooltipProvider disableHoverableContent>
            <RichTipsContext.Provider value={true}>
                {children}
            </RichTipsContext.Provider>
        </TransportTooltipProvider>
    );
}

/**
 * A control's tooltip: the app's own inside {@link RichTips}, which never shows while the control
 * is pressed (a number's drag goes on undisturbed), and a plain `title` elsewhere (the
 * inspector). `children` is one element that takes a ref, such as a `<button>`.
 */
export function Tip({
    label,
    children,
}: {
    label: string;
    children: ReactElement<{ title?: string }>;
}) {
    const rich = useContext(RichTipsContext);
    if (!rich) return cloneElement(children, { title: label });
    return (
        <ShortcutTooltip label={label} closeOnPress>
            {children}
        </ShortcutTooltip>
    );
}
