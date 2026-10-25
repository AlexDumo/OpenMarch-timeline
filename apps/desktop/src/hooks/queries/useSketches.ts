import { useEffect } from "react";
import {
    queryOptions,
    useQuery,
    useQueryClient,
    type QueryClient,
} from "@tanstack/react-query";
import type {
    SketchListItem,
    SketchTemplateListItem,
} from "@/sketchpad/protocol";

/**
 * The show's sketches and templates (ADR 0006), read through main's `sketch:*` channels: the
 * Sketchpad window writes them there, outside the editor's database proxy. Main sends
 * `sketch:changed` after every write, which invalidates these keys (`useSketchChanges`).
 */
export const sketchKeys = {
    all: () => ["sketches"] as const,
    list: () => ["sketches", "list"] as const,
    templates: () => ["sketches", "templates"] as const,
};

export const sketchesQueryOptions = () =>
    queryOptions<SketchListItem[]>({
        queryKey: sketchKeys.list(),
        queryFn: () => window.electron.sketches.list(),
    });

export const sketchTemplatesQueryOptions = () =>
    queryOptions<SketchTemplateListItem[]>({
        queryKey: sketchKeys.templates(),
        queryFn: () => window.electron.sketches.templates(),
    });

export const useSketches = () => useQuery(sketchesQueryOptions());
export const useSketchTemplates = () => useQuery(sketchTemplatesQueryOptions());

export const invalidateSketches = (qc: QueryClient) =>
    qc.invalidateQueries({ queryKey: sketchKeys.all() });

/** Refreshes the sketch queries whenever main says a sketch or template changed */
export function useSketchChanges() {
    const qc = useQueryClient();
    useEffect(
        () =>
            window.electron?.sketches?.onChanged(
                () => void invalidateSketches(qc),
            ),
        [qc],
    );
}
