import { useState, useSyncExternalStore } from "react";
import { PlusIcon } from "@phosphor-icons/react";
import { T, useTranslate } from "@tolgee/react";
import { AddFlag } from "@/components/assets/AddFlag";
import { FlagPicture } from "@/components/assets/FlagPicture";
import { useShowFlags } from "@/hooks/queries/useShowFlags";
import {
    actionDisabledReason,
    isActionEnabled,
    runAction,
    subscribeToActionHandlers,
} from "@/shortcuts/registry";
import type { ShowFlag } from "@/showAssets/flags";

const TILE_CLASS =
    "rounded-6 hover:border-accent/60 focus-visible:outline-accent flex min-w-0 flex-col gap-4 border border-transparent p-2 text-left outline-hidden duration-150 ease-out focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-transparent";

/**
 * The Props panel's Flags group (fork #985): the show's flags, each a rectangular silk with its own
 * painted design, and Add flag… Picking a flag hands it to the selected performers from the
 * playhead, an Equipment cue as Guard equipment in the field's right-click menu is; greyed out, it
 * says why. As many flags as the show uses.
 */
export default function ShowFlags({
    adding: addingAtFirst = false,
}: {
    /** Opens Add flag at once (the `addFlag` action) */
    adding?: boolean;
}) {
    const { t } = useTranslate();
    const flags = useShowFlags();
    const [adding, setAdding] = useState(addingAtFirst);
    // Handing out follows the Equipment commands: a selection, paused
    const canGive = useSyncExternalStore(subscribeToActionHandlers, () =>
        isActionEnabled("equipmentShowFlag"),
    );
    const whyNot = useSyncExternalStore(subscribeToActionHandlers, () =>
        actionDisabledReason("equipmentShowFlag"),
    );
    return (
        <section
            className="flex flex-col gap-12"
            aria-label={t("props.flags.title")}
            data-testid="show-flags"
        >
            <h5 className="text-text/70 text-body font-medium">
                <T keyName="props.flags.title" />
            </h5>
            {adding ? (
                <AddFlag onDone={() => setAdding(false)} />
            ) : (
                <>
                    <div className="grid grid-cols-4 gap-6">
                        <button
                            type="button"
                            onClick={() => setAdding(true)}
                            className={TILE_CLASS}
                            data-testid="show-flags-add"
                        >
                            <span className="rounded-4 bg-fg-2 border-stroke text-text-subtitle flex aspect-[4/3] items-center justify-center border border-dashed">
                                <PlusIcon size={24} />
                            </span>
                            <span className="text-sub text-text min-w-0 truncate px-2 leading-tight font-medium">
                                <T keyName="props.flags.add" />
                            </span>
                        </button>
                        {flags.map((flag) => (
                            <FlagTile
                                key={flag.value}
                                flag={flag}
                                disabledReason={canGive ? undefined : whyNot}
                            />
                        ))}
                    </div>
                    <p className="text-sub text-text-subtitle">
                        <T
                            keyName={
                                flags.length === 0
                                    ? "props.flags.empty"
                                    : "props.flags.hint"
                            }
                        />
                    </p>
                </>
            )}
        </section>
    );
}

function FlagTile({
    flag,
    disabledReason,
}: {
    flag: ShowFlag;
    /** Why it can't be handed out now, or undefined when it can */
    disabledReason: string | undefined;
}) {
    const { t } = useTranslate();
    const label = t("props.flags.give", { name: flag.name });
    return (
        <button
            type="button"
            disabled={disabledReason !== undefined}
            onClick={() =>
                runAction("equipmentShowFlag", { value: flag.value })
            }
            title={disabledReason ?? label}
            aria-label={label}
            className={TILE_CLASS}
            data-testid="show-flag"
            data-value={flag.value}
        >
            <span className="rounded-4 bg-fg-2 border-stroke flex aspect-[4/3] items-center justify-center overflow-hidden border">
                <FlagPicture hash={flag.thumbnail} className="h-full w-full" />
            </span>
            <span className="text-sub text-text min-w-0 truncate px-2 leading-tight font-medium">
                {flag.name}
            </span>
        </button>
    );
}
