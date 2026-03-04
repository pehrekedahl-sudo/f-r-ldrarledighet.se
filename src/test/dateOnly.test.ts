import { describe, it, expect } from "vitest";
import {
  compareDates,
  addDays,
  addMonths,
  diffDaysInclusive,
  maxDate,
  minDate,
  startOfISOWeek,
  endOfISOWeek,
  getISOWeekId,
  getISOWeekRange,
} from "@/utils/dateOnly";

describe("compareDates", () => {
  it("returns 0 for equal dates", () => expect(compareDates("2026-03-04", "2026-03-04")).toBe(0));
  it("returns -1 when a < b", () => expect(compareDates("2026-01-01", "2026-12-31")).toBe(-1));
  it("returns 1 when a > b", () => expect(compareDates("2026-12-31", "2026-01-01")).toBe(1));
});

describe("addDays", () => {
  it("adds positive days", () => expect(addDays("2026-03-01", 5)).toBe("2026-03-06"));
  it("subtracts days", () => expect(addDays("2026-03-10", -3)).toBe("2026-03-07"));
  it("crosses month boundary", () => expect(addDays("2026-01-30", 3)).toBe("2026-02-02"));
  it("crosses year boundary", () => expect(addDays("2025-12-31", 1)).toBe("2026-01-01"));

  // DST transitions (CET → CEST: last Sunday of March)
  it("handles spring DST transition (2026-03-29)", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
  });
  // CEST → CET: last Sunday of October
  it("handles autumn DST transition (2026-10-25)", () => {
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });
});

describe("diffDaysInclusive", () => {
  it("same day = 1", () => expect(diffDaysInclusive("2026-03-01", "2026-03-01")).toBe(1));
  it("two consecutive days = 2", () => expect(diffDaysInclusive("2026-03-01", "2026-03-02")).toBe(2));
  it("full week = 7", () => expect(diffDaysInclusive("2026-03-02", "2026-03-08")).toBe(7));
  it("across DST", () => expect(diffDaysInclusive("2026-03-28", "2026-03-30")).toBe(3));
});

describe("maxDate / minDate", () => {
  it("maxDate picks later", () => expect(maxDate("2026-01-01", "2026-06-15")).toBe("2026-06-15"));
  it("minDate picks earlier", () => expect(minDate("2026-01-01", "2026-06-15")).toBe("2026-01-01"));
});

describe("startOfISOWeek / endOfISOWeek", () => {
  // 2026-03-04 is a Wednesday
  it("start of week for Wed 2026-03-04 is Mon 2026-03-02", () => {
    expect(startOfISOWeek("2026-03-04")).toBe("2026-03-02");
  });
  it("end of week for Wed 2026-03-04 is Sun 2026-03-08", () => {
    expect(endOfISOWeek("2026-03-04")).toBe("2026-03-08");
  });
  it("Monday stays Monday", () => expect(startOfISOWeek("2026-03-02")).toBe("2026-03-02"));
  it("Sunday stays Sunday", () => expect(endOfISOWeek("2026-03-08")).toBe("2026-03-08"));
});

describe("getISOWeekId", () => {
  it("2026-03-04 is W10", () => expect(getISOWeekId("2026-03-04")).toBe("2026-W10"));
  it("2026-01-01 is in 2026-W01", () => expect(getISOWeekId("2026-01-01")).toBe("2026-W01"));
  // 2025-12-29 (Mon) belongs to ISO week 1 of 2026
  it("2025-12-29 is 2026-W01", () => expect(getISOWeekId("2025-12-29")).toBe("2026-W01"));
  // 2024-12-30 (Mon) belongs to ISO week 1 of 2025
  it("2024-12-30 is 2025-W01", () => expect(getISOWeekId("2024-12-30")).toBe("2025-W01"));
});

describe("getISOWeekRange", () => {
  it("2026-W10 starts Mon 2026-03-02, ends Sun 2026-03-08", () => {
    const r = getISOWeekRange("2026-W10");
    expect(r.startDate).toBe("2026-03-02");
    expect(r.endDate).toBe("2026-03-08");
  });
  it("2026-W01 starts Mon 2025-12-29, ends Sun 2026-01-04", () => {
    const r = getISOWeekRange("2026-W01");
    expect(r.startDate).toBe("2025-12-29");
    expect(r.endDate).toBe("2026-01-04");
  });
  it("roundtrip: getISOWeekRange(getISOWeekId(date)) contains date", () => {
    const date = "2026-06-17";
    const weekId = getISOWeekId(date);
    const range = getISOWeekRange(weekId);
    expect(date >= range.startDate && date <= range.endDate).toBe(true);
  });
});

describe("addMonths", () => {
  it("adds months normally", () => {
    expect(addMonths("2026-01-15", 3)).toBe("2026-04-15");
  });
  it("clamps day overflow (Jan 31 + 1 month → Feb 28)", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("clamps day overflow in leap year (Jan 31 + 1 month → Feb 29)", () => {
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });
  it("handles year boundary (Nov + 3 months)", () => {
    expect(addMonths("2025-11-15", 3)).toBe("2026-02-15");
  });
  it("subtracts months", () => {
    expect(addMonths("2026-03-15", -2)).toBe("2026-01-15");
  });
  it("clamps when subtracting (Mar 31 - 1 month → Feb 28)", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });
  it("handles 12 months = 1 year", () => {
    expect(addMonths("2026-06-15", 12)).toBe("2027-06-15");
  });
  it("is DST-safe across Swedish DST (Mar 29 2026)", () => {
    const r1 = addMonths("2026-02-28", 1);
    const r2 = addMonths("2026-02-28", 1);
    expect(r1).toBe("2026-03-28");
    expect(r1).toBe(r2);
  });
});
