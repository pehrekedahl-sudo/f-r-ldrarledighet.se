import { useEffect, useMemo, useState } from "react";
import { simulatePlan } from "@/lib/simulatePlan";

/**
 * Change this number (1..5) to run different test cases.
 */
const TEST_CASE = 1;

type Plan = any;

function buildPlan(testCase: number): Plan {
  const base = {
    parents: [
      { id: "p1", name: "Anna", monthlyIncomeFixed: 45000, monthlyIncomeVariableAvg: 0, has240Days: true },
      { id: "p2", name: "Erik", monthlyIncomeFixed: 38000, monthlyIncomeVariableAvg: 0, has240Days: true },
    ],
    constants: {
      SGI_CAP_ANNUAL: 592000,
      LOWEST_LEVEL_DAILY_AMOUNT: 180,
      BASIC_LEVEL_DAILY_AMOUNT: 250,
      SICKNESS_RATE: 0.8,
      REDUCTION: 0.97,
      // Optional: set if you want a hard per-day cap for sickness level
      // SICKNESS_DAILY_MAX: 1259,
    },
  };

  switch (testCase) {
    case 1:
      // Test 1: Green normal case (no warnings expected)
      return {
        ...base,
        blocks: [
          { id: "b1", parentId: "p1", startDate: "2025-03-01", endDate: "2025-04-30", daysPerWeek: 5 },
          { id: "b2", parentId: "p2", startDate: "2025-05-01", endDate: "2025-06-30", daysPerWeek: 5 },
        ],
      };

    case 2:
      // Test 2: Budget insufficient (warnings expected)
      return {
        ...base,
        blocks: [
          { id: "b1", parentId: "p1", startDate: "2025-03-01", endDate: "2025-08-31", daysPerWeek: 7 },
          { id: "b2", parentId: "p2", startDate: "2025-09-01", endDate: "2026-02-28", daysPerWeek: 7 },
        ],
      };

    case 3:
      // Test 3: Manual "lowestDaysPerWeek" within budget (overrideAdjusted should be false)
      return {
        ...base,
        blocks: [
          {
            id: "b1",
            parentId: "p1",
            startDate: "2025-03-01",
            endDate: "2025-04-30",
            daysPerWeek: 6,
            lowestDaysPerWeek: 1,
          },
          { id: "b2", parentId: "p2", startDate: "2025-05-01", endDate: "2025-06-30", daysPerWeek: 5 },
        ],
      };

    case 4:
      // Test 4: Force override adjustment by requesting lots of lowest-level days (overrideAdjusted should become true)
      return {
        ...base,
        blocks: [
          {
            id: "b1",
            parentId: "p1",
            startDate: "2025-03-01",
            endDate: "2025-06-30",
            daysPerWeek: 7,
            lowestDaysPerWeek: 7,
          },
        ],
      };

    case 5:
      // Test 5: Transfer improves feasibility (unfulfilledDays should decrease vs similar case without transfer)
      return {
        ...base,
        transfers: [{ fromParentId: "p2", toParentId: "p1", sicknessDays: 20 }],
        blocks: [{ id: "b1", parentId: "p1", startDate: "2025-03-01", endDate: "2025-07-31", daysPerWeek: 7 }],
      };

    default:
      return {
        ...base,
        blocks: [],
      };
  }
}

function summarize(res: any) {
  const warnings = res?.warnings ?? {};
  const unfulfilled = res?.unfulfilledDaysTotal ?? null;
  const errors = res?.validationErrors ?? [];

  const parentSummaries =
    res?.parentsResult?.map((p: any) => ({
      name: p.name,
      remaining: p.remaining,
      taken: p.taken,
      months: p.monthlyBreakdown?.map((m: any) => m.monthKey) ?? [],
    })) ?? [];

  return { warnings, unfulfilledDaysTotal: unfulfilled, validationErrors: errors, parents: parentSummaries };
}

export default function TestEngine() {
  const [result, setResult] = useState<any>(null);

  const plan = useMemo(() => buildPlan(TEST_CASE), []);

  useEffect(() => {
    const res = simulatePlan(plan);
    console.log("TEST_CASE:", TEST_CASE);
    console.log("PLAN:", plan);
    console.log("simulatePlan result:", res);
    setResult(res);
  }, [plan]);

  const summary = result ? summarize(result) : null;

  const budgetInsufficient = (result as any)?.warnings?.budgetInsufficient;
  const overrideAdjusted = (result as any)?.warnings?.overrideAdjusted;
  const unfulfilledDaysTotal = (result as any)?.unfulfilledDaysTotal;

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Engine test page</h1>
        <p className="text-sm text-muted-foreground">
          Change <code className="rounded bg-muted px-1 py-0.5">TEST_CASE</code> at the top (1..5), save, and reload
          this page.
        </p>
        <p className="mt-2 text-sm">
          Current test: <span className="font-medium">{TEST_CASE}</span>
        </p>
      </div>

      <div className="mb-6 rounded-md border bg-muted p-4">
        <h2 className="mb-2 text-sm font-semibold">Quick check</h2>
        <div className="mb-4 text-sm">
          <div>
            <b>budgetInsufficient:</b> {String(budgetInsufficient)}
          </div>
          <div>
            <b>overrideAdjusted:</b> {String(overrideAdjusted)}
          </div>
          <div>
            <b>unfulfilledDaysTotal:</b> {String(unfulfilledDaysTotal)}
          </div>
        </div>
        {summary ? (
          <pre className="text-xs overflow-auto whitespace-pre-wrap">{JSON.stringify(summary, null, 2)}</pre>
        ) : (
          <p className="text-sm text-muted-foreground">Running…</p>
        )}
      </div>

      <div className="rounded-md border bg-muted p-4">
        <h2 className="mb-2 text-sm font-semibold">Full result JSON</h2>
        <pre className="text-xs overflow-auto whitespace-pre-wrap">
          {result ? JSON.stringify(result, null, 2) : "Running…"}
        </pre>
      </div>
    </div>
  );
}
