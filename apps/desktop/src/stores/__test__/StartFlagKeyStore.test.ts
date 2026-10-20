import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    useStartFlagKeyStore,
    useStartFlagLevelsInEffect,
} from "../StartFlagKeyStore";
import { useUiSettingsStore } from "../UiSettingsStore";

const ALWAYS = { dots: "selected", paths: "off" } as const;
const HOLD = { dots: "all", paths: "all" } as const;

beforeEach(() => {
    vi.useFakeTimers();
    useUiSettingsStore
        .getState()
        .setStartFlagPositions({ always: ALWAYS, hold: HOLD });
    useStartFlagKeyStore.setState({ held: false, latched: false });
});
afterEach(() => vi.useRealTimers());

const key = () => useStartFlagKeyStore.getState();

describe("start flag positions key state", () => {
    it("shows the Hold N levels while N is held, and Always again on release", () => {
        const { result } = renderHook(() => useStartFlagLevelsInEffect());
        expect(result.current).toEqual(ALWAYS);

        act(() => key().press());
        expect(result.current).toEqual(HOLD);

        vi.advanceTimersByTime(600);
        expect(result.current).toEqual(HOLD);

        act(() => key().release());
        expect(result.current).toEqual(ALWAYS);
    });

    it("a tap under 250 ms latches Hold N until the next tap", () => {
        const { result } = renderHook(() => useStartFlagLevelsInEffect());
        act(() => key().press());
        vi.advanceTimersByTime(120);
        act(() => key().release());
        expect(result.current).toEqual(HOLD);
        expect(key().latched).toBe(true);

        // Some time later: a hold while latched stays in Hold N, and keeps the latch
        vi.advanceTimersByTime(5000);
        act(() => key().press());
        vi.advanceTimersByTime(400);
        act(() => key().release());
        expect(result.current).toEqual(HOLD);

        act(() => key().press());
        vi.advanceTimersByTime(249);
        act(() => key().release());
        expect(result.current).toEqual(ALWAYS);
        expect(key().latched).toBe(false);
    });

    it("a release at 250 ms or later is a hold, not a tap", () => {
        const { result } = renderHook(() => useStartFlagLevelsInEffect());
        act(() => key().press());
        vi.advanceTimersByTime(250);
        act(() => key().release());
        expect(result.current).toEqual(ALWAYS);
        expect(key().latched).toBe(false);
    });

    it("losing window focus lets go of a held N without latching", () => {
        const { result } = renderHook(() => useStartFlagLevelsInEffect());
        act(() => key().press());
        vi.advanceTimersByTime(50);
        act(() => key().blurRelease());
        expect(result.current).toEqual(ALWAYS);
        expect(key().held).toBe(false);
        expect(key().latched).toBe(false);

        // The key-up that never reached the window changes nothing later
        act(() => key().release());
        expect(result.current).toEqual(ALWAYS);
    });

    it("toggling the latch (the palette command) switches Hold N on and off", () => {
        const { result } = renderHook(() => useStartFlagLevelsInEffect());
        act(() => key().toggleLatched());
        expect(result.current).toEqual(HOLD);
        act(() => key().toggleLatched());
        expect(result.current).toEqual(ALWAYS);
    });

    it("follows the saved states as they change", () => {
        const { result } = renderHook(() => useStartFlagLevelsInEffect());
        act(() =>
            useUiSettingsStore.getState().setStartFlagPositions({
                always: { dots: "off", paths: "off" },
                hold: HOLD,
            }),
        );
        expect(result.current).toEqual({ dots: "off", paths: "off" });
    });
});
