import { describe, expect, it } from "vitest";
import {
    EXPIRY_NOTICE_DAYS,
    expiryNoticeDays,
    formatExpiryDate,
    partitionByExpiry,
} from "../ensembleExpiry";

/** Local noon on a calendar day, so time zones can't move the date. */
const localNoon = (year: number, month: number, day: number) =>
    new Date(year, month - 1, day, 12);

describe("expiryNoticeDays", () => {
    const active = (expires_on: string) => ({ expires_on, expired: false });

    it("is undefined more than 30 days out", () => {
        expect(
            expiryNoticeDays(active("2027-06-30"), localNoon(2027, 5, 30)),
        ).toBeUndefined();
    });

    it("counts down in the final 30 days", () => {
        expect(
            expiryNoticeDays(active("2027-06-30"), localNoon(2027, 5, 31)),
        ).toBe(EXPIRY_NOTICE_DAYS);
        expect(
            expiryNoticeDays(active("2027-06-30"), localNoon(2027, 6, 20)),
        ).toBe(10);
        expect(
            expiryNoticeDays(active("2027-06-30"), localNoon(2027, 6, 29)),
        ).toBe(1);
    });

    it("is 0 on the last day, whatever the time of day", () => {
        expect(
            expiryNoticeDays(active("2026-12-31"), localNoon(2026, 12, 31)),
        ).toBe(0);
        expect(
            expiryNoticeDays(
                active("2026-12-31"),
                new Date(2026, 11, 31, 23, 59),
            ),
        ).toBe(0);
    });

    it("stays 0 after the date while the server still says active", () => {
        // The ensemble lasts until its day has ended Anywhere on Earth
        expect(
            expiryNoticeDays(active("2026-12-31"), localNoon(2027, 1, 1)),
        ).toBe(0);
    });

    it("is undefined once the server says expired", () => {
        expect(
            expiryNoticeDays(
                { expires_on: "2026-12-31", expired: true },
                localNoon(2026, 12, 20),
            ),
        ).toBeUndefined();
    });

    it("is undefined for a date it can't read", () => {
        expect(
            expiryNoticeDays(active("not a date"), localNoon(2026, 12, 20)),
        ).toBeUndefined();
    });

    it("counts whole days across a daylight-saving change", () => {
        // March 2027 has a DST change in most zones that observe one
        expect(
            expiryNoticeDays(active("2027-03-20"), localNoon(2027, 3, 1)),
        ).toBe(19);
    });
});

describe("formatExpiryDate", () => {
    it("formats the calendar day without shifting it", () => {
        const formatted = formatExpiryDate("2027-06-30");
        expect(formatted).toContain("2027");
        expect(formatted).toContain("30");
    });

    it("returns text it can't read unchanged", () => {
        expect(formatExpiryDate("someday")).toBe("someday");
    });
});

describe("partitionByExpiry", () => {
    it("splits by the server's flag and keeps order", () => {
        const ensembles = [
            { id: 1, expires_on: "2026-12-31", expired: true },
            { id: 2, expires_on: "2027-06-30", expired: false },
            { id: 3, expires_on: "2026-12-31", expired: true },
            { id: 4, expires_on: "2027-06-30", expired: false },
        ];
        const { active, expired } = partitionByExpiry(ensembles);
        expect(active.map((e) => e.id)).toEqual([2, 4]);
        expect(expired.map((e) => e.id)).toEqual([1, 3]);
    });
});
