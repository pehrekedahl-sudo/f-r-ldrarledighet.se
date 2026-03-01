import { describe, it, expect } from "vitest";
import { mergeAdjacentBlocks } from "../lib/mergeAdjacentBlocks";

describe("mergeAdjacentBlocks", () => {
  it("merges two contiguous blocks with same settings", () => {
    const result = mergeAdjacentBlocks([
      { id: "a", parentId: "p1", startDate: "2025-01-01", endDate: "2025-01-31", daysPerWeek: 5 },
      { id: "b", parentId: "p1", startDate: "2025-02-01", endDate: "2025-02-28", daysPerWeek: 5 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
    expect(result[0].startDate).toBe("2025-01-01");
    expect(result[0].endDate).toBe("2025-02-28");
  });

  it("does not merge blocks with different daysPerWeek", () => {
    const result = mergeAdjacentBlocks([
      { id: "a", parentId: "p1", startDate: "2025-01-01", endDate: "2025-01-31", daysPerWeek: 5 },
      { id: "b", parentId: "p1", startDate: "2025-02-01", endDate: "2025-02-28", daysPerWeek: 4 },
    ]);
    expect(result).toHaveLength(2);
  });

  it("does not merge blocks with a gap", () => {
    const result = mergeAdjacentBlocks([
      { id: "a", parentId: "p1", startDate: "2025-01-01", endDate: "2025-01-30", daysPerWeek: 5 },
      { id: "b", parentId: "p1", startDate: "2025-02-01", endDate: "2025-02-28", daysPerWeek: 5 },
    ]);
    expect(result).toHaveLength(2);
  });

  it("does not merge blocks of different parents", () => {
    const result = mergeAdjacentBlocks([
      { id: "a", parentId: "p1", startDate: "2025-01-01", endDate: "2025-01-31", daysPerWeek: 5 },
      { id: "b", parentId: "p2", startDate: "2025-02-01", endDate: "2025-02-28", daysPerWeek: 5 },
    ]);
    expect(result).toHaveLength(2);
  });

  it("merges three contiguous blocks", () => {
    const result = mergeAdjacentBlocks([
      { id: "a", parentId: "p1", startDate: "2025-01-01", endDate: "2025-01-31", daysPerWeek: 5 },
      { id: "b", parentId: "p1", startDate: "2025-02-01", endDate: "2025-02-28", daysPerWeek: 5 },
      { id: "c", parentId: "p1", startDate: "2025-03-01", endDate: "2025-03-31", daysPerWeek: 5 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].endDate).toBe("2025-03-31");
  });

  it("respects lowestDaysPerWeek in merge check", () => {
    const result = mergeAdjacentBlocks([
      { id: "a", parentId: "p1", startDate: "2025-01-01", endDate: "2025-01-31", daysPerWeek: 5, lowestDaysPerWeek: 2 },
      { id: "b", parentId: "p1", startDate: "2025-02-01", endDate: "2025-02-28", daysPerWeek: 5, lowestDaysPerWeek: 0 },
    ]);
    expect(result).toHaveLength(2);
  });
});
