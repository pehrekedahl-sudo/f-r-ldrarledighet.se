import { useMemo } from "react";
import { addDays, compareDates, toEpochMs, getYear, getMonthIndex, startOfNextMonth } from "@/utils/dateOnly";

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

type MonthBoundary = {
  pct: number;
  label: string;
  year: number;
  isFirstOfYear: boolean;
  index: number;
  total: number;
};

const SHORT_MONTH_NAMES = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

function getMonthBoundaries(startDate: string, endDate: string, startMs: number, totalMs: number): MonthBoundary[] {
  const boundaries: MonthBoundary[] = [];

  // Add start month as first boundary at 0%
  let prevYear = getYear(startDate);
  boundaries.push({
    pct: 0,
    label: SHORT_MONTH_NAMES[getMonthIndex(startDate)],
    year: prevYear,
    isFirstOfYear: true,
    index: 0,
    total: 0,
  });

  // Iterate through month boundaries
  let cur = startOfNextMonth(startDate);
  let idx = 1;

  while (compareDates(cur, endDate) <= 0) {
    const curMs = toEpochMs(cur);
    const pct = ((curMs - startMs) / totalMs) * 100;
    const y = getYear(cur);
    boundaries.push({
      pct,
      label: SHORT_MONTH_NAMES[getMonthIndex(cur)],
      year: y,
      isFirstOfYear: y !== prevYear,
      index: idx,
      total: 0,
    });
    prevYear = y;
    idx++;
    cur = startOfNextMonth(cur);
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
    if (daysPerWeek <= 4) return "bg-blue-200 border-blue-300 text-blue-900";
    if (daysPerWeek === 5) return "bg-blue-400 border-blue-500 text-white";
    return "bg-blue-600 border-blue-700 text-white";
  }
  if (daysPerWeek <= 4) return "bg-emerald-200 border-emerald-300 text-emerald-900";
  if (daysPerWeek === 5) return "bg-emerald-400 border-emerald-500 text-white";
  return "bg-emerald-600 border-emerald-700 text-white";
}

function findUnfulfilledDate(blocks: Block[]): string | null {
  const sorted = [...blocks].sort((a, b) => compareDates(a.startDate, b.startDate));
  const budgetPerParent = new Map<string, number>();
  for (const b of sorted) {
    if (!budgetPerParent.has(b.parentId)) budgetPerParent.set(b.parentId, 240);
  }
  for (const b of sorted) {
    const startMs = toEpochMs(b.startDate);
    const endMs = toEpochMs(b.endDate);
    const totalMs = endMs - startMs;
    if (totalMs <= 0) continue;
    const weeks = totalMs / (7 * 86400000);
    const totalDays = Math.round(weeks * b.daysPerWeek);
    const remaining = budgetPerParent.get(b.parentId) ?? 0;
    if (totalDays > remaining && remaining >= 0) {
      const daysPerDay = b.daysPerWeek / 7;
      const daysUntilEmpty = daysPerDay > 0 ? remaining / daysPerDay : 0;
      // Use addDays to compute cutoff from startDate
      const cutoffDays = Math.floor(daysUntilEmpty);
      return addDays(b.startDate, cutoffDays);
    }
    budgetPerParent.set(b.parentId, remaining - totalDays);
  }
  return null;
}

const LABEL_WIDTH = 140;

const PlanTimeline = ({ blocks, parents, unfulfilledDaysTotal, onBlockClick }: Props) => {
  const validBlocks = blocks.filter((b) => b.startDate && b.endDate && compareDates(b.endDate, b.startDate) >= 0);

  const { timelineStartMs, totalMs, monthBoundaries } = useMemo(() => {
    if (validBlocks.length === 0) return { timelineStartMs: 0, totalMs: 1, monthBoundaries: [] as MonthBoundary[] };
    const starts = validBlocks.map((b) => toEpochMs(b.startDate));
    const ends = validBlocks.map((b) => toEpochMs(b.endDate));
    const minStart = Math.min(...starts);
    const maxEnd = Math.max(...ends);
    // Find the actual date strings for boundaries
    const minStartDate = validBlocks.reduce((min, b) => compareDates(b.startDate, min) < 0 ? b.startDate : min, validBlocks[0].startDate);
    const maxEndDate = validBlocks.reduce((max, b) => compareDates(b.endDate, max) > 0 ? b.endDate : max, validBlocks[0].endDate);
    return {
      timelineStartMs: minStart,
      totalMs: maxEnd - minStart || 1,
      monthBoundaries: getMonthBoundaries(minStartDate, maxEndDate, minStart, maxEnd - minStart || 1),
    };
  }, [validBlocks]);

  const unfulfilledDate = useMemo(() => {
    if (unfulfilledDaysTotal <= 0) return null;
    return findUnfulfilledDate(validBlocks);
  }, [unfulfilledDaysTotal, validBlocks]);

  const unfulfilledPct = useMemo(() => {
    if (!unfulfilledDate) return null;
    const d = toEpochMs(unfulfilledDate);
    return ((d - timelineStartMs) / totalMs) * 100;
  }, [unfulfilledDate, timelineStartMs, totalMs]);

  // Compute transition lines: where one parent's block ends ±1 day of another's start
  const transitionPcts = useMemo(() => {
    if (validBlocks.length < 2) return [];
    const edges: { parentId: string; date: string; type: "start" | "end" }[] = [];
    for (const b of validBlocks) {
      edges.push({ parentId: b.parentId, date: b.startDate, type: "start" });
      edges.push({ parentId: b.parentId, date: b.endDate, type: "end" });
    }
    const pcts: number[] = [];
    const seen = new Set<string>();
    for (const e of edges) {
      if (e.type !== "end") continue;
      const eMs = toEpochMs(e.date);
      for (const s of edges) {
        if (s.type !== "start" || s.parentId === e.parentId) continue;
        const sMs = toEpochMs(s.date);
        const diff = Math.abs(sMs - eMs);
        if (diff <= 86400000) {
          const midMs = Math.round((eMs + sMs) / 2);
          const pct = ((midMs - timelineStartMs) / totalMs) * 100;
          const key = pct.toFixed(2);
          if (!seen.has(key)) {
            seen.add(key);
            pcts.push(pct);
          }
        }
      }
    }
    return pcts;
  }, [validBlocks, timelineStartMs, totalMs]);

  if (validBlocks.length === 0) return null;

  const parentRows = parents.map((p) => ({
    ...p,
    blocks: validBlocks.filter((b) => b.parentId === p.id),
  }));

  const rowHeight = 48;
  const totalRowHeight = parentRows.length * rowHeight;

  return (
    <div className="border border-border rounded-lg bg-card w-full">
      <div className="flex w-full">
        {/* Fixed label column */}
        <div className="flex-shrink-0" style={{ width: LABEL_WIDTH }}>
          <div className="h-8" />
          {parentRows.map((row) => (
            <div key={row.id} className="flex items-center px-3" style={{ height: rowHeight }}>
              <span className="text-xs font-medium text-muted-foreground truncate">{row.name}</span>
            </div>
          ))}
          {unfulfilledPct !== null && <div className="h-6" />}
        </div>

        {/* Timeline area */}
        <div className="flex-1 min-w-0 relative">
          {/* Month/year header */}
          <div className="relative h-8 border-b border-border">
            {monthBoundaries.map((mb) => (
              <div key={mb.index} className="absolute top-0 bottom-0" style={{ left: `${mb.pct}%` }}>
                <div className="absolute top-4 bottom-0 w-px bg-border/60" />
                {mb.isFirstOfYear && (
                  <span className="absolute top-0 text-[9px] font-semibold text-muted-foreground/60 whitespace-nowrap" style={{ left: 2 }}>
                    {mb.year}
                  </span>
                )}
                {shouldShowLabel(mb) && (
                  <span className="absolute top-3.5 text-[9px] text-muted-foreground/80 whitespace-nowrap" style={{ left: 2 }}>
                    {mb.label}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Parent rows with blocks */}
          <div className="relative">
            {monthBoundaries.map((mb) =>
              mb.pct > 0 ? (
                <div key={`line-${mb.index}`} className="absolute top-0 w-px bg-border/30 z-0" style={{ left: `${mb.pct}%`, height: totalRowHeight }} />
              ) : null
            )}

            {transitionPcts.map((pct, i) => (
              <div key={`trans-${i}`} className="absolute top-0 z-10" style={{ left: `${pct}%`, height: totalRowHeight }}>
                <div className="w-px h-full border-l border-dashed border-foreground/15" />
              </div>
            ))}

            {parentRows.map((row) => (
              <div key={row.id} className="relative bg-muted/30" style={{ height: rowHeight }}>
                {row.blocks.map((b) => {
                  const bStartMs = toEpochMs(b.startDate);
                  const bEndMs = toEpochMs(b.endDate);
                  const left = ((bStartMs - timelineStartMs) / totalMs) * 100;
                  const width = Math.max(((bEndMs - bStartMs) / totalMs) * 100, 1.5);
                  return (
                    <div
                      key={b.id}
                      data-block-id={b.id}
                      data-parent-id={b.parentId}
                      className={`absolute top-1.5 bottom-1.5 rounded-[10px] border text-[10px] font-semibold flex items-center justify-center overflow-hidden shadow-sm ${getIntensityClass(b.parentId, b.daysPerWeek)} ${onBlockClick ? "cursor-pointer hover:ring-2 hover:ring-ring transition-shadow" : ""}`}
                      style={{ left: `${left}%`, width: `${width}%`, minWidth: 24 }}
                      onClick={() => {
                        console.log("CLICK block", { id: b.id, parentId: b.parentId, startDate: b.startDate, endDate: b.endDate, daysPerWeek: b.daysPerWeek });
                        onBlockClick?.(b.id);
                      }}
                    >
                      <span className="truncate px-1">{b.daysPerWeek}d/v</span>
                      <span className="absolute -bottom-3 left-0 text-[7px] font-mono text-muted-foreground/60 whitespace-nowrap pointer-events-none">
                        {b.id.slice(0, 8)}|{b.parentId}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}

            {unfulfilledPct !== null && (
              <div className="absolute z-20" style={{ left: `${Math.min(unfulfilledPct, 100)}%`, top: -6, height: totalRowHeight + 6 }}>
                <div className="w-[2px] h-full bg-destructive" />
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-destructive text-destructive-foreground text-[9px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap shadow-sm">
                  Dagarna tar slut
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlanTimeline;
