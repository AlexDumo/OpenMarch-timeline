import { RadioGroup, RadioGroupItem, WarningNote } from "@openmarch/ui";
import { T, useTolgee } from "@tolgee/react";
import { clsx } from "clsx";
import type { ReimportTiming } from "@/timeline/tempo/reimport";
import type { ReimportLine } from "./musicXmlReimportPreview";

/** What the preview needs for an in-place re-import (Tempo lab `reimportInPlace`, E12). */
export interface MusicXmlReimportState {
    mode: "reimport" | "replace";
    lines: ReimportLine[];
    /** Whether updating in place would change anything with the chosen timing */
    changes: boolean;
    synced: { total: number; moved: number };
    timing: ReimportTiming;
    onTimingChange: (timing: ReimportTiming) => void;
    updating: boolean;
    onUpdate: () => void;
    onReplaceEverything: () => void;
    onBack: () => void;
}

/**
 * The "Re-import" part of the MusicXML preview: what updating the show in place changes, and,
 * when the show is lined up with the recording, whether to keep that alignment.
 */
export default function MusicXmlReimportSection({
    reimport,
}: {
    reimport: MusicXmlReimportState;
}) {
    const { t } = useTolgee();
    const { lines, synced, timing } = reimport;
    const hasDiffering = lines.some((l) => l.warning);

    return (
        <section
            className="flex flex-col gap-8"
            data-testid="musicxml-reimport"
            aria-labelledby="musicxml-reimport-heading"
        >
            <h3
                id="musicxml-reimport-heading"
                className="text-body text-text font-medium"
            >
                <T keyName="music.xmlPreview.reimport.heading" />
            </h3>

            {synced.total > 0 && (
                <WarningNote>
                    <div className="flex flex-col gap-8">
                        <span data-testid="musicxml-reimport-synced">
                            <T
                                keyName="music.xmlPreview.reimport.syncedWarning"
                                params={{
                                    count: synced.total,
                                    moved: synced.moved,
                                }}
                            />
                        </span>
                        <RadioGroup
                            aria-label={t(
                                "music.xmlPreview.reimport.syncedWarning",
                                { count: synced.total, moved: synced.moved },
                            )}
                            value={timing}
                            onValueChange={(next) =>
                                reimport.onTimingChange(next as ReimportTiming)
                            }
                        >
                            <RadioGroupItem
                                value="keep"
                                data-testid="musicxml-reimport-keep"
                            >
                                <span className="text-sub">
                                    <T keyName="music.xmlPreview.reimport.keepAlignment" />
                                </span>
                            </RadioGroupItem>
                            <RadioGroupItem
                                value="score"
                                data-testid="musicxml-reimport-score"
                            >
                                <span className="text-sub">
                                    <T keyName="music.xmlPreview.reimport.useScoreTiming" />
                                </span>
                            </RadioGroupItem>
                        </RadioGroup>
                    </div>
                </WarningNote>
            )}

            <ul
                className="text-sub rounded-6 border-stroke flex max-h-[12rem] flex-col overflow-y-auto border"
                data-testid="musicxml-reimport-lines"
            >
                {lines.map((line, i) => (
                    <li
                        key={`${line.key}${i}`}
                        data-warning={line.warning || undefined}
                        className={clsx(
                            "border-stroke px-8 py-4",
                            i > 0 && "border-t",
                            line.warning
                                ? "bg-yellow/12 text-text"
                                : "text-text/80",
                        )}
                    >
                        <T
                            keyName={`music.xmlPreview.reimport.${line.key}`}
                            params={line.params}
                        />
                    </li>
                ))}
                {!reimport.changes && (
                    <li className="text-text/60 px-8 py-4">
                        <T keyName="music.xmlPreview.reimport.nothing" />
                    </li>
                )}
            </ul>
            {hasDiffering && (
                <p className="text-sub text-text-subtitle">
                    <T keyName="music.xmlPreview.reimport.differHint" />
                </p>
            )}
        </section>
    );
}
