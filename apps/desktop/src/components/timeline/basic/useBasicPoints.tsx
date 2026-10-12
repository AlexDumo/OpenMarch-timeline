import type { ReactNode } from "react";

/** PLACEHOLDER until B2 lands: the selected marchers' mid-page positions and their menu */
export function useBasicPoints(): {
    points: readonly number[];
    onPointContextMenu?: (beat: number, event: React.MouseEvent) => void;
    menu: ReactNode;
} {
    return { points: [], menu: null };
}
