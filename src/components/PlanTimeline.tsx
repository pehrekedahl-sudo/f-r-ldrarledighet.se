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
  onBlockClick?: (blockId: string) => void;
};

function parseDateUTC(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

type MonthInfo = { key: string; label: string; year: number; isFirstOfYear: boolean };

function getMonths(start: Date, end: Date): MonthInfo[] {
  const months: MonthInfo[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  const shortNames = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  let prevYear = -1;
  while (cur <= last) {
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth();
    months.push({
      key: `${y}-${m}`,
      label: shortNames[m],
      year: y,
      isFirstOfYear: y !== prevYear,
    });
    prevYear = y;
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return months;
}

function getIntensityClass(parentId: string, daysPerWeek: number): string {
  if (parentId === "p1") {
    if (daysPerWeek <= 4) return "bg-blue-300/60 border-blue-400/50";
    if (daysPerWeek === 5) return "bg-blue-400/70 border-blue-500/60";
    return "bg-blue-500/80 border-blue-600/70";
  }
  if (daysPerWeek <= 4) return "bg-emerald-300/60 border-emerald-400/50";
  if (daysPerWeek === 5) return "bg-emerald-400/70 border-emerald-500/60";
  return "bg-emerald-500/80 border-emerald-600/70";
}

function findUnfulfilledDate(blocks: Block[]): string | null {
  const sorted = [...blocks].sort(
    (a, b) => parseDateUTC(a.startDate).getTime() - parseDateUTC(b.startDate).getTime()
  );
  const budgetPerParent = new Map<string, number>();
  for (const b of sorted) {
    if (!budgetPerParent.has(b.parentId)) budgetPerParent.set(b.parentId, 240);
  }
  for (const b of sorted) {
    const start = parseDateUTC(b.startDate);
    const end = parseDateUTC(b.endDate);
    const totalMs = end.getTime() - start.getTime();
    if (totalMs <= 0) continue;
    const weeks = totalMs / (7 * 86400000);
    const totalDays = Math.round(weeks * b.daysPerWeek);
    const remaining = budgetPerParent.get(b.parentId) ?? 0;
    if (totalDays > remaining && remaining >= 0) {
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

const LABEL_WIDTH = 140;
const MIN_MONTH_WIDTH = 56;

const PlanTimeline = ({ blocks, parents, unfulfilledDaysTotal, onBlockClick }: Props) => {
  const validBlocks = blocks.filter((b) => b.startDate && b.endDate && b.endDate >= b.startDate);

  const { timelineStart, totalMs, months } = useMemo(() => {
    if (validBlocks.length === 0) return { timelineStart: 0, totalMs: 1, months: [] as MonthInfo[] };
    const starts = validBlocks.map((b) => parseDateUTC(b.startDate).getTime());
    const ends = validBlocks.map((b) => parseDateUTC(b.endDate).getTime());
    const minStart = Math.min(...starts);
    const maxEnd = Math.max(...ends);
    return {
      timelineStart: minStart,
      totalMs: maxEnd - minStart || 1,
      months: getMonths(new Date(minStart), new Date(maxEnd)),
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

  const timelineWidth = Math.max(months.length * MIN_MONTH_WIDTH, 400);

  return (
    <div className="border border-border rounded-lg bg-card overflow-x-auto">
        <div className="flex" style={{ minWidth: LABEL_WIDTH + timelineWidth }}>
          {/* Left label column */}
          <div className="flex-shrink-0" style={{ width: LABEL_WIDTH }}>
            {/* Year row spacer */}
            <div className="h-5" />
            {/* Month row spacer */}
            <div className="h-5" />
            {/* Parent rows */}
            {parentRows.map((row) => (
              <div key={row.id} className="h-9 flex items-center px-3">
                <span className="text-xs font-medium text-muted-foreground truncate">{row.name}</span>
              </div>
            ))}
            {/* Unfulfilled label spacer */}
            {unfulfilledPct !== null && <div className="h-5" />}
          </div>

          {/* Timeline area */}
          <div className="flex-1 relative" style={{ width: timelineWidth }}>
            {/* Year markers */}
            <div className="flex h-5">
              {months.map((m) => (
                <div
                  key={m.key}
                  className="text-center text-[10px] font-semibold text-muted-foreground"
                  style={{ width: `${100 / months.length}%` }}
                >
                  {m.isFirstOfYear ? m.year : ""}
                </div>
              ))}
            </div>

            {/* Month labels */}
            <div className="flex h-5 border-b border-border">
              {months.map((m) => (
                <div
                  key={m.key}
                  className="text-center text-[10px] text-muted-foreground"
                  style={{ width: `${100 / months.length}%` }}
                >
                  {m.label}
                </div>
              ))}
            </div>

            {/* Parent rows with blocks */}
            <div className="relative">
              {parentRows.map((row) => (
                <div key={row.id} className="relative h-9 bg-muted/30">
                  {row.blocks.map((b) => {
                    const startMs = parseDateUTC(b.startDate).getTime();
                    const endMs = parseDateUTC(b.endDate).getTime();
                    const left = ((startMs - timelineStart) / totalMs) * 100;
                    const width = Math.max(((endMs - startMs) / totalMs) * 100, 2);
                    return (
                      <div
                        key={b.id}
                        className={`absolute top-1 bottom-1 rounded border text-[11px] font-medium flex items-center justify-center text-foreground/80 ${getIntensityClass(b.parentId, b.daysPerWeek)} ${onBlockClick ? "cursor-pointer hover:ring-2 hover:ring-ring transition-shadow" : ""}`}
                        style={{ left: `${left}%`, width: `${width}%`, minWidth: 32 }}
                        onClick={() => onBlockClick?.(b.id)}
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
                        className="absolute top-0 w-0.5 bg-destructive z-20 cursor-help"
                        style={{
                          left: `${Math.min(unfulfilledPct, 100)}%`,
                          height: `${parentRows.length * 36}px`,
                        }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Här tar dagarna slut</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>

            {/* Unfulfilled label row */}
            {unfulfilledPct !== null && (
              <div className="relative h-5">
                <span
                  className="absolute text-[10px] font-medium text-destructive whitespace-nowrap"
                  style={{ left: `${Math.min(unfulfilledPct, 95)}%`, transform: "translateX(-50%)" }}
                >
                  Dagarna tar slut
                </span>
              </div>
            )}
          </div>
        </div>
    </div>
  );
};

export default PlanTimeline;
