import clsx from "clsx";
import { useState } from "react";
import { StarIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { saveShape, type SavableShape } from "./saveShape";
import { suggestedName } from "./savedShapes";

/**
 * ☆ Save (#353, spec #344 story 26–27): in the chip's ⋯ row and at the bottom of the inspector's
 * shape section. It asks for a name in place, offering the kind and its spacing, then keeps the
 * shape's kind and intervals in the user's library and the show, starred.
 */
export function SaveShapeButton({
    shape,
    stepPx,
    className,
    testId = "save-shape",
}: {
    shape: SavableShape;
    stepPx: number;
    /** The button's look where it sits */
    className?: string;
    testId?: string;
}) {
    const queryClient = useQueryClient();
    const [name, setName] = useState<string | null>(null);
    const [saved, setSaved] = useState<string | null>(null);

    if (name === null)
        return (
            <button
                type="button"
                title="Save this shape to your library, starred"
                aria-label="Save this shape to your library"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                    setSaved(null);
                    setName(
                        suggestedName(
                            shape.kind,
                            shape.params,
                            shape.spots,
                            stepPx,
                        ),
                    );
                }}
                className={clsx("flex items-center gap-4", className)}
                data-testid={testId}
            >
                <StarIcon size={14} />
                {saved ? `Saved as ${saved}` : "Save"}
            </button>
        );

    const finish = async () => {
        const trimmed = name.trim();
        if (trimmed === "") return;
        setName(null);
        const done = await saveShape(shape, trimmed, stepPx, queryClient);
        setSaved(done.name);
    };
    return (
        <form
            className="flex items-center gap-4"
            onSubmit={(e) => {
                e.preventDefault();
                void finish();
            }}
            data-testid={`${testId}-form`}
        >
            <input
                autoFocus
                aria-label="Name of the saved shape"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                    // Enter and Escape answer the name, not the shape: Escape keeps it open
                    e.stopPropagation();
                    if (e.key === "Escape") setName(null);
                }}
                className="rounded-4 border-stroke bg-fg-1 text-body text-text w-[12rem] border px-4 py-1"
                data-testid={`${testId}-name`}
            />
            <button
                type="submit"
                disabled={name.trim() === ""}
                className="bg-accent text-text-invert rounded-4 px-8 py-1 font-medium hover:opacity-90 disabled:opacity-50"
                data-testid={`${testId}-confirm`}
            >
                Save
            </button>
            <button
                type="button"
                onClick={() => setName(null)}
                className="rounded-4 hover:bg-fg-2 px-4 py-1"
            >
                Cancel
            </button>
        </form>
    );
}
