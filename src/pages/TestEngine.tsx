import { useEffect, useState } from "react";
import { simulatePlan } from "@/lib/simulatePlan";

const testPlan = {
  parents: [
    { id: "p1", name: "Anna", monthlyIncomeFixed: 45000, has240Days: true },
    { id: "p2", name: "Erik", monthlyIncomeFixed: 38000, has240Days: true },
  ],
  blocks: [
    { id: "b1", parentId: "p1", startDate: "2025-03-01", endDate: "2025-08-31", daysPerWeek: 7 },
    { id: "b2", parentId: "p2", startDate: "2025-09-01", endDate: "2026-02-28", daysPerWeek: 7 },
  ],
  constants: {
    SGI_CAP_ANNUAL: 592000,
    LOWEST_LEVEL_DAILY_AMOUNT: 180,
    BASIC_LEVEL_DAILY_AMOUNT: 250,
    SICKNESS_RATE: 0.8,
    REDUCTION: 0.97,
  },
};

const TestEngine = () => {
  const [result, setResult] = useState<unknown>(null);

  useEffect(() => {
    const res = simulatePlan(testPlan);
    console.log("simulatePlan result:", res);
    setResult(res);
  }, []);

  return (
    <div className="min-h-screen bg-background p-8">
      <p className="mb-4 text-sm text-muted-foreground">Engine test page</p>
      <pre className="rounded-md border bg-muted p-4 text-sm overflow-auto whitespace-pre-wrap">
        {result ? JSON.stringify(result, null, 2) : "Running…"}
      </pre>
    </div>
  );
};

export default TestEngine;
