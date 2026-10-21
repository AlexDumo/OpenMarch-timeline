import clsx from "clsx";
import { useEffect } from "react";
import { ShapesIcon, StarIcon, XIcon } from "@phosphor-icons/react";
import { SidebarModalLauncher } from "@/components/sidebar/SidebarModal";
import { useSidebarModalStore } from "@/stores/SidebarModalStore";
import { MAX_STARS, type ShapeLibraryRow } from "./shapeLibrary";
import { useShapeLibraryRows, useShapeStarsStore } from "./shapeStars";

export const SHAPE_LIBRARY_CONTENT_ID = "shapes";

/** The left sidebar's Shapes entry (#352, spec #344): the shape library */
export default function ShapeLibraryModal() {
    return (
        <SidebarModalLauncher
            contents={<ShapeLibraryContents />}
            newContentId={SHAPE_LIBRARY_CONTENT_ID}
            buttonLabel={<ShapesIcon size={24} />}
            ariaLabel="Shapes"
            testId="shape-library-tab"
        />
    );
}

/** Opens the sidebar on the shape library, as the Shapes tab's Library button does */
export function showShapeLibrary() {
    const sidebar = useSidebarModalStore.getState();
    if (sidebar.contentId !== SHAPE_LIBRARY_CONTENT_ID)
        sidebar.setContent(<ShapeLibraryContents />, SHAPE_LIBRARY_CONTENT_ID);
    sidebar.setOpen(true);
}

/**
 * The shape library: every shape by group, each with a star, an icon, a name and a note. One star
 * puts a shape in both the ring and the Shapes tab; with all {@link MAX_STARS} taken, starring
 * another asks to unstar one first. Saved shapes (#353) come as a Saved group after Basic.
 */
export function ShapeLibraryContents({
    rows: rowsProp,
}: {
    /** Tests pass their own; every shape the library lists by default */
    rows?: readonly ShapeLibraryRow[];
}) {
    const { setOpen } = useSidebarModalStore();
    const libraryRows = useShapeLibraryRows();
    const rows = rowsProp ?? libraryRows;
    const stars = useShapeStarsStore((s) => s.stars);
    const asking = useShapeStarsStore((s) => s.asking);
    const toggle = useShapeStarsStore((s) => s.toggle);
    const dismissAsk = useShapeStarsStore((s) => s.dismissAsk);
    const asked = rows.find((r) => r.id === asking);
    // The question is about this visit to the library
    useEffect(() => dismissAsk, [dismissAsk]);

    const groups = [
        { id: "basic", title: "Basic" },
        { id: "saved", title: "Saved" },
    ] as const;

    return (
        <div
            className="animate-scale-in text-text flex h-full w-[22rem] flex-col gap-16"
            data-testid="shape-library"
        >
            <header className="flex items-center justify-between gap-24">
                <h4 className="text-h4 leading-none">Shapes</h4>
                <button
                    onClick={() => setOpen(false)}
                    className="hover:text-red duration-150 ease-out"
                    aria-label="Close"
                >
                    <XIcon size={24} />
                </button>
            </header>
            <p className="text-sub text-text-subtitle">
                Star a shape to keep it in the Shapes tab and the shape ring, up
                to {MAX_STARS}.
            </p>
            {asked && (
                <div
                    role="alert"
                    className="rounded-6 border-stroke bg-fg-2 text-body flex items-start justify-between gap-8 border p-8"
                    data-testid="shape-library-full"
                >
                    <span>
                        {MAX_STARS} shapes are starred, as many as the ring
                        holds. Unstar one first to star {asked.label}.
                    </span>
                    <button
                        onClick={dismissAsk}
                        className="hover:text-red duration-150 ease-out"
                        aria-label="Dismiss"
                    >
                        <XIcon size={16} />
                    </button>
                </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col gap-16 overflow-y-auto">
                {groups.map(({ id, title }) => {
                    const inGroup = rows.filter((r) => r.group === id);
                    if (inGroup.length === 0) return null;
                    return (
                        <section
                            key={id}
                            className="flex flex-col gap-8"
                            data-testid={`shape-library-${id}`}
                        >
                            <h5 className="text-sub text-text-subtitle font-mono uppercase">
                                {title}
                            </h5>
                            <ul className="flex flex-col gap-4">
                                {inGroup.map((row) => (
                                    <LibraryRow
                                        key={row.id}
                                        row={row}
                                        starred={stars.includes(row.id)}
                                        onStar={() => toggle(row.id, rows)}
                                    />
                                ))}
                            </ul>
                        </section>
                    );
                })}
            </div>
        </div>
    );
}

function LibraryRow({
    row,
    starred,
    onStar,
}: {
    row: ShapeLibraryRow;
    starred: boolean;
    onStar: () => void;
}) {
    const Icon = row.icon;
    return (
        <li
            className="rounded-6 hover:bg-fg-2 flex items-center gap-8 px-4 py-4"
            data-testid={`shape-library-row-${row.id}`}
        >
            <button
                type="button"
                onClick={onStar}
                aria-pressed={starred}
                aria-label={`${starred ? "Unstar" : "Star"} ${row.label}`}
                title={starred ? "Unstar" : "Star"}
                className={clsx(
                    "hover:text-accent duration-150 ease-out",
                    starred ? "text-accent" : "text-text-subtitle",
                )}
                data-testid={`shape-library-star-${row.id}`}
            >
                <StarIcon size={18} weight={starred ? "fill" : "regular"} />
            </button>
            <Icon size={22} />
            <span className="text-body">{row.label}</span>
            {row.note && (
                <span className="text-sub text-text-subtitle">{row.note}</span>
            )}
        </li>
    );
}
