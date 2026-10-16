import { create } from "zustand";
import type { ImportCheck } from "@/components/music/musicXmlImportChecks";

/**
 * The things to check from the last MusicXML import, and whether their list is open. The list
 * lives at app level so the import toast can open it after the music settings have closed.
 */
interface MusicXmlChecksStore {
    fileName: string;
    checks: ImportCheck[];
    open: boolean;
    setChecks: (fileName: string, checks: ImportCheck[]) => void;
    setOpen: (open: boolean) => void;
}

export const useMusicXmlChecksStore = create<MusicXmlChecksStore>((set) => ({
    fileName: "",
    checks: [],
    open: false,
    setChecks: (fileName, checks) => set({ fileName, checks }),
    setOpen: (open) => set({ open }),
}));
