import { create } from "zustand";
import { userList } from "../library/userStorage";

/**
 * Whether a shape's construction draws its angle lines (owner on #634): an Arc's lines from its
 * circle's center out to its ends, so the angle it turns reads at a glance. The user's, not the
 * show's, so it lives with the app's other per-user settings in localStorage. Shown until hidden.
 */
export const ANGLE_LINES_STORAGE_KEY = "openmarch:shapeAngleLines";

const STORED = userList<boolean>(
    ANGLE_LINES_STORAGE_KEY,
    (entry) => (typeof entry === "boolean" ? entry : null),
    "angle lines shown",
);

interface AngleLinesStore {
    shown: boolean;
    toggle: () => void;
}

export const useAngleLinesStore = create<AngleLinesStore>((set, get) => ({
    shown: STORED.load()[0] ?? true,
    toggle: () => {
        const shown = !get().shown;
        set({ shown });
        STORED.save([shown]);
    },
}));

STORED.sync((items) =>
    useAngleLinesStore.setState({ shown: items[0] ?? true }),
);
