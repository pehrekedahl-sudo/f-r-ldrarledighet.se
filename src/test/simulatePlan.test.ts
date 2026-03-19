import { describe, it, expect } from "vitest";
import { simulatePlan } from "../lib/simulatePlan";

const BASE_CONSTANTS = {
  SGI_CAP_ANNUAL: 588000,
  LOWEST_LEVEL_DAILY_AMOUNT: 180,
  BASIC_LEVEL_DAILY_AMOUNT: 250,
  SICKNESS_RATE: 0.8,
  REDUCTION: 0.97,
  SICKNESS_DAILY_MAX: 1200,
};

describe("simulatePlan – dateOnly migration", () => {
  it("is deterministic across DST boundary (Swedish DST Mar 29 2026)", () => {
    const plan = {
      parents: [{ id: "p1", name: "Parent1", monthlyIncomeFixed: 40000, has240Days: true }],
      blocks: [
        { id: "b1", parentId: "p1", startDate: "2026-03-23", endDate: "2026-04-05", daysPerWeek: 5 },
      ],
      constants: BASE_CONSTANTS,
    };

    const r1 = simulatePlan(plan);
    const r2 = simulatePlan(plan);
    expect(r1).toEqual(r2);
    // 2 full weeks of 5 dpw = 10 sickness days
    expect(r1.parentsResult[0].taken.sickness).toBe(10);
  });

  it("handles single-day block correctly", () => {
    const plan = {
      parents: [{ id: "p1", name: "P", monthlyIncomeFixed: 30000, has240Days: true }],
      blocks: [
        { id: "b1", parentId: "p1", startDate: "2026-03-30", endDate: "2026-03-30", daysPerWeek: 7 },
      ],
      constants: BASE_CONSTANTS,
    };
    const r = simulatePlan(plan);
    // Mar 30 2026 is a Monday → eligible for dpw=7, should be 1 day
    expect(r.parentsResult[0].taken.sickness).toBe(1);
  });

  it("string-based day iteration produces correct count over year boundary", () => {
    const plan = {
      parents: [{ id: "p1", name: "P", monthlyIncomeFixed: 30000, has240Days: true }],
      blocks: [
        { id: "b1", parentId: "p1", startDate: "2025-12-29", endDate: "2026-01-04", daysPerWeek: 7 },
      ],
      constants: BASE_CONSTANTS,
    };
    const r = simulatePlan(plan);
    // 7 days inclusive, all eligible → 7 days taken
    expect(r.parentsResult[0].taken.sickness).toBe(7);
  });
});
