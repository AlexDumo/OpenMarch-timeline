import { useState } from "react";
import { T, useTolgee } from "@tolgee/react";
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

/** The first page: a photo, the logo and "Welcome" in each language. */
export default function WelcomeStep() {
    const tolgee = useTolgee(["language"]);
    const [imageFailed, setImageFailed] = useState(false);
    const startIndex = Math.max(
        0,
        APP_LANGUAGES.findIndex((l) => l.code === tolgee.getLanguage()),
    );

    return (
        <div className="flex flex-col items-center gap-20 text-center">
            {/* Bleeds to the dialog's edges, over its padding. */}
            <div className="bg-fg-2 rounded-t-6 relative -mx-20 -mt-20 h-[15rem] self-stretch overflow-hidden">
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

            <div className="flex flex-col items-center gap-8 px-16">
                <OpenMarchLogo height={40} className="text-text mb-4" />
                <CyclingGreeting
                    greetings={GREETINGS}
                    startIndex={startIndex}
                    className="text-h2 text-text leading-tight font-medium"
                />
                <p className="text-body text-text-subtitle max-w-[30rem]">
                    <T keyName="welcomeFlow.welcome.description" />
                </p>
            </div>
        </div>
    );
}
