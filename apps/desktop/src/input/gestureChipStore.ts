import { create } from "zustand";
import type { Roles } from "./modifierRoles";

export type GestureChipScreen = { readonly x: number; readonly y: number };

export type GestureChipState = {
    active: boolean;
    roles: Roles;
    constrainWord?: string;
    screen?: GestureChipScreen;
};

type GestureChipPayload = {
    roles: Roles;
    constrainWord?: string;
    screen?: GestureChipScreen;
};

interface GestureChipStore extends GestureChipState {
    show: (payload: GestureChipPayload) => void;
    update: (payload: GestureChipPayload) => void;
    clear: () => void;
}

const emptyRoles: Roles = {
    fine: false,
    constrain: false,
    fromCenter: false,
};

export const useGestureChipStore = create<GestureChipStore>((set) => ({
    active: false,
    roles: emptyRoles,
    show: ({ roles, constrainWord, screen }) =>
        set({ active: true, roles, constrainWord, screen }),
    update: ({ roles, constrainWord, screen }) =>
        set((state) => ({
            active: true,
            roles,
            constrainWord: constrainWord ?? state.constrainWord,
            screen: screen ?? state.screen,
        })),
    clear: () =>
        set({
            active: false,
            roles: emptyRoles,
            constrainWord: undefined,
            screen: undefined,
        }),
}));
