import { describe, it, expect } from "vitest";
import { resolveDeletedDoubleDays } from "../lib/resolveDeletedDoubleDays";
import type { Block } from "../lib/adjustmentPolicy";

function block(
  overrides: Partial<Block> &
    Pick<Block, "id" | "parentId" | "startDate" | "endDate" | "daysPerWeek">
): Block {
  return { ...overrides };
}

/** Assert no two non-overlap blocks from different parents share any dates */
function assertNoCrossParentOverlap(blocks: Block[]) {
  const nonOverlap = blocks.filter((b) => !b.isOverlap);
  for (let i = 0; i < nonOverlap.length; i++) {
    for (let j = i + 1; j < nonOverlap.length; j++) {
      const a = nonOverlap[i];
      const b = nonOverlap[j];
      if (a.parentId === b.parentId) continue;
      const overlaps = a.startDate <= b.endDate && a.endDate >= b.startDate;
      expect(
        overlaps,
        `Cross-parent overlap: ${a.parentId}(${a.startDate}–${a.endDate}) vs ${b.parentId}(${b.startDate}–${b.endDate})`
      ).toBe(false);
    }
  }
}

describe("resolveDeletedDoubleDays", () => {
  // ── Cross-parent at seam: raw blocks span through DD window ──
  it("cross-parent seam: extends only the shortest side, no overlap remains", () => {
    // P1 raw block Jan 1–Jan 31 (was extended by drag, spans through DD)
    // P2 raw block Jan 15–Feb 28 (starts inside DD, also spans through)
    // DD pair covers Jan 15–Jan 20
    const blocks: Block[] = [
      block({ id: "p1-blk", parentId: "p1", startDate: "2026-01-01", endDate: "2026-01-31", daysPerWeek: 7 }),
      block({ id: "p2-blk", parentId: "p2", startDate: "2026-01-15", endDate: "2026-02-28", daysPerWeek: 7 }),
      block({ id: "dd1", parentId: "p1", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 7, isOverlap: true, overlapGroupId: "grp1" }),
      block({ id: "dd2", parentId: "p2", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 7, isOverlap: true, overlapGroupId: "grp1" }),
    ];

    const result = resolveDeletedDoubleDays(blocks, "dd1");

    // DD blocks should be gone
    expect(result.filter((b) => b.isOverlap)).toHaveLength(0);

    // No cross-parent overlap
    assertNoCrossParentOverlap(result);

    // P1 left fragment (Jan 1–14) was shorter than P2 right (Jan 21–Feb 28)
    // So P1 should have merged across (same parent, same DPW) to fill the gap
    // Then P2 should be trimmed to not overlap with P1
    const p1Blocks = result.filter((b) => b.parentId === "p1");
    expect(p1Blocks.length).toBeGreaterThanOrEqual(1);
    // P1 should cover through at least Jan 20 (the DD end)
    const p1MaxEnd = p1Blocks.map((b) => b.endDate).sort().reverse()[0];
    expect(p1MaxEnd >= "2026-01-20").toBe(true);
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
  it("cross-parent, equal length: deterministic and no overlap", () => {
    const blocks: Block[] = [
      block({ id: "p1-blk", parentId: "p1", startDate: "2026-01-01", endDate: "2026-01-20", daysPerWeek: 7 }),
      block({ id: "p2-blk", parentId: "p2", startDate: "2026-01-15", endDate: "2026-02-03", daysPerWeek: 7 }),
      block({ id: "dd1", parentId: "p1", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 7, isOverlap: true, overlapGroupId: "grp5" }),
      block({ id: "dd2", parentId: "p2", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 7, isOverlap: true, overlapGroupId: "grp5" }),
    ];

    const result = resolveDeletedDoubleDays(blocks, "dd1");

    // No cross-parent overlap
    assertNoCrossParentOverlap(result);

    // DD blocks removed
    expect(result.filter((b) => b.isOverlap)).toHaveLength(0);
  });

  // ── Block that fully spans DD window gets split and re-merged ──
  it("block spanning entire DD window is split into two fragments", () => {
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

    // No cross-parent overlap
    assertNoCrossParentOverlap(result);
  });

  // ── Cross-parent: raw blocks overlap BEYOND DD window ──
  it("cross-parent: trims loser blocks that overlap beyond the DD window", () => {
    // P1: Jan 1–Jan 31, P2: Jan 10–Feb 28
    // DD covers only Jan 15–20, but raw overlap is Jan 10–31
    const blocks: Block[] = [
      block({ id: "p1-blk", parentId: "p1", startDate: "2026-01-01", endDate: "2026-01-31", daysPerWeek: 7 }),
      block({ id: "p2-blk", parentId: "p2", startDate: "2026-01-10", endDate: "2026-02-28", daysPerWeek: 7 }),
      block({ id: "dd1", parentId: "p1", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 7, isOverlap: true, overlapGroupId: "grp7" }),
      block({ id: "dd2", parentId: "p2", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 7, isOverlap: true, overlapGroupId: "grp7" }),
    ];

    const result = resolveDeletedDoubleDays(blocks, "dd1");

    expect(result.filter((b) => b.isOverlap)).toHaveLength(0);
    assertNoCrossParentOverlap(result);
  });

  // ── Does not mutate original blocks ──
  it("does not mutate original block objects", () => {
    const blocks: Block[] = [
      block({ id: "p1-blk", parentId: "p1", startDate: "2026-01-01", endDate: "2026-01-31", daysPerWeek: 7 }),
      block({ id: "p2-blk", parentId: "p2", startDate: "2026-01-15", endDate: "2026-02-28", daysPerWeek: 7 }),
      block({ id: "dd1", parentId: "p1", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 7, isOverlap: true, overlapGroupId: "grp8" }),
      block({ id: "dd2", parentId: "p2", startDate: "2026-01-15", endDate: "2026-01-20", daysPerWeek: 7, isOverlap: true, overlapGroupId: "grp8" }),
    ];

    const origP1End = blocks[0].endDate;
    const origP2Start = blocks[1].startDate;

    resolveDeletedDoubleDays(blocks, "dd1");

    expect(blocks[0].endDate).toBe(origP1End);
    expect(blocks[1].startDate).toBe(origP2Start);
  });
});
