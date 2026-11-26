import { cloneElement, type ReactElement } from "react";
import { useTranslate } from "@tolgee/react";
import { SegmentedTextSwitch } from "@openmarch/ui";
import { Tip } from "@/components/ui/Tip";
import { runAction } from "@/shortcuts/registry";
import { keepFocus } from "../editor/keepFocus";
import { PASTE_MODE_ACTION, type PasteMode } from "./pasteModeStore";

/**
 * Which way the open paste pastes (owner 2026-11-25): Paste | Paste exactly | Paste mirrored, the
 * one it's in picked. Each segment runs its paste's action, which switches the open paste to that
 * mode, as its key does; its tooltip has the key and what the mode does. A press doesn't take the
 * focus, so Enter still places the paste and Escape still discards it.
 */
export function PasteModeSwitch({ mode }: { mode: PasteMode }) {
    const { t } = useTranslate();
    const option = (value: PasteMode, label: string, hint?: string) => ({
        value,
        label,
        testId: `clipboard-paste-mode-${value}`,
        wrap: (item: ReactElement) => (
            <Tip label={label} action={PASTE_MODE_ACTION[value]} hint={hint}>
                {cloneElement(item, {
                    onPointerDown: keepFocus,
                } as Partial<unknown>)}
            </Tip>
        ),
    });
    return (
        <SegmentedTextSwitch
            ariaLabel={t("shapes.clipboard.pasteMode")}
            testId="clipboard-paste-mode"
            selected={mode}
            setSelected={(value) =>
                runAction(PASTE_MODE_ACTION[value as PasteMode])
            }
            className="shrink-0"
            options={[
                option(
                    "paste",
                    t("actions.edit.paste"),
                    t("shapes.clipboard.pasteHint"),
                ),
                option(
                    "exact",
                    t("actions.edit.pasteInPlace"),
                    t("shapes.clipboard.pasteExactlyHint"),
                ),
                option(
                    "mirrored",
                    t("actions.edit.pasteMirrored"),
                    t("shapes.clipboard.pasteMirroredHint"),
                ),
            ]}
        />
    );
}
