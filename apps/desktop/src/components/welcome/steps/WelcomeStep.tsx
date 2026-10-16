import { useState } from "react";
import { T, useTolgee } from "@tolgee/react";
import { Button } from "@openmarch/ui";
import { ArrowRightIcon } from "@phosphor-icons/react";
import OpenMarchLogo from "@/components/OpenMarchLogo";
import { APP_LANGUAGES } from "@/utilities/languages";
import CyclingGreeting from "../CyclingGreeting";

/** The team at a booth; hosted, so a missing connection just hides it. */
export const WELCOME_IMAGE_URL =
    "https://assets.openmarch.com/desktop/launch-image.webp";

const GREETINGS = APP_LANGUAGES.map((language) => ({
    key: language.code,
    text: language.greeting,
    lang: language.code,
}));

/**
 * The first page: the photo on one side; the logo, "Welcome" in each language
 * and Get started on the other. Narrow windows stack them.
 */
export default function WelcomeStep({
    onStart,
    "aria-label": ariaLabel,
}: {
    onStart: () => void;
    "aria-label"?: string;
}) {
    const tolgee = useTolgee(["language"]);
    const [imageFailed, setImageFailed] = useState(false);
    const startIndex = Math.max(
        0,
        APP_LANGUAGES.findIndex((l) => l.code === tolgee.getLanguage()),
    );

    return (
        <main
            className="flex min-h-0 flex-1 flex-col gap-8 p-8 md:flex-row"
            aria-label={ariaLabel}
            data-testid="welcome-flow"
        >
            <div className="bg-fg-2 border-stroke rounded-6 relative h-[30vh] shrink-0 overflow-hidden border md:h-auto md:flex-[1.15]">
                {!imageFailed && (
                    <img
                        src={WELCOME_IMAGE_URL}
                        alt=""
                        draggable={false}
                        onError={() => setImageFailed(true)}
                        className="animate-fade-in h-full w-full object-cover object-[50%_35%]"
                    />
                )}
            </div>

            <div className="bg-fg-1 border-stroke rounded-6 flex min-h-0 flex-1 flex-col overflow-y-auto border px-32 py-32">
                <div className="m-auto flex max-w-[28rem] flex-col items-center gap-24 text-center">
                    <OpenMarchLogo height={64} className="text-text" />
                    {/* The greeting changes language, so the heading is for screen readers. */}
                    <h1 className="sr-only">
                        <T keyName="welcomeFlow.welcome.title" />
                    </h1>
                    <CyclingGreeting
                        greetings={GREETINGS}
                        startIndex={startIndex}
                        className="text-h1 text-text leading-tight font-medium"
                    />
                    <p className="text-body text-text-subtitle">
                        <T keyName="welcomeFlow.welcome.description" />
                    </p>
                    <Button
                        size="default"
                        onClick={onStart}
                        className="mt-8 gap-8 px-24"
                        data-testid="welcome-continue"
                        autoFocus
                    >
                        <T keyName="welcomeFlow.getStarted" />
                        <ArrowRightIcon size={18} />
                    </Button>
                </div>
            </div>
        </main>
    );
}
