import { useLayoutEffect, type ReactNode } from "react";
import { act, render, renderHook } from "@testing-library/react";
import {
    QueryClient,
    QueryClientProvider,
    useQuery,
} from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type Marcher from "@/global/classes/Marcher";
import { allMarcherRowsQueryOptions } from "@/hooks/queries/useMarchers";
import {
    SelectedMarchersProvider,
    useSelectedMarchers,
} from "@/context/SelectedMarchersContext";

vi.mock("@/hooks/useMarcherAppearanceSteps", () => ({
    useMarcherAppearanceSteps: () => undefined,
}));

const marcher = (id: number) => ({ id }) as Marcher;
const rowsKey = allMarcherRowsQueryOptions().queryKey;

function setup(rows: Marcher[]) {
    const queryClient = new QueryClient();
    queryClient.setQueryData(rowsKey, rows);
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <SelectedMarchersProvider>{children}</SelectedMarchersProvider>
        </QueryClientProvider>
    );
    return { queryClient, wrapper };
}

/** Gives the marcher rows query new data, and waits for its observers to hear of it */
async function refreshRows(queryClient: QueryClient, rows: Marcher[]) {
    await act(async () => {
        queryClient.setQueryData(rowsKey, rows);
        // The query's observers are told on a timer
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

const ids = (marchers: readonly Marcher[] | undefined) =>
    marchers?.map((m) => m.id);

describe("SelectedMarchersContext", () => {
    it("drops a marcher deleted from the show from the selection", async () => {
        const { queryClient, wrapper } = setup([1, 2, 3].map(marcher));
        const { result } = renderHook(() => useSelectedMarchers(), {
            wrapper,
        });
        void act(() =>
            result.current!.setSelectedMarchers([1, 2].map(marcher)),
        );

        await refreshRows(queryClient, [1, 3].map(marcher));

        expect(ids(result.current!.selectedMarchers)).toEqual([1]);
    });

    it("keeps a selection made while the marcher list refreshes", async () => {
        // A selection set after the render that saw the new list, before its effects ran (a
        // marquee released then): a layout effect lands in that same gap
        const { queryClient, wrapper } = setup([1, 2, 3].map(marcher));
        let latest: Marcher[] = [];
        function SelectsOnRefresh() {
            const { data } = useQuery(allMarcherRowsQueryOptions());
            const context = useSelectedMarchers()!;
            latest = context.selectedMarchers;
            useLayoutEffect(() => {
                if (data?.length === 4)
                    context.setSelectedMarchers([2, 3].map(marcher));
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [data]);
            return null;
        }
        render(<SelectsOnRefresh />, { wrapper });
        expect(latest).toEqual([]);

        await refreshRows(queryClient, [1, 2, 3, 4].map(marcher));

        expect(ids(latest)).toEqual([2, 3]);
    });
});
