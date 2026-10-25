import { useEffect, useRef, useState } from "react";
import {
    Checkbox,
    Select,
    SelectContent,
    SelectItem,
    SelectTriggerButton,
    Input,
    WarningNote,
} from "@openmarch/ui";
import { WizardFormField } from "@/components/ui/FormField";
import { T, useTolgee } from "@tolgee/react";
import MusicXmlSelector from "@/components/music/MusicXmlSelector";
import { useQuery } from "@tanstack/react-query";
import { allDatabaseMeasuresQueryOptions } from "@/hooks/queries/useMeasures";
import { useTempoLabFlag } from "@/stores/UiSettingsStore";
import type {
    NewShowTempoData,
    TempoOnlyTimeSignature,
} from "../../newShowTypes";
import {
    DEFAULT_TEMPO_ONLY_TIME_SIGNATURE,
    TEMPO_ONLY_TIME_SIGNATURES,
} from "../../newShowTypes";

const TEMPO_MIN = 1;
const TEMPO_MAX = 300;
const DEFAULT_TEMPO = 120;

function clampTempo(value: number): number {
    return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, value));
}

function parseTempoInput(raw: string): number | null {
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) return null;
    return clampTempo(parsed);
}

interface TempoStepProps {
    tempo: NewShowTempoData | null;
    onChange: (tempo: NewShowTempoData) => void;
    /** The show has music: the tempo becomes optional ("I don't know: I'll tap it") */
    hasAudio?: boolean;
}

export default function TempoStep({
    tempo,
    onChange,
    hasAudio = false,
}: TempoStepProps) {
    const { t } = useTolgee();
    const [databaseReady, setDatabaseReady] = useState(false);
    const [checkingDatabase, setCheckingDatabase] = useState(true);
    const { data: measures } = useQuery({
        ...allDatabaseMeasuresQueryOptions(),
        enabled: databaseReady,
    });

    const [method, setMethod] = useState<NewShowTempoData["method"]>(
        tempo?.method ?? "tempo_only",
    );
    const [tempoInput, setTempoInput] = useState(
        String(tempo?.tempo ?? DEFAULT_TEMPO),
    );
    const [timeSignature, setTimeSignature] = useState<TempoOnlyTimeSignature>(
        tempo?.timeSignature ?? DEFAULT_TEMPO_ONLY_TIME_SIGNATURE,
    );
    // Offered only where Tap the beat exists to follow it up (Tempo lab `tapTheBeat`)
    const canTapLater = useTempoLabFlag("tapTheBeat") && hasAudio;
    const [tapLater, setTapLater] = useState(
        canTapLater && (tempo?.tapLater ?? false),
    );
    const tapLaterRef = useRef(tapLater);
    tapLaterRef.current = tapLater;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const hasSyncedInitial = useRef(tempo !== null);

    const getCommittedTempo = () =>
        parseTempoInput(tempoInput) ?? DEFAULT_TEMPO;

    const emitTempo = (
        nextMethod: NewShowTempoData["method"],
        nextTempo?: number,
        nextTimeSignature?: TempoOnlyTimeSignature,
    ) => {
        onChangeRef.current({
            method: nextMethod,
            tempo:
                nextMethod === "tempo_only"
                    ? (nextTempo ?? getCommittedTempo())
                    : undefined,
            timeSignature:
                nextMethod === "tempo_only"
                    ? (nextTimeSignature ?? timeSignature)
                    : undefined,
            ...(nextMethod === "tempo_only" && tapLaterRef.current
                ? { tapLater: true }
                : {}),
        });
    };

    useEffect(() => {
        if (hasSyncedInitial.current) return;
        hasSyncedInitial.current = true;
        emitTempo(method, getCommittedTempo(), timeSignature);
    }, []);

    useEffect(() => {
        let cancelled = false;
        const checkDatabase = async () => {
            setCheckingDatabase(true);
            for (let i = 0; i < 10; i++) {
                if (cancelled) return;
                if (await window.electron.databaseIsReady()) {
                    setDatabaseReady(true);
                    setCheckingDatabase(false);
                    return;
                }
                await new Promise((r) => setTimeout(r, 500));
            }
            setDatabaseReady(false);
            setCheckingDatabase(false);
        };
        void checkDatabase();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (
            method === "xml" &&
            measures &&
            Array.isArray(measures) &&
            measures.length > 0
        ) {
            onChangeRef.current({ method: "xml" });
        }
    }, [method, measures]);

    const getMethodLabel = () => {
        switch (method) {
            case "tempo_only":
                return t("launchpage.newShow.steps.tempo.tempoOnly");
            case "xml":
                return t("launchpage.newShow.steps.tempo.musicXml");
            case "skip":
                return t("launchpage.newShow.steps.tempo.skip");
        }
    };

    return (
        <div className="mx-auto flex w-full max-w-lg flex-col gap-16">
            <WizardFormField
                label={t("launchpage.newShow.steps.tempo.method")}
                helperText={t("launchpage.newShow.steps.tempo.methodHelper")}
            >
                <Select
                    value={method}
                    onValueChange={(v) => {
                        const nextMethod = v as NewShowTempoData["method"];
                        setMethod(nextMethod);
                        emitTempo(nextMethod);
                    }}
                >
                    <SelectTriggerButton label={getMethodLabel()} />
                    <SelectContent>
                        <SelectItem value="tempo_only">
                            <T keyName="launchpage.newShow.steps.tempo.tempoOnly" />
                        </SelectItem>
                        <SelectItem value="xml">
                            <T keyName="launchpage.newShow.steps.tempo.musicXml" />
                        </SelectItem>
                        <SelectItem value="skip">
                            <T keyName="launchpage.newShow.steps.tempo.skip" />
                        </SelectItem>
                    </SelectContent>
                </Select>
            </WizardFormField>

            {method === "tempo_only" && (
                <>
                    <WizardFormField
                        label={t(
                            "launchpage.newShow.steps.tempo.timeSignature",
                        )}
                        helperText={t(
                            "launchpage.newShow.steps.tempo.timeSignatureHelper",
                        )}
                    >
                        <Select
                            value={timeSignature}
                            onValueChange={(v) => {
                                const nextTimeSignature =
                                    v as TempoOnlyTimeSignature;
                                setTimeSignature(nextTimeSignature);
                                emitTempo(
                                    "tempo_only",
                                    getCommittedTempo(),
                                    nextTimeSignature,
                                );
                            }}
                        >
                            <SelectTriggerButton label={timeSignature} />
                            <SelectContent>
                                {TEMPO_ONLY_TIME_SIGNATURES.map((sig) => (
                                    <SelectItem key={sig} value={sig}>
                                        {sig}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </WizardFormField>
                    <WizardFormField
                        label={t(
                            hasAudio
                                ? "launchpage.newShow.steps.tempo.tempoOptional"
                                : "launchpage.newShow.tempo",
                        )}
                        helperText={
                            hasAudio
                                ? t(
                                      tapLater
                                          ? "launchpage.newShow.steps.tempo.tapLaterHelper"
                                          : "launchpage.newShow.steps.tempo.tempoOptionalHelper",
                                  )
                                : undefined
                        }
                    >
                        <Input
                            type="number"
                            disabled={tapLater}
                            value={tapLater ? "" : tempoInput}
                            placeholder={
                                tapLater ? String(DEFAULT_TEMPO) : undefined
                            }
                            onChange={(e) => {
                                const raw = e.target.value;
                                setTempoInput(raw);
                                const parsed = parseTempoInput(raw);
                                if (parsed !== null) {
                                    emitTempo(
                                        "tempo_only",
                                        parsed,
                                        timeSignature,
                                    );
                                }
                            }}
                            onBlur={() => {
                                const parsed = parseTempoInput(tempoInput);
                                if (parsed === null) {
                                    setTempoInput(String(DEFAULT_TEMPO));
                                    emitTempo(
                                        "tempo_only",
                                        DEFAULT_TEMPO,
                                        timeSignature,
                                    );
                                }
                            }}
                            min={TEMPO_MIN}
                            max={TEMPO_MAX}
                        />
                    </WizardFormField>
                    {canTapLater && (
                        <label className="text-body text-text flex items-center gap-8">
                            <Checkbox
                                data-testid="tempo-tap-later"
                                checked={tapLater}
                                onCheckedChange={(checked) => {
                                    const next = checked === true;
                                    setTapLater(next);
                                    tapLaterRef.current = next;
                                    emitTempo(
                                        "tempo_only",
                                        next
                                            ? DEFAULT_TEMPO
                                            : getCommittedTempo(),
                                        timeSignature,
                                    );
                                }}
                            />
                            {t("launchpage.newShow.steps.tempo.tapLater")}
                        </label>
                    )}
                </>
            )}

            {method === "xml" && (
                <div className="flex flex-col gap-8">
                    {checkingDatabase && (
                        <WarningNote>
                            <T keyName="launchpage.newShow.steps.tempo.waitingDb" />
                        </WarningNote>
                    )}
                    {!checkingDatabase && !databaseReady && (
                        <WarningNote>
                            <T keyName="launchpage.newShow.steps.tempo.dbNotReady" />
                        </WarningNote>
                    )}
                    {databaseReady && <MusicXmlSelector />}
                </div>
            )}

            {method === "skip" && (
                <p className="text-body text-text/70">
                    <T keyName="launchpage.newShow.steps.tempo.skipDescription" />
                </p>
            )}
        </div>
    );
}
