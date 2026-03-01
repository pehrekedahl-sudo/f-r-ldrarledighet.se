import { describe, it, expect } from "vitest";
import { normalizeBlocks, proposeEvenSpreadReduction, applySmartChange, MIN_AUTO_DPW, type Block } from "../lib/adjustmentPolicy";

describe("normalizeBlocks", () => {
  it("merges adjacent identical blocks", () => {
    const result = normalizeBlocks([
      { id: "a", parentId: "p1", startDate: "2025-01-01", endDate: "2025-01-31", daysPerWeek: 5 },
      { id: "b", parentId: "p1", startDate: "2025-02-01", endDate: "2025-02-28", daysPerWeek: 5 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
    expect(result[0].endDate).toBe("2025-02-28");
  });

  it("removes invalid ranges", () => {
    const result = normalizeBlocks([
      { id: "a", parentId: "p1", startDate: "2025-02-01", endDate: "2025-01-01", daysPerWeek: 5 },
      { id: "b", parentId: "p1", startDate: "2025-03-01", endDate: "2025-03-31", daysPerWeek: 5 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("clamps daysPerWeek to 0-7 integers", () => {
    const result = normalizeBlocks([
      { id: "a", parentId: "p1", startDate: "2025-01-01", endDate: "2025-03-31", daysPerWeek: 9 },
    ]);
    expect(result[0].daysPerWeek).toBe(7);
  });

  it("clamps lowestDaysPerWeek to 0-dpw", () => {
    const result = normalizeBlocks([
      { id: "a", parentId: "p1", startDate: "2025-01-01", endDate: "2025-03-31", daysPerWeek: 5, lowestDaysPerWeek: 8 },
    ]);
    expect(result[0].lowestDaysPerWeek).toBe(5);
  });

  it("absorbs micro-blocks into neighbors", () => {
    const result = normalizeBlocks([
      { id: "a", parentId: "p1", startDate: "2025-01-01", endDate: "2025-03-31", daysPerWeek: 5 },
      { id: "b", parentId: "p1", startDate: "2025-04-01", endDate: "2025-04-10", daysPerWeek: 4 }, // 10 days < 14
      { id: "c", parentId: "p1", startDate: "2025-04-11", endDate: "2025-06-30", daysPerWeek: 5 },
    ]);
    // Micro-block should be absorbed
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("is deterministic", () => {
    const blocks: Block[] = [
      { id: "b", parentId: "p1", startDate: "2025-02-01", endDate: "2025-02-28", daysPerWeek: 5 },
      { id: "a", parentId: "p1", startDate: "2025-01-01", endDate: "2025-01-31", daysPerWeek: 5 },
    ];
    const r1 = normalizeBlocks(blocks);
    const r2 = normalizeBlocks([...blocks].reverse());
    expect(r1).toEqual(r2);
  });
});

describe("proposeEvenSpreadReduction", () => {
  it("reduces by 1 dpw across N weeks, late-first", () => {
    const plan: Block[] = [
      { id: "a", parentId: "p1", startDate: "2025-01-06", endDate: "2025-04-06", daysPerWeek: 6 },
    ];
    const result = proposeEvenSpreadReduction({ plan, parentScope: ["p1"], daysToReduce: 8 });
    expect(result.summary.weeksAffectedTotal).toBe(8);
    expect(result.summary.reductionPerWeek).toBe(1);
    // Should not create near-zero weeks
    for (const b of result.nextBlocks) {
      expect(b.daysPerWeek).toBeGreaterThanOrEqual(MIN_AUTO_DPW);
    }
  });

  it("never reduces below MIN_AUTO_DPW", () => {
    const plan: Block[] = [
      { id: "a", parentId: "p1", startDate: "2025-01-06", endDate: "2025-02-02", daysPerWeek: 4 },
    ];
    // Try to reduce 20 days from a 4-week block at 4dpw
    const result = proposeEvenSpreadReduction({ plan, parentScope: ["p1"], daysToReduce: 20 });
    for (const b of result.nextBlocks) {
      expect(b.daysPerWeek).toBeGreaterThanOrEqual(MIN_AUTO_DPW);
    }
  });

  it("produces minimal blocks after normalization", () => {
    const plan: Block[] = [
      { id: "a", parentId: "p1", startDate: "2025-01-06", endDate: "2025-06-29", daysPerWeek: 6 },
    ];
    const result = proposeEvenSpreadReduction({ plan, parentScope: ["p1"], daysToReduce: 4 });
    // Should be at most 2 blocks (unchanged head + reduced tail)
    expect(result.nextBlocks.length).toBeLessThanOrEqual(2);
  });
});

describe("applySmartChange", () => {
  it("normalizes the result", () => {
    const current: Block[] = [
      { id: "a", parentId: "p1", startDate: "2025-01-01", endDate: "2025-01-31", daysPerWeek: 5 },
    ];
    const next: Block[] = [
      { id: "a", parentId: "p1", startDate: "2025-01-01", endDate: "2025-01-31", daysPerWeek: 5 },
      { id: "b", parentId: "p1", startDate: "2025-02-01", endDate: "2025-02-28", daysPerWeek: 5 },
    ];
    const result = applySmartChange(current, next);
    expect(result).toHaveLength(1); // merged
  });
});
