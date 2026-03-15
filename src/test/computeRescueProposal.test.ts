import { describe, it, expect } from "vitest";
import {
  computeRescueProposal,
  type Block,
  type Parent,
  type Constants,
  type Transfer,
} from "../lib/rescue/computeRescueProposal";

const CONSTANTS: Constants = {
  SGI_CAP_ANNUAL: 600000,
  LOWEST_LEVEL_DAILY_AMOUNT: 180,
  BASIC_LEVEL_DAILY_AMOUNT: 250,
  SICKNESS_RATE: 0.8,
  REDUCTION: 0.97,
  SICKNESS_DAILY_MAX: 1200,
};

const PARENTS: Parent[] = [
  { id: "p1", name: "Förälder 1", monthlyIncomeFixed: 40000, has240Days: true },
  { id: "p2", name: "Förälder 2", monthlyIncomeFixed: 35000, has240Days: true },
];

describe("computeRescueProposal – transfer preservation", () => {
  it("should not drop existing transfer when no new transfer is proposed", () => {
    // Create blocks that use many days with an existing transfer that helps
    const blocks: Block[] = [
      { id: "b1", parentId: "p1", startDate: "2026-01-05", endDate: "2026-12-27", daysPerWeek: 5 },
      { id: "b2", parentId: "p2", startDate: "2027-01-04", endDate: "2027-06-27", daysPerWeek: 5 },
    ];

    const existingTransfer: Transfer = {
      fromParentId: "p1",
      toParentId: "p2",
      sicknessDays: 30,
    };

    const withTransfer = computeRescueProposal(blocks, PARENTS, CONSTANTS, existingTransfer, "proportional");
    const withoutTransfer = computeRescueProposal(blocks, PARENTS, CONSTANTS, null, "proportional");

    // With existing transfer, shortage should not be WORSE than without
    if (withTransfer && withoutTransfer) {
      expect(withTransfer.meta.shortageAfterTransfer).toBeLessThanOrEqual(
        withoutTransfer.meta.shortageAfterTransfer
      );
    }
  });

  it("should return effective transfer that includes existing transfer", () => {
    const blocks: Block[] = [
      { id: "b1", parentId: "p1", startDate: "2026-01-05", endDate: "2026-12-27", daysPerWeek: 5 },
      { id: "b2", parentId: "p2", startDate: "2027-01-04", endDate: "2027-06-27", daysPerWeek: 5 },
    ];

    const existingTransfer: Transfer = {
      fromParentId: "p1",
      toParentId: "p2",
      sicknessDays: 20,
    };

    const result = computeRescueProposal(blocks, PARENTS, CONSTANTS, existingTransfer, "proportional");

    if (result && result.proposedTransfer) {
      // The effective transfer should exist (combining existing + proposed)
      expect(result.proposedTransfer.sicknessDays).toBeGreaterThan(0);
    }
    // Result should not be null — the solver should find a solution
    expect(result).not.toBeNull();
  });

  it("should return success=false with correct unfulfilledAfterFull when days truly run out", () => {
    // Create an extreme plan that can't possibly work
    const blocks: Block[] = [
      { id: "b1", parentId: "p1", startDate: "2026-01-05", endDate: "2029-12-28", daysPerWeek: 7 },
      { id: "b2", parentId: "p2", startDate: "2030-01-07", endDate: "2033-12-25", daysPerWeek: 7 },
    ];

    const result = computeRescueProposal(blocks, PARENTS, CONSTANTS, null, "proportional");

    if (result) {
      expect(result.success).toBe(false);
      expect(result.meta.unfulfilledAfterFull).toBeGreaterThan(0);
    }
  });
});
