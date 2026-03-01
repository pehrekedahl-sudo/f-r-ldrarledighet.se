import { useMemo } from "react";


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
    if (daysPerWeek <= 4) return "bg-blue-200 border-blue-300 text-blue-900";
    if (daysPerWeek === 5) return "bg-blue-400 border-blue-500 text-white";
    return "bg-blue-600 border-blue-700 text-white";
  }
  if (daysPerWeek <= 4) return "bg-emerald-200 border-emerald-300 text-emerald-900";
  if (daysPerWeek === 5) return "bg-emerald-400 border-emerald-500 text-white";
  return "bg-emerald-600 border-emerald-700 text-white";
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
      // Look for a start from a different parent within 1 day
      const endMs = parseDateUTC(e.date).getTime();
      for (const s of edges) {
        if (s.type !== "start" || s.parentId === e.parentId) continue;
        const startMs = parseDateUTC(s.date).getTime();
        const diff = Math.abs(startMs - endMs);
        if (diff <= 86400000) {
          const midMs = Math.round((endMs + startMs) / 2);
          const pct = ((midMs - timelineStart) / totalMs) * 100;
          const key = pct.toFixed(2);
          if (!seen.has(key)) {
            seen.add(key);
            pcts.push(pct);
          }
        }
      }
    }
    return pcts;
  }, [validBlocks, timelineStart, totalMs]);

  if (validBlocks.length === 0) return null;

  const parentRows = parents.map((p) => ({
    ...p,
    blocks: validBlocks.filter((b) => b.parentId === p.id),
  }));

  const rowHeight = 48; // Extra space for debug overlay
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
          {unfulfilledPct !== null && <div className="h-6" />}
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

            {/* Transition dividers between parents */}
            {transitionPcts.map((pct, i) => (
              <div
                key={`trans-${i}`}
                className="absolute top-0 z-10"
                style={{ left: `${pct}%`, height: totalRowHeight }}
              >
                <div className="w-px h-full border-l border-dashed border-foreground/15" />
              </div>
            ))}

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
                      {/* Debug overlay */}
                      <span className="absolute -bottom-3 left-0 text-[7px] font-mono text-muted-foreground/60 whitespace-nowrap pointer-events-none">
                        {b.id.slice(0, 8)}|{b.parentId}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Unfulfilled red line */}
            {unfulfilledPct !== null && (
              <div
                className="absolute z-20"
                style={{
                  left: `${Math.min(unfulfilledPct, 100)}%`,
                  top: -6,
                  height: totalRowHeight + 6,
                }}
              >
                {/* Red line - 2px thick */}
                <div className="w-[2px] h-full bg-destructive" />
                {/* Badge label positioned above */}
                <div
                  className="absolute -top-5 left-1/2 -translate-x-1/2 bg-destructive text-destructive-foreground text-[9px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap shadow-sm"
                >
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
