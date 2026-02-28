const DRAFT_KEY = "planBuilderDraftV1";
const PLAN_KEY = "planBuilderLastPlanV1";
const CURRENT_VERSION = 1;

export type PlanningMode = "quick" | "guided" | "advanced";

export type WizardDraft = {
  version: number;
  planningMode: PlanningMode | null;
  parent1Name: string;
  parent2Name: string;
  wantIncome: boolean | null;
  income1: string;
  income2: string;
  has240Days1: boolean;
  has240Days2: boolean;
  dueDate: string;
  preBirthChoice: "no" | "p1" | "p2" | null;
  preBirthDate: string | null; // ISO string
  months1: number;
  months2: number;
  daysPerWeek1: number;
  daysPerWeek2: number;
  savingPreset: string | null;
  savedDays: number;
  step: number;
};

export function saveWizardDraft(draft: Omit<WizardDraft, "version">) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, version: CURRENT_VERSION }));
  } catch { /* quota exceeded etc */ }
}

export function loadWizardDraft(): WizardDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== CURRENT_VERSION) return null;
    return parsed as WizardDraft;
  } catch {
    return null;
  }
}

export function savePlanInput(planInput: unknown) {
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify({ version: CURRENT_VERSION, data: planInput }));
  } catch { /* */ }
}

export function loadPlanInput(): unknown | null {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== CURRENT_VERSION) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function clearAllDrafts() {
  localStorage.removeItem(DRAFT_KEY);
  localStorage.removeItem(PLAN_KEY);
}
