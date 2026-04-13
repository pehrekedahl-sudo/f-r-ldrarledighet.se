/**
 * FK-guide diff logic: compares current plan steps against a saved baseline
 * to determine what needs to be updated at Försäkringskassan.
 */

export type FKStep = {
  key: string;
  parentId: string;
  parentName: string;
  startDate: string;
  endDate: string;
  daysPerWeek: number;
  level: "Sjukpenningnivå" | "Lägstanivå";
  isOverlap?: boolean;
};

export type DiffStatus = "unchanged" | "new" | "changed" | "removed";

export type DiffStep = {
  step: FKStep;
  status: DiffStatus;
  /** For "changed" steps, describes what changed */
  changeDescription?: string;
  /** For "removed" steps, the baseline step that needs cancelling */
  baselineStep?: FKStep;
};

/** Canonical key for matching steps across plan versions (parent + level + rough position) */
function matchKey(s: FKStep): string {
  return `${s.parentId}|${s.level}|${s.startDate}`;
}

export function computeDiff(current: FKStep[], baseline: FKStep[]): DiffStep[] {
  const baseMap = new Map<string, FKStep>();
  for (const b of baseline) {
    baseMap.set(matchKey(b), b);
  }

  const matchedBaseKeys = new Set<string>();
  const result: DiffStep[] = [];

  // Check current steps against baseline
  for (const step of current) {
    const mk = matchKey(step);
    const base = baseMap.get(mk);

    if (!base) {
      result.push({ step, status: "new" });
    } else {
      matchedBaseKeys.add(mk);
      const changes: string[] = [];
      if (base.endDate !== step.endDate) {
        changes.push(`slutdatum ${base.endDate} → ${step.endDate}`);
      }
      if (base.daysPerWeek !== step.daysPerWeek) {
        changes.push(`${base.daysPerWeek} → ${step.daysPerWeek} d/v`);
      }
      if (base.level !== step.level) {
        changes.push(`${base.level} → ${step.level}`);
      }

      if (changes.length > 0) {
        result.push({ step, status: "changed", changeDescription: changes.join(", "), baselineStep: base });
      } else {
        result.push({ step, status: "unchanged" });
      }
    }
  }

  // Steps in baseline but not in current → removed
  for (const b of baseline) {
    if (!matchedBaseKeys.has(matchKey(b))) {
      result.push({ step: b, status: "removed", baselineStep: b });
    }
  }

  return result;
}

export function hasChanges(diff: DiffStep[]): boolean {
  return diff.some(d => d.status !== "unchanged");
}

// localStorage helpers for baseline
const BASELINE_PREFIX = "fk_baseline_";

export function saveBaseline(planKey: string, steps: FKStep[]): void {
  try {
    localStorage.setItem(BASELINE_PREFIX + planKey, JSON.stringify(steps));
  } catch { /* quota exceeded – ignore */ }
}

export function loadBaseline(planKey: string): FKStep[] | null {
  try {
    const raw = localStorage.getItem(BASELINE_PREFIX + planKey);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupt data */ }
  return null;
}

export function clearBaseline(planKey: string): void {
  localStorage.removeItem(BASELINE_PREFIX + planKey);
}
