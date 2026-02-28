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

type MonthBoundary = {
  pct: number;
  label: string;
  year: number;
  isFirstOfYear: boolean;
  index: number;
  total: number;
};

function getMonthBoundaries(startMs: number, endMs: number, totalMs: number): MonthBoundary[] {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const shortNames = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const boundaries: MonthBoundary[] = [];

  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  let prevYear = start.getUTCFullYear();
  let idx = 0;

  // Add start month as first boundary at 0%
  boundaries.push({
    pct: 0,
    label: shortNames[start.getUTCMonth()],
    year: start.getUTCFullYear(),
    isFirstOfYear: true,
    index: idx,
    total: 0, // will be set after
  });
  idx++;

  while (cur <= end) {
    const pct = ((cur.getTime() - startMs) / totalMs) * 100;
    const y = cur.getUTCFullYear();
    boundaries.push({
      pct,
      label: shortNames[cur.getUTCMonth()],
      year: y,
      isFirstOfYear: y !== prevYear,
      index: idx,
      total: 0,
    });
    prevYear = y;
    idx++;
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }

  const total = boundaries.length;
  return boundaries.map((b) => ({ ...b, total }));
}

function shouldShowLabel(b: MonthBoundary): boolean {
  if (b.index === 0) return true;
  if (b.index === b.total - 1) return true;
  if (b.index % 3 === 0) return true;
  return false;
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

const PlanTimeline = ({ blocks, parents, unfulfilledDaysTotal, onBlockClick }: Props) => {
  const validBlocks = blocks.filter((b) => b.startDate && b.endDate && b.endDate >= b.startDate);

  const { timelineStart, totalMs, monthBoundaries } = useMemo(() => {
    if (validBlocks.length === 0) return { timelineStart: 0, totalMs: 1, monthBoundaries: [] as MonthBoundary[] };
    const starts = validBlocks.map((b) => parseDateUTC(b.startDate).getTime());
    const ends = validBlocks.map((b) => parseDateUTC(b.endDate).getTime());
    const minStart = Math.min(...starts);
    const maxEnd = Math.max(...ends);
    return {
      timelineStart: minStart,
      totalMs: maxEnd - minStart || 1,
      monthBoundaries: getMonthBoundaries(minStart, maxEnd, maxEnd - minStart || 1),
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

  const rowHeight = 36;
  const totalRowHeight = parentRows.length * rowHeight;

  return (
    <div className="border border-border rounded-lg bg-card w-full">
      <div className="flex w-full">
        {/* Fixed label column */}
        <div className="flex-shrink-0" style={{ width: LABEL_WIDTH }}>
          {/* Year + month header spacer */}
          <div className="h-8" />
          {/* Parent rows */}
          {parentRows.map((row) => (
            <div key={row.id} className="flex items-center px-3" style={{ height: rowHeight }}>
              <span className="text-xs font-medium text-muted-foreground truncate">{row.name}</span>
            </div>
          ))}
          {unfulfilledPct !== null && <div className="h-5" />}
        </div>

        {/* Timeline area - fully responsive */}
        <div className="flex-1 min-w-0 relative">
          {/* Month/year header */}
          <div className="relative h-8 border-b border-border">
            {monthBoundaries.map((mb) => (
              <div key={mb.index} className="absolute top-0 bottom-0" style={{ left: `${mb.pct}%` }}>
                {/* Vertical tick */}
                <div className="absolute top-4 bottom-0 w-px bg-border/60" />
                {/* Year label */}
                {mb.isFirstOfYear && (
                  <span
                    className="absolute top-0 text-[9px] font-semibold text-muted-foreground/60 whitespace-nowrap"
                    style={{ left: 2 }}
                  >
                    {mb.year}
                  </span>
                )}
                {/* Month label (sparse) */}
                {shouldShowLabel(mb) && (
                  <span
                    className="absolute top-3.5 text-[9px] text-muted-foreground/80 whitespace-nowrap"
                    style={{ left: 2 }}
                  >
                    {mb.label}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Parent rows with blocks */}
          <div className="relative">
            {/* Month boundary lines through rows */}
            {monthBoundaries.map((mb) =>
              mb.pct > 0 ? (
                <div
                  key={`line-${mb.index}`}
                  className="absolute top-0 w-px bg-border/30 z-0"
                  style={{ left: `${mb.pct}%`, height: totalRowHeight }}
                />
              ) : null
            )}

            {parentRows.map((row) => (
              <div key={row.id} className="relative bg-muted/30" style={{ height: rowHeight }}>
                {row.blocks.map((b) => {
                  const startMs = parseDateUTC(b.startDate).getTime();
                  const endMs = parseDateUTC(b.endDate).getTime();
                  const left = ((startMs - timelineStart) / totalMs) * 100;
                  const width = Math.max(((endMs - startMs) / totalMs) * 100, 1.5);
                  return (
                    <div
                      key={b.id}
                      className={`absolute top-1 bottom-1 rounded border text-[10px] font-medium flex items-center justify-center text-foreground/80 overflow-hidden ${getIntensityClass(b.parentId, b.daysPerWeek)} ${onBlockClick ? "cursor-pointer hover:ring-2 hover:ring-ring transition-shadow" : ""}`}
                      style={{ left: `${left}%`, width: `${width}%`, minWidth: 24 }}
                      onClick={() => onBlockClick?.(b.id)}
                    >
                      <span className="truncate px-0.5">{b.daysPerWeek}d/v</span>
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
                        height: totalRowHeight,
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
                className="absolute text-[9px] font-medium text-destructive whitespace-nowrap"
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
