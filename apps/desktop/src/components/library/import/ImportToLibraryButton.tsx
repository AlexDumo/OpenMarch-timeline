/**
 * "Import to Library…" in the File tab (package C1.10), beside the Artwork
 * templates menu. It opens the file dialog and, once files are picked, the
 * temporary full-window review host.
 *
 * TODO(Visuals mode): the Library side panel's Import… replaces this button
 * when Visuals mode exists (props-spec.md §12); see `ImportReviewHost`.
 */
import { useEffect, useState } from "react";
import { TrayArrowDownIcon } from "@phosphor-icons/react";
import { T } from "@tolgee/react";
import { createImportClient } from "@/view3d/library/importClient";
import {
    createImportReview,
    type ImportReviewClient,
    type ImportReviewStore,
} from "./importReview";
import ImportReviewHost from "./ImportReviewHost";

let editorClient: ImportReviewClient | undefined;
function defaultClient(): ImportReviewClient {
    editorClient ??= createImportClient();
    return editorClient;
}

export default function ImportToLibraryButton({
    client,
}: {
    /** Defaults to the editor's import client. */
    client?: ImportReviewClient;
}) {
    const [store, setStore] = useState<ImportReviewStore | null>(null);

    // Closing the editor tab or unmounting ends the session.
    useEffect(() => () => store?.getState().close(), [store]);

    const open = () => {
        if (store) return;
        const review = createImportReview(client ?? defaultClient(), {
            onClose: () => setStore(null),
        });
        setStore(review);
        void review.getState().pick("any");
    };

    return (
        <>
            <button
                type="button"
                onClick={open}
                disabled={store !== null}
                data-testid="import-to-library"
                className="hover:text-accent flex items-center gap-8 outline-hidden duration-150 ease-out focus-visible:-translate-y-4 disabled:opacity-50"
            >
                <TrayArrowDownIcon size={24} />
                <T keyName="library.import.entry" />
            </button>
            {store && <ImportReviewHost store={store} />}
        </>
    );
}
