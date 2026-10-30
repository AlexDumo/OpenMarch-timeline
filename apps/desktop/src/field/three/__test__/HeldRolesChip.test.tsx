import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { IsPlayingProvider } from "@/context/IsPlayingContext";
import { useGestureChipStore } from "@/input/gestureChipStore";
import * as platform from "@/shortcuts/platform";
import { useUiSettingsStore } from "@/stores/UiSettingsStore";
import {
    gestureChipSegments,
    shouldShowGestureChip,
} from "../heldRoleChipText";
import HeldRolesChip from "../HeldRolesChip";

const { chipT } = vi.hoisted(() => ({
    chipT: (key: string) =>
        ({
            "field.gestureChip.fine": "fine",
            "field.gestureChip.fromCenter": "from center",
            "field.gestureChip.constrain": "constrain",
            "field.gestureChip.constrainOneAxis": "one axis",
            "field.gestureChip.constrainEqualSpacings": "equal spacings",
            "field.gestureChip.constrain45": "45°",
            "field.gestureChip.snapOff": "Snap off",
        })[key] ?? key,
}));

vi.mock("@tolgee/react", () => ({
    useTranslate: () => ({ t: chipT }),
}));

beforeEach(() => {
    vi.spyOn(platform, "isMacPlatform").mockReturnValue(false);
});

afterEach(() => {
    cleanup();
    act(() => {
        useGestureChipStore.getState().clear();
        useUiSettingsStore.getState().setSnap(true);
    });
    vi.restoreAllMocks();
});

const renderChip = () =>
    render(
        <IsPlayingProvider>
            <HeldRolesChip />
        </IsPlayingProvider>,
    );

describe("shouldShowGestureChip", () => {
    const roles = {
        fine: false,
        constrain: false,
        fromCenter: false,
    };

    it("hides with no drag, with nothing held while snapping is on, and during playback", () => {
        expect(shouldShowGestureChip(false, roles, true, false)).toBe(false);
        expect(shouldShowGestureChip(true, roles, true, false)).toBe(false);
        expect(
            shouldShowGestureChip(true, { ...roles, fine: true }, true, true),
        ).toBe(false);
    });

    it("shows while a drag is active and something is held or snapping is off", () => {
        expect(
            shouldShowGestureChip(true, { ...roles, fine: true }, true, false),
        ).toBe(true);
        expect(shouldShowGestureChip(true, roles, false, false)).toBe(true);
    });
});

describe("gestureChipSegments", () => {
    it("lists held roles with platform symbols and words, and Snap off when snapping is off", () => {
        expect(
            gestureChipSegments(
                { fine: true, constrain: true, fromCenter: true },
                "one axis",
                false,
                false,
                chipT,
            ),
        ).toEqual([
            "Shift fine",
            "Ctrl one axis",
            "Alt from center",
            "Snap off",
        ]);
    });
});

describe("HeldRolesChip", () => {
    it("renders at the pointer offset when a drag is active", () => {
        renderChip();
        act(() => {
            useGestureChipStore.getState().show({
                roles: { fine: true, constrain: false, fromCenter: false },
                screen: { x: 100, y: 200 },
            });
        });
        const chip = screen.getByTestId("heldRolesChip");
        expect(chip).toHaveTextContent("Shift fine");
        expect(chip).toHaveStyle({ left: "116px", top: "218px" });
    });

    it("is not in the document when nothing is held and snapping is on", () => {
        renderChip();
        act(() => {
            useGestureChipStore.getState().show({
                roles: {
                    fine: false,
                    constrain: false,
                    fromCenter: false,
                },
                screen: { x: 0, y: 0 },
            });
        });
        expect(screen.queryByTestId("heldRolesChip")).toBeNull();
    });
});
