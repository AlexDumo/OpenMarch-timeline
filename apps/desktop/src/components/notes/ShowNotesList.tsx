/**
 * The show's notes list and an item's note readout (C2.6, ADR 0002 D-22): quiet, never a modal
 * or a block. Each note names its item and count, and offers its one-click fix when it has one.
 *
 * Cross-phase note for C3.3: the list belongs in Visuals mode, which isn't on this branch; mount
 * `ShowNotesList` there, and `ItemNotes` on the Items tab beside an item. The 3D View's note count
 * for the moment viewed is `notesAt(notes, beat).length`.
 */
import { useMutation } from "@tanstack/react-query";
import { useTolgee } from "@tolgee/react";
import { Button } from "@openmarch/ui";
import { InfoIcon } from "@phosphor-icons/react";
import {
    noteCountAt,
    notesForItem,
    type NotePage,
    type ShowNote,
} from "@/notes/showNotes";
import {
    snapItemToHolderMutationOptions,
    useShowNotes,
} from "@/hooks/useShowNotes";

export interface NotesViewProps {
    notes: readonly ShowNote[];
    pages: readonly NotePage[];
    itemName: (itemId: number) => string;
    marcherName: (marcherId: number) => string;
    /** Snap to holder, for a put-down drift note */
    onSnap: (placementId: number) => void;
    /** A fix in flight: its button waits */
    snapping?: number | null;
}

type Translate = ReturnType<typeof useTolgee>["t"];

/** A note's line and its detail, in the designer's words. */
export function noteText(
    t: Translate,
    note: ShowNote,
    { pages, itemName, marcherName }: Omit<NotesViewProps, "notes" | "onSnap">,
): { text: string; detail?: string } {
    const at = noteCountAt(pages, note.beat);
    const where =
        at.count === 0
            ? t("notes.whereStart")
            : at.after
              ? t("notes.whereAfter", { count: at.count, page: at.page })
              : t("notes.where", { count: at.count, page: at.page });
    const item = itemName(note.itemId);
    const who = note.marcherIds.map(marcherName).join(", ");
    switch (note.kind) {
        case "hand_conflict":
            return {
                text: t("notes.handConflict", { item, where }),
                detail: t("notes.handConflictDetail", {
                    other: itemName(note.otherItemId ?? -1),
                    who,
                }),
            };
        case "put_down_drift":
            return {
                text: t("notes.putDownDrift", { item, where }),
                detail: t("notes.putDownDriftDetail", { who }),
            };
        case "crew_distance":
            return {
                text: t("notes.crewDistance", { item, where }),
                detail: t("notes.crewDistanceDetail", { who }),
            };
        case "crewless_move":
            return { text: t("notes.crewlessMove", { item, where }) };
    }
}

function NoteRow({
    note,
    ...props
}: { note: ShowNote } & Omit<NotesViewProps, "notes">) {
    const { t } = useTolgee();
    const { text, detail } = noteText(t, note, props);
    const action = note.action;
    return (
        <li
            className="flex items-start justify-between gap-8 py-4"
            data-testid="show-note"
            data-note-kind={note.kind}
        >
            <div className="flex min-w-0 items-start gap-6">
                <InfoIcon
                    size={16}
                    className="text-text-subtitle mt-2 shrink-0"
                    aria-hidden
                />
                <div className="flex min-w-0 flex-col">
                    <span className="text-body text-text">{text}</span>
                    {detail && (
                        <span className="text-sub text-text-subtitle">
                            {detail}
                        </span>
                    )}
                </div>
            </div>
            {action?.kind === "snap_to_holder" && (
                <Button
                    type="button"
                    size="compact"
                    variant="secondary"
                    className="shrink-0"
                    disabled={props.snapping === action.placementId}
                    onClick={() => props.onSnap(action.placementId)}
                >
                    {t("notes.snapToHolder")}
                </Button>
            )}
        </li>
    );
}

/** The show-wide list, from data the caller passes. */
export function ShowNotesListView({ notes, ...props }: NotesViewProps) {
    const { t } = useTolgee();
    return (
        <section
            className="flex flex-col gap-4"
            aria-label={t("notes.title")}
            data-testid="show-notes"
        >
            <header className="text-text-subtitle text-sub flex justify-between">
                <span>{t("notes.title")}</span>
                <span>{t("notes.count", { count: notes.length })}</span>
            </header>
            {notes.length === 0 ? (
                <p className="text-sub text-text-subtitle">
                    {t("notes.empty")}
                </p>
            ) : (
                <ul className="flex flex-col">
                    {notes.map((note) => (
                        <NoteRow key={note.id} note={note} {...props} />
                    ))}
                </ul>
            )}
        </section>
    );
}

/** One item's notes, for its readout; nothing when it has none. */
export function ItemNotesView({
    itemId,
    notes,
    ...props
}: NotesViewProps & { itemId: number }) {
    const own = notesForItem(notes, itemId);
    if (own.length === 0) return null;
    return (
        <ul className="flex flex-col" data-testid="item-notes">
            {own.map((note) => (
                <NoteRow key={note.id} note={note} {...props} />
            ))}
        </ul>
    );
}

const useSnap = () => useMutation(snapItemToHolderMutationOptions());

/** The show's notes list, live. */
export default function ShowNotesList() {
    const { notes, pages, itemName, marcherName } = useShowNotes();
    const snap = useSnap();
    return (
        <ShowNotesListView
            notes={notes}
            pages={pages}
            itemName={itemName}
            marcherName={marcherName}
            onSnap={(id) => snap.mutate(id)}
            snapping={snap.isPending ? (snap.variables ?? null) : null}
        />
    );
}

/** An item's notes, live. */
export function ItemNotes({ itemId }: { itemId: number }) {
    const { notes, pages, itemName, marcherName } = useShowNotes();
    const snap = useSnap();
    return (
        <ItemNotesView
            itemId={itemId}
            notes={notes}
            pages={pages}
            itemName={itemName}
            marcherName={marcherName}
            onSnap={(id) => snap.mutate(id)}
            snapping={snap.isPending ? (snap.variables ?? null) : null}
        />
    );
}
