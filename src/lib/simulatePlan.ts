type ParentInput = {
  id: string;
  name: string;
  monthlyIncomeFixed: number;
  monthlyIncomeVariableAvg?: number;
  has240Days: boolean;
};

type BlockInput = {
  id: string;
  parentId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (inclusive)
  daysPerWeek: number; // 0..7 integer
  lowestDaysPerWeek?: number; // 0..7 integer, optional, <= daysPerWeek
};

type TransferInput = {
  fromParentId: string;
  toParentId: string;
  sicknessDays: number;
};

type Constants = {
  SGI_CAP_ANNUAL: number;
  LOWEST_LEVEL_DAILY_AMOUNT: number;
  BASIC_LEVEL_DAILY_AMOUNT: number;
  SICKNESS_RATE: number;
  REDUCTION: number;
  SICKNESS_DAILY_MAX?: number;
};

type MonthlyRow = {
  monthKey: string;
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
  validationErrors: any[];
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
  return new Date(iso + "T00:00:00Z");
}

function toISO(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Returns 0=Mon, 1=Tue, ..., 6=Sun (ISO weekday) */
function isoWeekday(d: Date): number {
  const jsDay = d.getUTCDay(); // 0=Sun
  return jsDay === 0 ? 6 : jsDay - 1;
}

// ---------- allocation helper ----------

type DayAllocation = "none" | "sickness" | "lowest";

type AllocatedDay = {
  date: string; // YYYY-MM-DD
  allocation: DayAllocation;
};

/**
 * Eligible weekdays by daysPerWeek: earliest days of the week first.
 * 0 → none, 1 → Mon, 2 → Mon,Tue, ..., 7 → Mon–Sun
 */
function eligibleWeekdays(daysPerWeek: number): number[] {
  // ISO weekday: 0=Mon,1=Tue,...,6=Sun
  const order = [0, 1, 2, 3, 4, 5, 6];
  return order.slice(0, daysPerWeek);
}

function allocateBlockDays(
  startISO: string,
  endISO: string,
  daysPerWeek: number,
  lowestDaysPerWeek?: number,
): AllocatedDay[] {
  if (daysPerWeek <= 0) return [];

  const eligible = new Set(eligibleWeekdays(daysPerWeek));
  const lowestEligible =
    lowestDaysPerWeek !== undefined && lowestDaysPerWeek > 0
      ? new Set(eligibleWeekdays(lowestDaysPerWeek))
      : null;

  const result: AllocatedDay[] = [];
  const start = parseDateUTC(startISO);
  const end = parseDateUTC(endISO);
  const cur = new Date(start);

  while (cur <= end) {
    const wd = isoWeekday(cur);
    const dateStr = toISO(cur);

    if (eligible.has(wd)) {
      if (lowestEligible && lowestEligible.has(wd)) {
        result.push({ date: dateStr, allocation: "lowest" });
      } else {
        result.push({ date: dateStr, allocation: "sickness" });
      }
    }

    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return result;
}

// ---------- rates ----------

function calcDailyRates(
  parent: ParentInput,
  c: Constants,
): { dailySickness: number; dailyLowest: number } {
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
    if (b.daysPerWeek < 0 || b.daysPerWeek > 7 || !Number.isInteger(b.daysPerWeek)) {
      result.validationErrors.push({ type: "invalidDaysPerWeek", blockId: b.id });
    }
    if (parseDateUTC(b.endDate) < parseDateUTC(b.startDate)) {
      result.validationErrors.push({ type: "invalidDateRange", blockId: b.id });
    }
    if (b.lowestDaysPerWeek !== undefined) {
      if (b.lowestDaysPerWeek < 0 || b.lowestDaysPerWeek > 7 || !Number.isInteger(b.lowestDaysPerWeek)) {
        result.validationErrors.push({ type: "invalidLowestDaysPerWeek", blockId: b.id });
      }
      if (b.lowestDaysPerWeek > b.daysPerWeek) {
        result.validationErrors.push({ type: "lowestExceedsTotal", blockId: b.id });
      }
    }
  }

  // Parent lookup
  const parentById = new Map<string, ParentInput>();
  for (const p of parents) parentById.set(p.id, p);

  for (const b of blocks) {
    if (!parentById.has(b.parentId)) {
      result.validationErrors.push({ type: "unknownParentOnBlock", blockId: b.id, parentId: b.parentId });
    }
  }

  // Overlap validation
  const blocksByParent = new Map<string, BlockInput[]>();
  for (const b of blocks) {
    if (!blocksByParent.has(b.parentId)) blocksByParent.set(b.parentId, []);
    blocksByParent.get(b.parentId)!.push(b);
  }
  for (const [pid, arr] of blocksByParent.entries()) {
    const sorted = [...arr].sort(
      (a, b) => parseDateUTC(a.startDate).getTime() - parseDateUTC(b.startDate).getTime(),
    );
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

  // Initialize per-parent state
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
      remaining: { sicknessTransferable: 105, sicknessReserved: 90, lowest: 45 },
      taken: { sickness: 0, lowest: 0 },
      monthly: new Map(),
    });
  }

  // Apply transfers
  for (const t of transfers) {
    const from = state.get(t.fromParentId);
    const to = state.get(t.toParentId);
    if (!from || !to) {
      result.validationErrors.push({ type: "unknownParentOnTransfer", transfer: t });
      continue;
    }
    const amount = Math.floor(t.sicknessDays);
    if (amount < 0) {
      result.validationErrors.push({ type: "invalidTransferAmount", transfer: t });
      continue;
    }
    if (from.remaining.sicknessTransferable < amount) {
      result.validationErrors.push({ type: "transferExceedsAvailable", transfer: t });
      continue;
    }
    from.remaining.sicknessTransferable -= amount;
    to.remaining.sicknessTransferable += amount;
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

    const allocated = allocateBlockDays(b.startDate, b.endDate, b.daysPerWeek, b.lowestDaysPerWeek);
    if (allocated.length === 0) continue;

    const hasManualLowest = b.lowestDaysPerWeek !== undefined;

    for (const day of allocated) {
      const mk = monthKeyOf(day.date);
      const bucket = p.monthly.get(mk) ?? { sicknessDays: 0, lowestDays: 0, gross: 0 };

      if (day.allocation === "lowest") {
        if (p.remaining.lowest > 0) {
          p.remaining.lowest -= 1;
          p.taken.lowest += 1;
          bucket.lowestDays += 1;
          bucket.gross += p.rates.dailyLowest;
        } else {
          // Lowest budget exhausted → unfulfilled
          result.warnings.overrideAdjusted = true;
          result.unfulfilledDaysTotal += 1;
        }
      } else {
        // sickness allocation (or auto mode)
        let fulfilled = false;

        if (p.remaining.sicknessReserved > 0) {
          p.remaining.sicknessReserved -= 1;
          fulfilled = true;
        } else if (p.remaining.sicknessTransferable > 0) {
          p.remaining.sicknessTransferable -= 1;
          fulfilled = true;
        } else if (!hasManualLowest && p.remaining.lowest > 0) {
          // Auto mode: spill into lowest
          p.remaining.lowest -= 1;
          p.taken.lowest += 1;
          bucket.lowestDays += 1;
          bucket.gross += p.rates.dailyLowest;
          p.monthly.set(mk, bucket);
          continue;
        }

        if (fulfilled) {
          p.taken.sickness += 1;
          bucket.sicknessDays += 1;
          bucket.gross += p.rates.dailySickness;
        } else {
          result.unfulfilledDaysTotal += 1;
        }
      }

      p.monthly.set(mk, bucket);
    }
  }

  // Set warning
  if (result.unfulfilledDaysTotal > 0) {
    result.warnings.budgetInsufficient = true;
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
