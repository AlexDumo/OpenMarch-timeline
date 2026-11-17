import { useState } from "react";
import { useTranslate } from "@tolgee/react";
import {
    ArrowSquareOutIcon,
    BookOpenIcon,
    CheckIcon,
    CopyIcon,
    SparkleIcon,
} from "@phosphor-icons/react/dist/ssr";
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
    TextArea,
} from "@openmarch/ui";
import { version } from "../../../package.json";
import { SITE_URL, siteUrl } from "@/global/siteUrl";
import { useHelpDialogStore } from "@/stores/HelpDialogStore";
import { useIsBasicMode } from "@/stores/EditorModeStore";
import { isWebBuild } from "@/utilities/webBuild";
import { helpPrompt } from "./helpPrompt";

/** Opens a web page in the default browser (desktop) or a new tab (web editor). */
function openPage(url: string) {
    if (window.electron?.openExternal) void window.electron.openExternal(url);
    else window.open(url, "_blank", "noopener");
}

/**
 * Help (the ? in the title bar, F1, or Help › Get Help…): read the user guide, or copy a prompt
 * that has an AI assistant read the guide and answer, with the user's question if they typed one.
 */
export default function HelpDialog() {
    const open = useHelpDialogStore((s) => s.open);
    const setOpen = useHelpDialogStore((s) => s.setOpen);
    if (!open) return null;
    return (
        <Dialog open onOpenChange={setOpen}>
            <DialogContent className="w-[min(34rem,90vw)]">
                <HelpBody />
            </DialogContent>
        </Dialog>
    );
}

function HelpBody() {
    const { t } = useTranslate();
    const basic = useIsBasicMode();
    const [question, setQuestion] = useState("");
    // "copied" for a moment after a copy; "failed" shows the prompt to copy by hand
    const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

    const prompt = helpPrompt({
        site: SITE_URL,
        version,
        app: isWebBuild ? "web" : "desktop",
        mode: basic ? "Basic" : "Expert",
        question,
    });

    const copyPrompt = async () => {
        try {
            await navigator.clipboard.writeText(prompt);
            setCopy("copied");
            window.setTimeout(
                () => setCopy((c) => (c === "copied" ? "idle" : c)),
                2000,
            );
        } catch {
            setCopy("failed");
        }
    };

    return (
        <div className="flex flex-col gap-16" data-testid="help-dialog">
            <DialogTitle>{t("help.title")}</DialogTitle>
            <DialogDescription>{t("help.description")}</DialogDescription>

            <section className="rounded-6 border-stroke flex flex-col gap-8 border p-16">
                <h3 className="text-body text-text flex items-center gap-6 font-medium">
                    <BookOpenIcon size={18} aria-hidden />
                    {t("help.guide.title")}
                </h3>
                <p className="text-sub text-text-subtitle">
                    {t("help.guide.body")}
                </p>
                <Button
                    size="compact"
                    variant="secondary"
                    onClick={() => openPage(siteUrl("/guides/"))}
                >
                    {t("help.guide.open")}
                    <ArrowSquareOutIcon size={16} aria-hidden />
                </Button>
            </section>

            <section className="rounded-6 border-stroke flex flex-col gap-8 border p-16">
                <h3 className="text-body text-text flex items-center gap-6 font-medium">
                    <SparkleIcon size={18} aria-hidden />
                    {t("help.ai.title")}
                </h3>
                <p className="text-sub text-text-subtitle">
                    {t("help.ai.body")}
                </p>
                <label className="text-sub text-text flex flex-col gap-4">
                    {t("help.ai.questionLabel")}
                    <TextArea
                        value={question}
                        onChange={(e) => {
                            setQuestion(e.target.value);
                            if (copy !== "idle") setCopy("idle");
                        }}
                        placeholder={t("help.ai.questionPlaceholder")}
                        className="min-h-[64px] px-8 py-6"
                        data-testid="help-question"
                    />
                </label>
                <Button
                    size="compact"
                    onClick={() => void copyPrompt()}
                    data-testid="help-copy-prompt"
                >
                    {copy === "copied" ? (
                        <CheckIcon size={16} aria-hidden />
                    ) : (
                        <CopyIcon size={16} aria-hidden />
                    )}
                    {copy === "copied"
                        ? t("help.ai.copied")
                        : t("help.ai.copy")}
                </Button>
                <p aria-live="polite" className="sr-only">
                    {copy === "copied" ? t("help.ai.copied") : ""}
                </p>
                {copy === "failed" && (
                    <label className="text-sub text-text flex flex-col gap-4">
                        {t("help.ai.copyFailed")}
                        <TextArea
                            readOnly
                            value={prompt}
                            onFocus={(e) => e.currentTarget.select()}
                            className="min-h-[120px] px-8 py-6 font-mono"
                        />
                    </label>
                )}
            </section>
        </div>
    );
}
