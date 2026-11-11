import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import type { FieldProperties } from "@openmarch/core";
import {
    applyFieldEditsMutationOptions,
    fieldPropertiesQueryOptions,
} from "@/hooks/queries";
import { useDatabaseReady } from "@/hooks/useDatabaseReady";
import type { FieldEditRequest, FieldEditResult } from "@/field/edits";
import { fieldEditIssueMessage } from "@/field/edits/messages";

/**
 * Applies field edits as one undo step (`applyFieldEdits`), and says why in a toast when they're
 * refused. Every change the Edit field mode makes goes through here (#824).
 */
export function useApplyFieldEdits(): (
    edits: FieldEditRequest | readonly FieldEditRequest[],
) => Promise<FieldEditResult | null> {
    const { t } = useTranslate();
    const queryClient = useQueryClient();
    const { mutateAsync } = useMutation(
        applyFieldEditsMutationOptions(queryClient),
    );
    return useCallback(
        async (edits) => {
            if (Array.isArray(edits) && edits.length === 0) return null;
            try {
                const result = await mutateAsync(edits);
                const issue = result.diff.errors[0];
                if (issue) toast.error(fieldEditIssueMessage(issue, t));
                return result;
            } catch (error) {
                console.error("Field edit failed", error);
                toast.error(t("fieldEdits.issues.invalid"));
                return null;
            }
        },
        [mutateAsync, t],
    );
}

/** The field as stored, for the mode's handlers and components */
export function useFieldProperties(): FieldProperties | undefined {
    const databaseReady = useDatabaseReady();
    return useQuery(fieldPropertiesQueryOptions(databaseReady)).data;
}
