import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import OnboardingWizard from "@/components/OnboardingWizard";
import type { WizardResult } from "@/components/OnboardingWizard";
import { savePlanInput } from "@/lib/persistence";
import { addDays, addMonths, addWeeks, compareDates } from "@/utils/dateOnly";
import { generateBlockId } from "@/lib/blockIdUtils";

const DEFAULT_PARENTS = [
  { id: "p1", name: "Anna", monthlyIncomeFixed: 45000, has240Days: true },
  { id: "p2", name: "Erik", monthlyIncomeFixed: 38000, has240Days: true },
];

const CONSTANTS = {
  SGI_CAP_ANNUAL: 588000,
  LOWEST_LEVEL_DAILY_AMOUNT: 180,
  BASIC_LEVEL_DAILY_AMOUNT: 250,
  SICKNESS_RATE: 0.8,
  REDUCTION: 0.97,
};

type Block = {
  id: string;
  parentId: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  lowestDaysPerWeek?: number;
  source?: "system" | "user";
};

const Wizard = () => {
  const navigate = useNavigate();

  const handleWizardComplete = useCallback((wr: WizardResult) => {
    const parents = [
      {
        id: "p1" as const,
        name: wr.parent1Name,
        monthlyIncomeFixed: wr.income1 ?? DEFAULT_PARENTS[0].monthlyIncomeFixed,
        has240Days: wr.has240Days1,
      },
      {
        id: "p2" as const,
        name: wr.parent2Name,
        monthlyIncomeFixed: wr.income2 ?? DEFAULT_PARENTS[1].monthlyIncomeFixed,
        has240Days: wr.has240Days2,
      },
    ];

    const due = wr.dueDate; // already "YYYY-MM-DD"
    const preBirthStart = wr.preBirthDate ?? null;

    const generatedBlocks: Block[] = [];

    // Pre-birth block (parent 1 starts before due date)
    if (preBirthStart && compareDates(preBirthStart, due) < 0) {
      const preDpw = wr.daysPerWeek1;
      if (preDpw > 0) {
        generatedBlocks.push({
          id: generateBlockId("wiz"),
          parentId: "p1",
          startDate: preBirthStart,
          endDate: addDays(due, -1),
          daysPerWeek: Math.round(preDpw),
          source: "system",
        });
      }
    }

    // If schedule is provided (multi-block optimization), generate blocks from it
    if (wr.schedule && wr.schedule.length > 0) {
      // Group segments by parent, preserving order
      const p1Segs = wr.schedule.filter(s => s.parentId === "p1");
      const p2Segs = wr.schedule.filter(s => s.parentId === "p2");

      // Parent 1 blocks start at due date
      let cursor = due;
      for (const seg of p1Segs) {
        const segEnd = addWeeks(cursor, seg.weeks);
        if (compareDates(cursor, segEnd) < 0 && seg.daysPerWeek > 0) {
          generatedBlocks.push({
            id: generateBlockId("wiz"),
            parentId: "p1",
            startDate: cursor,
            endDate: addDays(segEnd, -1),
            daysPerWeek: seg.daysPerWeek,
            source: "system",
          });
        }
        cursor = segEnd;
      }

      // Parent 2 blocks start where parent 1 ends
      const p2Start = cursor;
      for (const seg of p2Segs) {
        const segEnd = addWeeks(cursor, seg.weeks);
        if (compareDates(cursor, segEnd) < 0 && seg.daysPerWeek > 0) {
          generatedBlocks.push({
            id: generateBlockId("wiz"),
            parentId: "p2",
            startDate: cursor,
            endDate: addDays(segEnd, -1),
            daysPerWeek: seg.daysPerWeek,
            source: "system",
          });
        }
        cursor = segEnd;
      }
    } else {
      // Fallback: uniform dpw (original behavior)
      const end1 = wr.endDate1 || addMonths(due, wr.months1);
      const end2 = wr.endDate2 || addMonths(end1, wr.months2);

      const maybeBlock = (b: Block) => compareDates(b.startDate, b.endDate) < 0 && b.daysPerWeek > 0 ? b : null;
      [
        maybeBlock({ id: generateBlockId("wiz"), parentId: "p1", startDate: due, endDate: end1, daysPerWeek: Math.round(wr.daysPerWeek1), source: "system" }),
        maybeBlock({ id: generateBlockId("wiz"), parentId: "p2", startDate: end1, endDate: end2, daysPerWeek: Math.round(wr.daysPerWeek2), source: "system" }),
      ].forEach(b => b && generatedBlocks.push(b));
    }

    if (generatedBlocks.length === 0) return;

    const finalPlan = {
      parents,
      blocks: generatedBlocks,
      transfers: [],
      constants: CONSTANTS,
      childName: wr.childName || undefined,
      dueDate: due,
    };

    savePlanInput(finalPlan);
    navigate("/plan-builder");
  }, [navigate]);

  return <OnboardingWizard onComplete={handleWizardComplete} />;
};

export default Wizard;
