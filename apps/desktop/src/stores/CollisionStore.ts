import {
    CollisionData,
    getCollisionsForSelectedPage,
} from "@/global/classes/CollisionDetection";
import Page from "@/global/classes/Page";
import { isPlaywrightSession } from "@/utilities/playwrightSession";
import { create } from "zustand";

type CollisionStoreInterface = {
    /** The collisions found, by the id of the page they were found for (`useCollisionDetection`) */
    collisions: Map<number, CollisionData[]>;
    currentCollisions: CollisionData[];
    /** The collisions found for a page, which is the selected one when they were asked for */
    setCollisions: (
        page: Pick<Page, "id">,
        collisions: CollisionData[],
    ) => void;

    setCurrentCollision: (selectedPage: Page | null) => void;
};

/** Set when a scenario puts collisions on the page; detection then leaves them be. */
let seeded = false;

export const useCollisionStore = create<CollisionStoreInterface>((set) => ({
    collisions: new Map<number, CollisionData[]>(),
    currentCollisions: [],
    setCollisions: (page, collisions) => {
        if (seeded) return;
        set(() => ({
            collisions: new Map([[page.id, collisions]]),
            currentCollisions: collisions,
        }));
    },
    setCurrentCollision: (selectedPage: Page | null) => {
        if (seeded) return;
        set((state) => ({
            currentCollisions: getCollisionsForSelectedPage(
                selectedPage,
                state.collisions,
            ),
        }));
    },
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
 * Scenario setup (fork #201): puts made-up collisions on the page, for the
 * parity scenarios and render comparisons of collision markers and "Zoom to
 * collisions" that need them at a known spot. Detection
 * (`useCollisionDetection`) then stops replacing them until reload. Only in
 * Playwright sessions; the scenarios still read the field only through the
 * field test API.
 */
if (typeof window !== "undefined" && isPlaywrightSession())
    window.openmarchCollisions = {
        show: (collisions) => {
            seeded = true;
            useCollisionStore.setState({ currentCollisions: collisions });
        },
    };
