type ParentInput = {
  id: string;
  name: string;
  monthlyIncomeFixed: number; // brutto
  monthlyIncomeVariableAvg?: number; // brutto, snitt/mån
  has240Days: boolean;
};

type BlockInput = {
  id: string;
  parentId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (inclusive)
  daysPerWeek: number; // 0..7
  lowestDaysPerWeek?: number; // 0..7, optional, must be <= daysPerWeek
};

type TransferInput = {
  fromParentId: string;
  toParentId: string;
  sicknessDays: number; // allow decimals internally, UI uses integer
};

type Constants = {
  SGI_CAP_ANNUAL: number; // e.g. 592000 (config)
  LOWEST_LEVEL_DAILY_AMOUNT: number; // e.g. 180 (config)
  BASIC_LEVEL_DAILY_AMOUNT: number; // e.g. 250 (config)
  SICKNESS_RATE: number; // 0.8
  REDUCTION: number; // 0.97
  SICKNESS_DAILY_MAX?: number; // optional, if you prefer cap per day
};

type MonthlyRow = {
  monthKey: string; // YYYY-MM
  sicknessDays: number;
  lowestDays: number;
  grossAmount: number;
};

type ParentResult = {
  parentId: string;
  name: string;
  rates: { dailySickness: number; dailyLowest: number };
  remaining: {
    sicknessTransferable: number;
    sicknessReserved: number;
    lowest: number;
  };
  taken: {
    sickness: number;
    lowest: number;
  };
  monthlyBreakdown: MonthlyRow[];
};

type SimResult = {
  parentsResult: ParentResult[];
  warnings: {
    budgetInsufficient: boolean;
    overrideAdjusted: boolean;
  };
  validationErrors: any[]; // keep flexible
  unfulfilledDaysTotal: number;
};

type PlanInput = {
  parents: ParentInput[];
  blocks: BlockInput[];
  transfers?: TransferInput[];
  constants: Constants;
};

// ---------- date helpers ----------
function parseDateUTC(iso: string): Date {
  // Force UTC midnight to avoid timezone issues
  return new Date(iso + "T00:00:00Z");
}

function diffDaysInclusive(startISO: string, endISO: string): number {
  const s = parseDateUTC(startISO).getTime();
  const e = parseDateUTC(endISO).getTime();
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((e - s) / msPerDay) + 1;
}

function monthKeyOf(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

function endOfMonthISO(dateISO: string): string {
  const d = parseDateUTC(dateISO);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-based
  // last day of month: day 0 of next month
  const last = new Date(Date.UTC(year, month + 1, 0));
  const yyyy = last.getUTCFullYear();
  const mm = String(last.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(last.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(dateISO: string, days: number): string {
  const d = parseDateUTC(dateISO);
  d.setUTCDate(d.getUTCDate() + days);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function splitIntoMonthSegments(
  startISO: string,
  endISO: string,
): Array<{ segStart: string; segEnd: string; monthKey: string }> {
  const segments: Array<{ segStart: string; segEnd: string; monthKey: string }> = [];
  let curStart = startISO;

  while (true) {
    const curMonthEnd = endOfMonthISO(curStart);
    const segEnd = parseDateUTC(curMonthEnd) <= parseDateUTC(endISO) ? curMonthEnd : endISO;
    segments.push({ segStart: curStart, segEnd, monthKey: monthKeyOf(curStart) });
    if (segEnd === endISO) break;
    curStart = addDaysISO(segEnd, 1);
  }
  return segments;
}

// ---------- math helpers ----------
const EPS = 1e-6;

function fractionTaken(calendarDays: number, daysPerWeek: number): number {
  return calendarDays * (daysPerWeek / 7);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ---------- rates ----------
function calcDailyRates(parent: ParentInput, c: Constants): { dailySickness: number; dailyLowest: number } {
  const variable = parent.monthlyIncomeVariableAvg ?? 0;
  const monthlyIncome = parent.monthlyIncomeFixed + variable;
  const annualIncome = monthlyIncome * 12;
  const annualCapped = Math.min(annualIncome, c.SGI_CAP_ANNUAL);

  let dailySickness: number;
  if (!parent.has240Days) {
    dailySickness = c.BASIC_LEVEL_DAILY_AMOUNT;
  } else {
    dailySickness = (annualCapped * c.SICKNESS_RATE * c.REDUCTION) / 365;
    if (typeof c.SICKNESS_DAILY_MAX === "number") {
      dailySickness = Math.min(dailySickness, c.SICKNESS_DAILY_MAX);
    }
  }

  return { dailySickness, dailyLowest: c.LOWEST_LEVEL_DAILY_AMOUNT };
}

// ---------- simulate ----------
export function simulatePlan(plan: PlanInput): SimResult {
  const { parents, blocks, transfers = [], constants } = plan;

  const result: SimResult = {
    parentsResult: [],
    warnings: { budgetInsufficient: false, overrideAdjusted: false },
    validationErrors: [],
    unfulfilledDaysTotal: 0,
  };

  // V1 constraint: max 8 blocks
  if (blocks.length > 8) {
    result.validationErrors.push({ type: "tooManyBlocks", max: 8, actual: blocks.length });
  }

  // Validate blocks
  for (const b of blocks) {
    if (b.daysPerWeek < 0 || b.daysPerWeek > 7) {
      result.validationErrors.push({ type: "invalidDaysPerWeek", blockId: b.id });
    }
    if (parseDateUTC(b.endDate) < parseDateUTC(b.startDate)) {
      result.validationErrors.push({ type: "invalidDateRange", blockId: b.id });
    }
    if (b.lowestDaysPerWeek !== undefined) {
      if (b.lowestDaysPerWeek < 0 || b.lowestDaysPerWeek > 7) {
        result.validationErrors.push({ type: "invalidLowestDaysPerWeek", blockId: b.id });
      }
      if (b.lowestDaysPerWeek > b.daysPerWeek) {
        result.validationErrors.push({ type: "lowestExceedsTotal", blockId: b.id });
      }
    }
  }

  // Build quick lookup
  const parentById = new Map<string, ParentInput>();
  for (const p of parents) parentById.set(p.id, p);

  // Validate parent existence on blocks
  for (const b of blocks) {
    if (!parentById.has(b.parentId)) {
      result.validationErrors.push({ type: "unknownParentOnBlock", blockId: b.id, parentId: b.parentId });
    }
  }

  // Overlap within same parent validation (stop early if present)
  const blocksByParent = new Map<string, BlockInput[]>();
  for (const b of blocks) {
    if (!blocksByParent.has(b.parentId)) blocksByParent.set(b.parentId, []);
    blocksByParent.get(b.parentId)!.push(b);
  }
  for (const [pid, arr] of blocksByParent.entries()) {
    const sorted = [...arr].sort((a, b) => parseDateUTC(a.startDate).getTime() - parseDateUTC(b.startDate).getTime());
    for (let i = 0; i < sorted.length - 1; i++) {
      if (parseDateUTC(sorted[i].endDate) >= parseDateUTC(sorted[i + 1].startDate)) {
        result.validationErrors.push({
          type: "overlapWithinSameParent",
          parentId: pid,
          blockA: sorted[i].id,
          blockB: sorted[i + 1].id,
        });
      }
    }
  }
  if (result.validationErrors.some((e) => e.type === "overlapWithinSameParent")) {
    return result;
  }

  // Initialize per-parent state (V1 standard budgets)
  type ParentState = {
    parentId: string;
    name: string;
    rates: { dailySickness: number; dailyLowest: number };
    remaining: { sicknessTransferable: number; sicknessReserved: number; lowest: number };
    taken: { sickness: number; lowest: number };
    monthly: Map<string, { sicknessDays: number; lowestDays: number; gross: number }>;
  };

  const state = new Map<string, ParentState>();

  for (const p of parents) {
    state.set(p.id, {
      parentId: p.id,
      name: p.name,
      rates: calcDailyRates(p, constants),
      remaining: {
        sicknessTransferable: 105, // V1: 195 total sickness - 90 reserved
        sicknessReserved: 90, // V1
        lowest: 45, // V1
      },
      taken: { sickness: 0, lowest: 0 },
      monthly: new Map(),
    });
  }

  // Apply transfers upfront
  for (const t of transfers) {
    const from = state.get(t.fromParentId);
    const to = state.get(t.toParentId);
    if (!from || !to) {
      result.validationErrors.push({ type: "unknownParentOnTransfer", transfer: t });
      continue;
    }
    if (t.sicknessDays < 0) {
      result.validationErrors.push({ type: "invalidTransferAmount", transfer: t });
      continue;
    }
    if (from.remaining.sicknessTransferable < t.sicknessDays) {
      result.validationErrors.push({ type: "transferExceedsAvailable", transfer: t });
      continue;
    }
    from.remaining.sicknessTransferable -= t.sicknessDays;
    to.remaining.sicknessTransferable += t.sicknessDays;
  }
  if (result.validationErrors.some((e) => e.type === "transferExceedsAvailable")) {
    return result;
  }

  // Simulate blocks in time order
  const sortedBlocks = [...blocks].sort(
    (a, b) => parseDateUTC(a.startDate).getTime() - parseDateUTC(b.startDate).getTime(),
  );

  for (const b of sortedBlocks) {
    const p = state.get(b.parentId);
    if (!p) continue;

    const calendarDays = diffDaysInclusive(b.startDate, b.endDate);
    const totalRequested = fractionTaken(calendarDays, b.daysPerWeek);

    if (totalRequested <= 0) continue;

    const hasManualLowest = b.lowestDaysPerWeek !== undefined;

    // Requested split
    let requestedLowest = 0;
    let requestedSickness = totalRequested;

    if (hasManualLowest) {
      requestedLowest = fractionTaken(calendarDays, clamp(b.lowestDaysPerWeek!, 0, 7));
      requestedLowest = Math.min(requestedLowest, totalRequested); // safety
      requestedSickness = totalRequested - requestedLowest;
    }

    // Allocation (auto-adjust, never go negative)
    let actualLowest = 0;
    let actualSickness = 0;

    // Manual lowest: try fulfill lowest first, shortfall becomes sickness
    if (hasManualLowest) {
      const takeL = Math.min(p.remaining.lowest, requestedLowest);
      actualLowest += takeL;
      p.remaining.lowest -= takeL;

      if (takeL < requestedLowest) {
        result.warnings.overrideAdjusted = true;
        const short = requestedLowest - takeL;
        requestedSickness += short;
      }
    }

    // Take sickness from transferable then reserved
    let needS = requestedSickness;

    const takeT = Math.min(p.remaining.sicknessTransferable, needS);
    actualSickness += takeT;
    p.remaining.sicknessTransferable -= takeT;
    needS -= takeT;

    const takeR = Math.min(p.remaining.sicknessReserved, needS);
    actualSickness += takeR;
    p.remaining.sicknessReserved -= takeR;
    needS -= takeR;

    // If auto mode (no manual lowest): spill remaining sickness need into lowest
    if (!hasManualLowest && needS > 0) {
      const takeL2 = Math.min(p.remaining.lowest, needS);
      actualLowest += takeL2;
      p.remaining.lowest -= takeL2;
      needS -= takeL2;
    }

    // If still needS > 0 => budget insufficient (unfulfilled)
    const totalActual = actualSickness + actualLowest;
    const rawUnfulfilled = Math.max(0, totalRequested - totalActual);
    const unfulfilled = rawUnfulfilled < EPS ? 0 : rawUnfulfilled;
    if (unfulfilled > EPS) {
      result.warnings.budgetInsufficient = true;
      result.unfulfilledDaysTotal += unfulfilled;
    }

    // Update totals
    p.taken.sickness += actualSickness;
    p.taken.lowest += actualLowest;

    // Monthly breakdown
    const segments = splitIntoMonthSegments(b.startDate, b.endDate);

    for (const seg of segments) {
      const segDays = diffDaysInclusive(seg.segStart, seg.segEnd);
      const segRequested = fractionTaken(segDays, b.daysPerWeek);

      if (segRequested <= 0) continue;

      let segSickness = 0;
      let segLowest = 0;

      if (hasManualLowest) {
        // manual split per block => per segment with same rule
        const segLowestReq = fractionTaken(segDays, b.lowestDaysPerWeek!);
        // But actual might be lower if overrideAdjusted, so scale by actual proportions:
        // Use block actual proportions to keep month sums consistent with actual consumption.
        if (totalActual > 0) {
          const sicknessShare = actualSickness / totalActual;
          const lowestShare = actualLowest / totalActual;
          segSickness = segRequested * sicknessShare;
          segLowest = segRequested * lowestShare;
        } else {
          segSickness = 0;
          segLowest = 0;
        }
      } else {
        // auto => allocate by actual proportions
        if (totalActual > 0) {
          const sicknessShare = actualSickness / totalActual;
          const lowestShare = actualLowest / totalActual;
          segSickness = segRequested * sicknessShare;
          segLowest = segRequested * lowestShare;
        }
      }

      const gross = segSickness * p.rates.dailySickness + segLowest * p.rates.dailyLowest;

      const prev = p.monthly.get(seg.monthKey) ?? { sicknessDays: 0, lowestDays: 0, gross: 0 };
      prev.sicknessDays += segSickness;
      prev.lowestDays += segLowest;
      prev.gross += gross;
      p.monthly.set(seg.monthKey, prev);
    }
  }

  // Build output
  for (const p of state.values()) {
    const monthlyBreakdown: MonthlyRow[] = Array.from(p.monthly.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([monthKey, v]) => ({
        monthKey,
        sicknessDays: v.sicknessDays,
        lowestDays: v.lowestDays,
        grossAmount: v.gross,
      }));

    result.parentsResult.push({
      parentId: p.parentId,
      name: p.name,
      rates: p.rates,
      remaining: p.remaining,
      taken: p.taken,
      monthlyBreakdown,
    });
  }

  return result;
}
