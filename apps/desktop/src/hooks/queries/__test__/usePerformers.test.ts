import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { dbMarcherToMarcher } from "@/global/classes/Marcher";

vi.mock("@/App", () => ({ queryClient: undefined }));

const { allMarchersQueryOptions, performersQueryOptions } =
    await import("../useMarchers");

const row = (id: number, type: "marcher" | "item", prefix: string) =>
    dbMarcherToMarcher({
        id,
        name: null,
        section: type === "item" ? "Prop" : "Trumpet",
        year: null,
        notes: null,
        drill_prefix: prefix,
        drill_order: id,
        created_at: "",
        updated_at: "",
        home_x: 0,
        home_y: 0,
        type,
    });

describe("performersQueryOptions", () => {
    it("reads the marchers query and leaves out items", () => {
        const qc = new QueryClient();
        const marchers = [
            row(1, "marcher", "T"),
            row(2, "item", "PROP"),
            row(3, "marcher", "T"),
        ];
        qc.setQueryData(allMarchersQueryOptions().queryKey, marchers);

        const observer = new QueryObserver(qc, performersQueryOptions());

        expect(performersQueryOptions().queryKey).toEqual(
            allMarchersQueryOptions().queryKey,
        );
        expect(observer.getCurrentResult().data?.map((m) => m.id)).toEqual([
            1, 3,
        ]);
    });
});
