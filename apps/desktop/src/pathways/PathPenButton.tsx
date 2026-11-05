import clsx from "clsx";
import { PenNibIcon } from "@phosphor-icons/react";
import tolgee from "@/global/singletons/Tolgee";
import ActionButton from "@/shortcuts/ActionButton";
import { Tip } from "@/components/ui/Tip";
import ToolbarSection from "@/components/toolbar/ToolbarSection";
import { usePathPenStore } from "./pathPenStore";
import { penRefusal } from "./usePathPen";

const BUTTON =
    "enabled:hover:text-accent flex items-center gap-6 outline-hidden duration-150 ease-out focus-visible:-translate-y-4 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The toolbar's Path pen (pathways step 1): runs `pathPen` (P), lit while it draws. With no marcher
 * selected it's greyed and its tooltip says why; with several it draws a group path (step 15).
 */
export function PathPenButton({ performers }: { performers: number }) {
    const drawing = usePathPenStore((s) => s.session?.phase === "drawing");
    const refusal = penRefusal(performers);
    const label = tolgee.t("actions.path.pen", "Path pen");
    return (
        <ToolbarSection aria-label={label}>
            <Tip
                label={refusal ? `${label}: ${refusal}` : label}
                action={refusal ? undefined : "pathPen"}
            >
                <span>
                    <ActionButton
                        action="pathPen"
                        tooltip=""
                        disabled={refusal !== null}
                        aria-pressed={drawing}
                        aria-label={label}
                        data-testid="toolbar-path-pen"
                        className={clsx(
                            BUTTON,
                            drawing ? "text-accent" : "text-text",
                        )}
                    >
                        <PenNibIcon size={22} />
                        {tolgee.t("pathways.toolbar.path", "Path")}
                    </ActionButton>
                </span>
            </Tip>
        </ToolbarSection>
    );
}
