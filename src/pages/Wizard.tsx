import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import OnboardingWizard from "@/components/OnboardingWizard";
import type { WizardResult } from "@/components/OnboardingWizard";
import { savePlanInput } from "@/lib/persistence";

const DEFAULT_PARENTS = [
  { id: "p1", name: "Anna", monthlyIncomeFixed: 45000, has240Days: true },
  { id: "p2", name: "Erik", monthlyIncomeFixed: 38000, has240Days: true },
];

const CONSTANTS = {
  SGI_CAP_ANNUAL: 592000,
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
};

let nextId = 1;

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

    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const due = new Date(wr.dueDate);

    const generatedBlocks: Block[] = [];

    // Pre-birth block
    if (wr.preBirthParent && wr.preBirthWeeks > 0) {
      const preDpw = wr.preBirthParent === "p1" ? wr.daysPerWeek1 : wr.daysPerWeek2;
      if (preDpw > 0) {
        const preStart = new Date(due);
        preStart.setDate(preStart.getDate() - wr.preBirthWeeks * 7);
        const preEnd = new Date(due);
        preEnd.setDate(preEnd.getDate() - 1);
        if (preStart < preEnd) {
          generatedBlocks.push({
            id: `b${nextId++}`,
            parentId: wr.preBirthParent,
            startDate: fmt(preStart),
            endDate: fmt(preEnd),
            daysPerWeek: Math.round(preDpw),
          });
        }
      }
    }

    // Main blocks
    const end1 = new Date(due);
    end1.setMonth(end1.getMonth() + wr.months1);
    const end2 = new Date(end1);
    end2.setMonth(end2.getMonth() + wr.months2);

    const maybeBlock = (b: Block) => b.startDate < b.endDate && b.daysPerWeek > 0 ? b : null;
    [
      wr.months1 > 0 ? maybeBlock({ id: `b${nextId++}`, parentId: "p1", startDate: fmt(due), endDate: fmt(end1), daysPerWeek: Math.round(wr.daysPerWeek1) }) : null,
      wr.months2 > 0 ? maybeBlock({ id: `b${nextId++}`, parentId: "p2", startDate: fmt(end1), endDate: fmt(end2), daysPerWeek: Math.round(wr.daysPerWeek2) }) : null,
    ].forEach(b => b && generatedBlocks.push(b));

    if (generatedBlocks.length === 0) return;

    const finalPlan = {
      parents,
      blocks: generatedBlocks,
      transfers: [],
      constants: CONSTANTS,
    };

    savePlanInput(finalPlan);
    navigate("/plan-builder");
  }, [navigate]);

  return <OnboardingWizard onComplete={handleWizardComplete} />;
};

export default Wizard;
