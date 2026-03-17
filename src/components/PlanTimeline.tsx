import { useMemo, useState } from "react";
import { addDays, compareDates, toEpochMs, getYear, getMonthIndex, startOfNextMonth, isoWeekdayIndex } from "@/utils/dateOnly";

type Block = {
  id: string;
  parentId: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  lowestDaysPerWeek?: number;
  isOverlap?: boolean;
  _originalId?: string;
};

type Parent = {
  id: string;
  name: string;
};

type Props = {
  blocks: Block[];
  parents: Parent[];
  unfulfilledDaysTotal: number;
  todayDate?: string;
  onBlockClick?: (blockId: string) => void;
  onDeleteOverlap?: (blockId: string) => void;
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

  let prevYear = getYear(startDate);
  boundaries.push({
    pct: 0,
    label: SHORT_MONTH_NAMES[getMonthIndex(startDate)],
    year: prevYear,
    isFirstOfYear: true,
    index: 0,
    total: 0,
  });

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
    return "bg-[#4A9B8E] border-[#3d8a7d] text-white hover:bg-[#3d8a7d]";
  }
  return "bg-[#E8735A] border-[#d4614b] text-white hover:bg-[#d4614b]";
}

function countWorkingDays(startDate: string, endDate: string): number {
  let count = 0;
  for (let d = startDate; compareDates(d, endDate) <= 0; d = addDays(d, 1)) {
    if (isoWeekdayIndex(d) < 5) count++;
  }
  return count;
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
      const cutoffDays = Math.floor(daysUntilEmpty);
      return addDays(b.startDate, cutoffDays);
    }
    budgetPerParent.set(b.parentId, remaining - totalDays);
  }
  return null;
}

const LABEL_WIDTH = 140;

const PlanTimeline = ({ blocks, parents, unfulfilledDaysTotal, todayDate, onBlockClick, onDeleteOverlap }: Props) => {
  const [hoveredOverlap, setHoveredOverlap] = useState<string | null>(null);

  const regularBlocks = blocks.filter((b) => !b.isOverlap);
  const overlapBlocks = blocks.filter((b) => b.isOverlap);

  const validBlocks = regularBlocks.filter((b) => b.startDate && b.endDate && compareDates(b.endDate, b.startDate) >= 0);
  const validOverlaps = overlapBlocks.filter((b) => b.startDate && b.endDate && compareDates(b.endDate, b.startDate) >= 0);

  const allValidBlocks = [...validBlocks, ...validOverlaps];

  const { timelineStartMs, totalMs, monthBoundaries } = useMemo(() => {
    if (allValidBlocks.length === 0) return { timelineStartMs: 0, totalMs: 1, monthBoundaries: [] as MonthBoundary[] };
    const starts = allValidBlocks.map((b) => toEpochMs(b.startDate));
    const ends = allValidBlocks.map((b) => toEpochMs(b.endDate));
    const minStart = Math.min(...starts);
    const maxEnd = Math.max(...ends);
    const minStartDate = allValidBlocks.reduce((min, b) => compareDates(b.startDate, min) < 0 ? b.startDate : min, allValidBlocks[0].startDate);
    const maxEndDate = allValidBlocks.reduce((max, b) => compareDates(b.endDate, max) > 0 ? b.endDate : max, allValidBlocks[0].endDate);
    return {
      timelineStartMs: minStart,
      totalMs: maxEnd - minStart || 1,
      monthBoundaries: getMonthBoundaries(minStartDate, maxEndDate, minStart, maxEnd - minStart || 1),
    };
  }, [allValidBlocks]);

  const unfulfilledDate = useMemo(() => {
    if (unfulfilledDaysTotal <= 0) return null;
    return findUnfulfilledDate(validBlocks);
  }, [unfulfilledDaysTotal, validBlocks]);

  const unfulfilledPct = useMemo(() => {
    if (!unfulfilledDate) return null;
    const d = toEpochMs(unfulfilledDate);
    return ((d - timelineStartMs) / totalMs) * 100;
  }, [unfulfilledDate, timelineStartMs, totalMs]);

  const todayPct = useMemo(() => {
    if (!todayDate) return null;
    const tMs = toEpochMs(todayDate);
    if (tMs < timelineStartMs || tMs > timelineStartMs + totalMs) return null;
    return ((tMs - timelineStartMs) / totalMs) * 100;
  }, [todayDate, timelineStartMs, totalMs]);

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

  if (allValidBlocks.length === 0) return null;

  const clipBlocksForOverlaps = (parentBlocks: Block[], overlaps: Block[]): Block[] => {
    if (overlaps.length === 0) return parentBlocks;
    
    const result: Block[] = [];
    for (const b of parentBlocks) {
      let segments: { start: string; end: string }[] = [{ start: b.startDate, end: b.endDate }];
      
      for (const ov of overlaps) {
        const newSegments: { start: string; end: string }[] = [];
        for (const seg of segments) {
          if (compareDates(ov.endDate, seg.start) < 0 || compareDates(ov.startDate, seg.end) > 0) {
            newSegments.push(seg);
            continue;
          }
          if (compareDates(seg.start, ov.startDate) < 0) {
            newSegments.push({ start: seg.start, end: addDays(ov.startDate, -1) });
          }
          if (compareDates(seg.end, ov.endDate) > 0) {
            newSegments.push({ start: addDays(ov.endDate, 1), end: seg.end });
          }
        }
        segments = newSegments;
      }
      
      for (const seg of segments) {
        if (compareDates(seg.end, seg.start) >= 0) {
          result.push({ ...b, id: `${b.id}-clip-${seg.start}`, _originalId: b.id, startDate: seg.start, endDate: seg.end });
        }
      }
    }
    return result;
  };

  const parentRows = parents.map((p) => {
    const parentOverlaps = validOverlaps.filter((ov) => ov.parentId === p.id);
    const rawBlocks = validBlocks.filter((b) => b.parentId === p.id);
    return {
      ...p,
      blocks: clipBlocksForOverlaps(rawBlocks, parentOverlaps),
    };
  });

  const rowHeight = 60;
  const overlapRowHeight = 44;
  const hasOverlapRow = validOverlaps.length > 0;
  const totalRowHeight = parentRows.length * rowHeight + (hasOverlapRow ? overlapRowHeight : 0);

  return (
    <div className="rounded-xl border border-border bg-white shadow-sm w-full overflow-hidden">
      <div className="flex w-full">
        {/* Fixed label column */}
        <div className="flex-shrink-0 bg-muted/20" style={{ width: LABEL_WIDTH }}>
          <div className="h-8" />
          {parentRows.map((row) => {
            const isP1 = row.id === "p1";
            return (
              <div key={row.id} className="flex items-center gap-2 px-3" style={{ height: rowHeight }}>
                <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${isP1 ? "bg-[#4A9B8E]" : "bg-[#E8735A]"}`} />
                <span className={`text-xs font-semibold truncate ${isP1 ? "text-[#4A9B8E]" : "text-[#E8735A]"}`}>{row.name}</span>
              </div>
            );
          })}
          {hasOverlapRow && (
            <div className="flex items-center gap-2 px-3" style={{ height: overlapRowHeight }}>
             <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 bg-[#2D7A6F]" />
              <span className="text-xs font-semibold text-[#2D7A6F] truncate">Dubbeldagar</span>
            </div>
          )}
          {unfulfilledPct !== null && <div className="h-6" />}
        </div>

        {/* Timeline area */}
        <div className="flex-1 min-w-0 relative">
          {/* Month/year header */}
          <div className="relative h-8 border-b border-border/60">
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
                <div key={`line-${mb.index}`} className="absolute top-0 w-px bg-border/20 z-0" style={{ left: `${mb.pct}%`, height: totalRowHeight }} />
              ) : null
            )}

            {transitionPcts.map((pct, i) => (
              <div key={`trans-${i}`} className="absolute top-0 z-10" style={{ left: `${pct}%`, height: totalRowHeight }}>
                <div className="w-px h-full border-l border-dashed border-foreground/10" />
              </div>
            ))}

            {/* Today marker */}
            {todayPct !== null && (
              <div className="absolute top-0 z-20" style={{ left: `${todayPct}%`, height: totalRowHeight }}>
                <div className="w-0.5 h-full border-l-2 border-dashed border-amber-400/70" />
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 whitespace-nowrap shadow-sm">
                  Idag
                </div>
              </div>
            )}

            {parentRows.map((row) => (
              <div key={row.id} className="relative" style={{ height: rowHeight }}>
                {row.blocks.map((b) => {
                  const bStartMs = toEpochMs(b.startDate);
                  const bEndMs = toEpochMs(b.endDate);
                  const left = ((bStartMs - timelineStartMs) / totalMs) * 100;
                  const width = Math.max(((bEndMs - bStartMs) / totalMs) * 100, 1.5);
                  const workDays = countWorkingDays(b.startDate, b.endDate);
                  const tooltipText = `${b.startDate} → ${b.endDate}\n${b.daysPerWeek} d/v · ${workDays} arbetsdagar`;
                  return (
                    <div
                      key={b.id}
                      data-block-id={b.id}
                      data-parent-id={b.parentId}
                      title={tooltipText}
                      className={`absolute top-2 bottom-2 rounded-xl border text-[10px] font-semibold flex items-center justify-center overflow-hidden shadow-md ${getIntensityClass(b.parentId, b.daysPerWeek)} ${onBlockClick ? "cursor-pointer hover:ring-2 hover:ring-ring/50 hover:shadow-lg transition-all" : ""}`}
                      style={{ left: `${left}%`, width: `${width}%`, minWidth: 24 }}
                      onClick={() => {
                        onBlockClick?.(b._originalId ?? b.id);
                      }}
                    >
                      <span className="truncate px-1.5">{b.daysPerWeek}d/v</span>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Overlap row */}
            {hasOverlapRow && (
              <div className="relative border-t border-border/40 bg-purple-50/20" style={{ height: overlapRowHeight }}>
                {validOverlaps.map((b) => {
                  const bStartMs = toEpochMs(b.startDate);
                  const bEndMs = toEpochMs(b.endDate);
                  const left = ((bStartMs - timelineStartMs) / totalMs) * 100;
                  const width = Math.max(((bEndMs - bStartMs) / totalMs) * 100, 1.5);
                  const days = countWorkingDays(b.startDate, b.endDate);
                  const isHovered = hoveredOverlap === b.id;

                  return (
                    <div
                      key={b.id}
                      data-block-id={b.id}
                      data-overlap="true"
                      className="absolute top-1.5 bottom-1.5 rounded-lg border border-[#235f56] bg-[#2D7A6F] text-white text-[10px] font-semibold flex items-center justify-center overflow-hidden cursor-default group transition-all shadow-sm"
                      style={{ left: `${left}%`, width: `${width}%`, minWidth: 40 }}
                      onMouseEnter={() => setHoveredOverlap(b.id)}
                      onMouseLeave={() => setHoveredOverlap(null)}
                    >
                      <span className="truncate px-1">DD {days}d</span>
                      {onDeleteOverlap && (
                        <button
                          className={`absolute right-0.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white/30 hover:bg-destructive hover:text-destructive-foreground text-white flex items-center justify-center text-[9px] transition-opacity ${isHovered ? "opacity-100" : "opacity-0"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteOverlap(b.id);
                          }}
                          title="Ta bort dubbeldagar"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

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
