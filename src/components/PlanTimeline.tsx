import { useMemo } from "react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

type Block = {
  id: string;
  parentId: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  lowestDaysPerWeek?: number;
};

type Parent = {
  id: string;
  name: string;
};

type Props = {
  blocks: Block[];
  parents: Parent[];
  unfulfilledDaysTotal: number;
};

function parseDateUTC(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

function monthsBetween(start: Date, end: Date): string[] {
  const months: string[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cur <= last) {
    months.push(
      cur.toLocaleDateString("sv-SE", { year: "numeric", month: "short", timeZone: "UTC" })
    );
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return months;
}

function getIntensityClass(parentId: string, daysPerWeek: number): string {
  // Parent 1 = blue hue, Parent 2 = emerald hue
  if (parentId === "p1") {
    if (daysPerWeek <= 4) return "bg-blue-300/60 border-blue-400/50";
    if (daysPerWeek === 5) return "bg-blue-400/70 border-blue-500/60";
    return "bg-blue-500/80 border-blue-600/70";
  }
  if (daysPerWeek <= 4) return "bg-emerald-300/60 border-emerald-400/50";
  if (daysPerWeek === 5) return "bg-emerald-400/70 border-emerald-500/60";
  return "bg-emerald-500/80 border-emerald-600/70";
}

/**
 * Find the approximate date when days run out.
 * We look at cumulative days consumed per block in time order.
 * Total budget = 480 (240 per parent). When cumulative exceeds budget, that's the cutoff.
 */
function findUnfulfilledDate(blocks: Block[]): string | null {
  // Sort blocks by start date
  const sorted = [...blocks].sort(
    (a, b) => parseDateUTC(a.startDate).getTime() - parseDateUTC(b.startDate).getTime()
  );

  // Total available days: 240 per parent × 2
  const budgetPerParent = new Map<string, number>();
  // Each parent has 195 sickness + 45 lowest = 240
  for (const b of sorted) {
    if (!budgetPerParent.has(b.parentId)) budgetPerParent.set(b.parentId, 240);
  }

  for (const b of sorted) {
    const start = parseDateUTC(b.startDate);
    const end = parseDateUTC(b.endDate);
    const totalMs = end.getTime() - start.getTime();
    if (totalMs <= 0) continue;

    // Rough estimate of days consumed
    const weeks = (totalMs / (7 * 86400000));
    const totalDays = Math.round(weeks * b.daysPerWeek);
    const remaining = budgetPerParent.get(b.parentId) ?? 0;

    if (totalDays > remaining && remaining >= 0) {
      // Approximate the date where budget runs out
      const daysPerDay = b.daysPerWeek / 7;
      const daysUntilEmpty = daysPerDay > 0 ? remaining / daysPerDay : 0;
      const cutoff = new Date(start.getTime() + daysUntilEmpty * 86400000);
      const yyyy = cutoff.getUTCFullYear();
      const mm = String(cutoff.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(cutoff.getUTCDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
    budgetPerParent.set(b.parentId, remaining - totalDays);
  }
  return null;
}

const PlanTimeline = ({ blocks, parents, unfulfilledDaysTotal }: Props) => {
  const validBlocks = blocks.filter((b) => b.startDate && b.endDate && b.endDate >= b.startDate);

  const { timelineStart, timelineEnd, months, totalMs } = useMemo(() => {
    if (validBlocks.length === 0) return { timelineStart: 0, timelineEnd: 0, months: [], totalMs: 1 };
    const starts = validBlocks.map((b) => parseDateUTC(b.startDate).getTime());
    const ends = validBlocks.map((b) => parseDateUTC(b.endDate).getTime());
    const minStart = Math.min(...starts);
    const maxEnd = Math.max(...ends);
    const ms = maxEnd - minStart || 1;
    return {
      timelineStart: minStart,
      timelineEnd: maxEnd,
      months: monthsBetween(new Date(minStart), new Date(maxEnd)),
      totalMs: ms,
    };
  }, [validBlocks]);

  const unfulfilledDate = useMemo(() => {
    if (unfulfilledDaysTotal <= 0) return null;
    return findUnfulfilledDate(validBlocks);
  }, [unfulfilledDaysTotal, validBlocks]);

  const unfulfilledPct = useMemo(() => {
    if (!unfulfilledDate) return null;
    const d = parseDateUTC(unfulfilledDate).getTime();
    return ((d - timelineStart) / totalMs) * 100;
  }, [unfulfilledDate, timelineStart, totalMs]);

  if (validBlocks.length === 0) return null;

  const parentRows = parents.map((p) => ({
    ...p,
    blocks: validBlocks.filter((b) => b.parentId === p.id),
  }));

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Tidslinje</h3>
      <div className="border border-border rounded-lg p-4 bg-card overflow-x-auto">
        <div className="min-w-[500px]">
          {/* Month labels */}
          <div className="flex mb-1 text-[10px] text-muted-foreground relative" style={{ height: 16 }}>
            {months.map((label, i) => (
              <div
                key={i}
                className="text-center truncate"
                style={{ width: `${100 / months.length}%` }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Rows */}
          <div className="relative space-y-1.5">
            {parentRows.map((row) => (
              <div key={row.id} className="relative h-8 bg-muted/30 rounded">
                {/* Parent label */}
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground z-10">
                  {row.name}
                </span>
                {row.blocks.map((b) => {
                  const startMs = parseDateUTC(b.startDate).getTime();
                  const endMs = parseDateUTC(b.endDate).getTime();
                  const left = ((startMs - timelineStart) / totalMs) * 100;
                  const width = Math.max(((endMs - startMs) / totalMs) * 100, 1);
                  return (
                    <div
                      key={b.id}
                      className={`absolute top-0.5 bottom-0.5 rounded border text-[10px] font-medium flex items-center justify-center text-foreground/80 ${getIntensityClass(b.parentId, b.daysPerWeek)}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      {b.daysPerWeek} d/v
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Unfulfilled red line */}
            {unfulfilledPct !== null && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-destructive z-20 cursor-help"
                      style={{ left: `${Math.min(unfulfilledPct, 100)}%` }}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Här tar dagarna slut</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlanTimeline;
