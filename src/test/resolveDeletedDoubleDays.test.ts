import { describe, it, expect } from "vitest";
import { resolveDeletedDoubleDays } from "../lib/resolveDeletedDoubleDays";
import type { Block } from "../lib/adjustmentPolicy";

function block(overrides: Partial<Block> & Pick<Block, "id" | "parentId" | "startDate" | "endDate" | "daysPerWeek">): Block {
  return { ...overrides };
}

describe("resolveDeletedDoubleDays", () => {
  // ── Cross-parent at seam: raw blocks span through DD window ──
  it("cross-parent seam: extends only the shortest side, no overlap remains", () => {
    // P1 has a raw block Jan 1–Jan 31 (31 days)
    // P2 has a raw block Jan 15–Feb 28 (45 days)
    // DD pair covers Jan 15–Jan 20 (overlap window)
    const blocks: Block[] = [
      block({ id: "p1-blk", parentId: "p1", startDate: "2026-01-01", endDate: "2026-01-31", daysPerWeek: 7 }),
      block({ id: "p2-blk", parentId: "p2", startDate: "2026-01-15", endDate: "2026-02-28", daysPerWeek: 7 }),
      block({ id: "dd1", parentId: "p1", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 7, isOverlap: true, overlapGroupId: "grp1" }),
      block({ id: "dd2", parentId: "p2", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 7, isOverlap: true, overlapGroupId: "grp1" }),
    ];

    const result = resolveDeletedDoubleDays(blocks, "dd1");

    // DD blocks should be gone
    expect(result.filter((b) => b.isOverlap)).toHaveLength(0);

    // No two non-overlap blocks from different parents should overlap
    const nonOverlap = result.filter((b) => !b.isOverlap);
    for (let i = 0; i < nonOverlap.length; i++) {
      for (let j = i + 1; j < nonOverlap.length; j++) {
        const a = nonOverlap[i];
        const b = nonOverlap[j];
        if (a.parentId === b.parentId) continue;
        const overlaps = a.startDate <= b.endDate && a.endDate >= b.startDate;
        expect(overlaps).toBe(false);
      }
    }

    // The shortest visible segment (P1 left: Jan 1–14 = 14 days vs P2 right: Jan 21–Feb 28 = 39 days)
    // should have been extended. P1-left is shorter, so it extends to Jan 20.
    const p1Blocks = result.filter((b) => b.parentId === "p1");
    expect(p1Blocks.length).toBeGreaterThanOrEqual(1);
    // P1 should now cover through Jan 20 (the DD end)
    const p1Covering = p1Blocks.find((b) => b.endDate >= "2026-01-20");
    expect(p1Covering).toBeDefined();
  });

  // ── Same parent, same DPW: merge across gap ──
  it("same parent, same DPW: merges blocks across the DD gap", () => {
    const blocks: Block[] = [
      block({ id: "p1-left", parentId: "p1", startDate: "2026-01-01", endDate: "2026-01-14", daysPerWeek: 5 }),
      block({ id: "p1-right", parentId: "p1", startDate: "2026-01-21", endDate: "2026-02-28", daysPerWeek: 5 }),
      block({ id: "dd1", parentId: "p1", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 5, isOverlap: true, overlapGroupId: "grp2" }),
      block({ id: "dd2", parentId: "p2", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 5, isOverlap: true, overlapGroupId: "grp2" }),
    ];

    const result = resolveDeletedDoubleDays(blocks, "dd1");
    const p1Blocks = result.filter((b) => b.parentId === "p1" && !b.isOverlap);

    // Should be merged into a single block spanning Jan 1 – Feb 28
    expect(p1Blocks).toHaveLength(1);
    expect(p1Blocks[0].startDate).toBe("2026-01-01");
    expect(p1Blocks[0].endDate).toBe("2026-02-28");
  });

  // ── Same parent, different DPW: extend shorter ──
  it("same parent, different DPW: extends the shorter segment", () => {
    const blocks: Block[] = [
      block({ id: "p1-left", parentId: "p1", startDate: "2026-01-01", endDate: "2026-01-14", daysPerWeek: 7 }),
      block({ id: "p1-right", parentId: "p1", startDate: "2026-01-21", endDate: "2026-03-31", daysPerWeek: 3 }),
      block({ id: "dd1", parentId: "p1", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 7, isOverlap: true, overlapGroupId: "grp3" }),
      block({ id: "dd2", parentId: "p2", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 3, isOverlap: true, overlapGroupId: "grp3" }),
    ];

    const result = resolveDeletedDoubleDays(blocks, "dd1");
    const p1Blocks = result.filter((b) => b.parentId === "p1" && !b.isOverlap);

    // Left (14 days) is shorter than right (70 days), so left extends to DD end
    expect(p1Blocks).toHaveLength(2);
    const left = p1Blocks.find((b) => b.daysPerWeek === 7)!;
    expect(left.endDate).toBe("2026-01-20");
    expect(left.startDate).toBe("2026-01-01");
  });

  // ── No adjacent blocks: just remove DD ──
  it("no adjacent blocks: removes DD cleanly", () => {
    const blocks: Block[] = [
      block({ id: "dd1", parentId: "p1", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 5, isOverlap: true, overlapGroupId: "grp4" }),
      block({ id: "dd2", parentId: "p2", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 5, isOverlap: true, overlapGroupId: "grp4" }),
    ];

    const result = resolveDeletedDoubleDays(blocks, "dd1");
    expect(result).toHaveLength(0);
  });

  // ── Cross-parent, equal length: deterministic tie-break ──
  it("cross-parent, equal length: deterministic result", () => {
    // Both adjacent segments are exactly 14 days
    const blocks: Block[] = [
      block({ id: "p1-blk", parentId: "p1", startDate: "2026-01-01", endDate: "2026-01-20", daysPerWeek: 7 }),
      block({ id: "p2-blk", parentId: "p2", startDate: "2026-01-15", endDate: "2026-02-03", daysPerWeek: 7 }),
      block({ id: "dd1", parentId: "p1", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 7, isOverlap: true, overlapGroupId: "grp5" }),
      block({ id: "dd2", parentId: "p2", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 7, isOverlap: true, overlapGroupId: "grp5" }),
    ];

    const result1 = resolveDeletedDoubleDays(blocks.map(b => ({...b})), "dd1");
    const result2 = resolveDeletedDoubleDays(blocks.map(b => ({...b})), "dd1");

    // Should produce identical results
    expect(result1.map(b => ({ id: b.id, s: b.startDate, e: b.endDate })))
      .toEqual(result2.map(b => ({ id: b.id, s: b.startDate, e: b.endDate })));

    // No cross-parent overlap
    const nonOverlap = result1.filter((b) => !b.isOverlap);
    for (let i = 0; i < nonOverlap.length; i++) {
      for (let j = i + 1; j < nonOverlap.length; j++) {
        const a = nonOverlap[i];
        const b = nonOverlap[j];
        if (a.parentId === b.parentId) continue;
        const overlaps = a.startDate <= b.endDate && a.endDate >= b.startDate;
        expect(overlaps).toBe(false);
      }
    }
  });

  // ── Block that fully spans DD window gets split ──
  it("block spanning entire DD window is split into two fragments", () => {
    // P1 block spans Jan 1 – Feb 28, DD is Jan 15–20
    // P2 block only on the right side
    const blocks: Block[] = [
      block({ id: "p1-full", parentId: "p1", startDate: "2026-01-01", endDate: "2026-02-28", daysPerWeek: 5 }),
      block({ id: "p2-right", parentId: "p2", startDate: "2026-01-21", endDate: "2026-03-31", daysPerWeek: 5 }),
      block({ id: "dd1", parentId: "p1", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 5, isOverlap: true, overlapGroupId: "grp6" }),
      block({ id: "dd2", parentId: "p2", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 5, isOverlap: true, overlapGroupId: "grp6" }),
    ];

    const result = resolveDeletedDoubleDays(blocks, "dd1");

    // P1 should have been split and then merged back across the gap (same DPW)
    const p1Blocks = result.filter((b) => b.parentId === "p1" && !b.isOverlap);
    expect(p1Blocks).toHaveLength(1);
    expect(p1Blocks[0].startDate).toBe("2026-01-01");
    expect(p1Blocks[0].endDate).toBe("2026-02-28");
  });
});
