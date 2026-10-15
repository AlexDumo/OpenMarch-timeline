import getPageCollisions, {
    CollisionData,
    getCollisionsForSelectedPage,
} from "@/global/classes/CollisionDetection";
import Marcher from "@/global/classes/Marcher";
import Page from "@/global/classes/Page";
import { MarcherTimeline } from "@/utilities/Keyframes";
import { create } from "zustand";

type CollisionStoreInterface = {
    collisions: Map<number, CollisionData[]>;
    currentCollisions: CollisionData[];
    setCollisions: (
        marchers: Marcher[],
        marcherTimelines: Map<number, MarcherTimeline>,
        pages: Page[],
    ) => void;

    setCurrentCollision: (selectedPage: Page | null) => void;
};

export const useCollisionStore = create<CollisionStoreInterface>((set) => ({
    collisions: new Map<number, CollisionData[]>(),
    currentCollisions: [],
    setCollisions: (
        marchers: Marcher[],
        marcherTimelines: Map<number, MarcherTimeline>,
        pages: Page[],
    ) =>
        set(() => ({
            collisions: getPageCollisions(marchers, marcherTimelines, pages),
        })),
    setCurrentCollision: (selectedPage: Page | null) =>
        set((state) => ({
            currentCollisions: getCollisionsForSelectedPage(
                selectedPage,
                state.collisions,
            ),
        })),
}));

declare global {
    interface Window {
        /** Scenario setup, in Playwright sessions only; see below. */
        openmarchCollisions?: {
            show(collisions: CollisionData[]): void;
        };
    }
}

/**
 * Scenario setup (fork #201): nothing computes collisions in timeline mode
 * (`setCollisions` has no caller), so the parity scenarios for collision
 * markers and "Zoom to collisions" put some on the page through this. Only in
 * Playwright sessions; the scenarios still read the field only through the
 * field test API.
 */
const isPlaywrightSession = (): boolean => {
    try {
        return (
            !!import.meta.env.VITE_PUBLIC_PLAYWRIGHT_SESSION ||
            !!window.electron?.isPlaywrightSession
        );
    } catch {
        return false;
    }
};
if (typeof window !== "undefined" && isPlaywrightSession())
    window.openmarchCollisions = {
        show: (collisions) =>
            useCollisionStore.setState({ currentCollisions: collisions }),
    };
