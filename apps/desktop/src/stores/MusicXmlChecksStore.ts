import { create } from "zustand";
import type { ImportCheck } from "@/components/music/musicXmlImportChecks";

/**
 * The things to check from a MusicXML import, and whether their list is open. The list lives at
 * app level so the import toast can open it after the music settings have closed.
 */
interface MusicXmlChecksStore {
    fileName: string;
    checks: ImportCheck[];
    open: boolean;
    /**
     * Opens the list on one import's checks. The toast passes the checks of the import that made
     * it, so an older toast never shows a later import's list.
     */
    showChecks: (fileName: string, checks: ImportCheck[]) => void;
    setOpen: (open: boolean) => void;
}

export const useMusicXmlChecksStore = create<MusicXmlChecksStore>((set) => ({
    fileName: "",
    checks: [],
    open: false,
    showChecks: (fileName, checks) => set({ fileName, checks, open: true }),
    setOpen: (open) => set({ open }),
}));
