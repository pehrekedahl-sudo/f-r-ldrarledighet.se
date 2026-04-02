import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { RotateCcw, Upload, Lightbulb } from "lucide-react";
import { saveWizardDraft, loadWizardDraft, clearAllDrafts } from "@/lib/persistence";
import { addDays, addMonths, diffDaysInclusive } from "@/utils/dateOnly";
import { computeBlockMonthlyBenefit } from "@/lib/fkConstants";

export type ScheduleSegment = {
  parentId: string;
  daysPerWeek: number;
  weeks: number;
};

export type WizardResult = {
  parent1Name: string;
  parent2Name: string;
  dueDate: string;
  months1: number;
  months2: number;
  daysPerWeek1: number;
  daysPerWeek2: number;
  savedDaysTarget: number;
  income1: number | null;
  income2: number | null;
  has240Days1: boolean;
  has240Days2: boolean;
  preBirthParent: string | null;
  preBirthWeeks: number;
  endDate1: string;
  endDate2: string;
  preBirthDate: string | null;
  schedule?: ScheduleSegment[];
};

type Props = {
  onComplete: (result: WizardResult) => void;
};

const TOTAL_STEPS = 5;

/** Approximate months between two YYYY-MM-DD dates */
function approxMonths(from: string, to: string): number {
  if (!from || !to) return 0;
  const days = diffDaysInclusive(from, to);
  return Math.max(0, Math.round(days / 30.44));
}

type DurationMode = "months" | "dates";

const OnboardingWizard = ({ onComplete }: Props) => {
  const draft = loadWizardDraft();
  const [step, setStep] = useState(draft?.step ?? 1);

  // Step 1: Names
  const [parent1Name, setParent1Name] = useState(draft?.parent1Name ?? "");
  const [parent2Name, setParent2Name] = useState(draft?.parent2Name ?? "");

  // Step 2: Due date + pre-birth
  const [dueDate, setDueDate] = useState(draft?.dueDate ?? "");
  const [preBirthChoice, setPreBirthChoice] = useState<"none" | "1week" | "custom">(draft?.preBirthChoice ?? "none");
  const [preBirthDate, setPreBirthDate] = useState(draft?.preBirthDate ?? "");

  // Step 3: Income (optional)
  const [wantIncome, setWantIncome] = useState<boolean | null>(draft?.wantIncome ?? null);
  const [income1, setIncome1] = useState(draft?.income1 ?? "");
  const [income2, setIncome2] = useState(draft?.income2 ?? "");
  const [has240Days1, setHas240Days1] = useState(draft?.has240Days1 ?? true);
  const [has240Days2, setHas240Days2] = useState(draft?.has240Days2 ?? true);

  // Step 4: Duration (months or end dates)
  const [months1, setMonths1] = useState(draft?.months1 ?? 6);
  const [months2, setMonths2] = useState(draft?.months2 ?? 6);
  const [endDate1, setEndDate1] = useState(draft?.endDate1 ?? "");
  const [endDate2, setEndDate2] = useState(draft?.endDate2 ?? "");
  const [durationMode, setDurationMode] = useState<DurationMode>(
    (draft?.endDate1 && draft.endDate1.length > 0) ? "dates" : "months"
  );

  // Step 5: Days per week
  const [daysPerWeek1, setDaysPerWeek1] = useState(draft?.daysPerWeek1 ?? 5);
  const [daysPerWeek2, setDaysPerWeek2] = useState(draft?.daysPerWeek2 ?? 5);
  const [showHelper, setShowHelper] = useState(false);
  const [selectedPreference, setSelectedPreference] = useState<string | null>(null);
  const [suggestedSchedule, setSuggestedSchedule] = useState<ScheduleSegment[] | null>(null);

  const [hasDraft] = useState(() => !!loadWizardDraft());

  const setDpw1 = (v: number) => setDaysPerWeek1(Math.round(Math.max(0, Math.min(7, v))));
  const setDpw2 = (v: number) => setDaysPerWeek2(Math.round(Math.max(0, Math.min(7, v))));

  /** Compute an optimal multi-block schedule that fills the budget evenly between parents. */
  const computeOptimalSchedule = (
    preference: "income" | "save" | "balanced",
    m1Val: number,
    m2Val: number
  ): ScheduleSegment[] => {
    const weeks1 = Math.round(m1Val * 4.33);
    const weeks2 = Math.round(m2Val * 4.33);
    const totalWeeks = weeks1 + weeks2;
    if (totalWeeks === 0) return [];

    let budget: number;
    switch (preference) {
      case "income": budget = 480; break;
      case "save": budget = 304; break;
      case "balanced": {
        const totalMonths = m1Val + m2Val;
        const durationRatio = Math.min(1, Math.max(0, (totalMonths - 6) / 18));
        const saveFraction = 0.5 - 0.2 * durationRatio;
        const balancedSaved = Math.round(176 * saveFraction);
        budget = 480 - balancedSaved;
        break;
      }
    }

    const baseRate = Math.min(7, Math.max(3, Math.floor(budget / totalWeeks)));
    const highRate = Math.min(7, baseRate + 1);
    const extraDays = budget - baseRate * totalWeeks;

    // Distribute extra days as +1 dpw weeks, split evenly between parents
    let extraWeeksTotal = Math.min(totalWeeks, Math.max(0, extraDays));

    // If baseRate is already at cap (7), no differentiation needed
    if (highRate === baseRate) extraWeeksTotal = 0;

    const extraWeeks1 = Math.min(weeks1, Math.ceil(extraWeeksTotal / 2));
    const extraWeeks2 = Math.min(weeks2, extraWeeksTotal - extraWeeks1);
    const segments: ScheduleSegment[] = [];

    // Parent 1 segments
    if (extraWeeks1 > 0 && highRate !== baseRate) {
      segments.push({ parentId: "p1", daysPerWeek: highRate, weeks: extraWeeks1 });
    }
    const remainWeeks1 = weeks1 - extraWeeks1;
    if (remainWeeks1 > 0) {
      segments.push({ parentId: "p1", daysPerWeek: baseRate, weeks: remainWeeks1 });
    }

    // Parent 2 segments
    if (extraWeeks2 > 0 && highRate !== baseRate) {
      segments.push({ parentId: "p2", daysPerWeek: highRate, weeks: extraWeeks2 });
    }
    const remainWeeks2 = weeks2 - extraWeeks2;
    if (remainWeeks2 > 0) {
      segments.push({ parentId: "p2", daysPerWeek: baseRate, weeks: remainWeeks2 });
    }

    return segments;
  };

  /** Summarize a schedule for a given parent */
  const summarizeParentSchedule = (schedule: ScheduleSegment[], parentId: string): string => {
    const segs = schedule.filter(s => s.parentId === parentId);
    if (segs.length === 0) return "–";
    if (segs.length === 1) return `${segs[0].daysPerWeek} d/v`;
    return segs.map(s => `${s.daysPerWeek} d/v i ${s.weeks}v`).join(" + ");
  };

  /** Compute total days consumed by a schedule */
  const scheduleTotalDays = (schedule: ScheduleSegment[]): number => {
    return schedule.reduce((sum, s) => sum + s.daysPerWeek * s.weeks, 0);
  };

  const applyPreference = (pref: "income" | "save" | "balanced") => {
    setSelectedPreference(pref);
    const m1 = durationMode === "dates" && dueDate && endDate1 ? approxMonths(dueDate, endDate1) : months1;
    const m2 = durationMode === "dates" && endDate1 && endDate2 ? approxMonths(endDate1, endDate2) : months2;
    const schedule = computeOptimalSchedule(pref, m1, m2);
    setSuggestedSchedule(schedule);

    // Also set slider values to the weighted average for each parent (visual hint)
    const p1Segs = schedule.filter(s => s.parentId === "p1");
    const p2Segs = schedule.filter(s => s.parentId === "p2");
    const avgDpw = (segs: ScheduleSegment[]) => {
      const totalW = segs.reduce((s, seg) => s + seg.weeks, 0);
      if (totalW === 0) return 5;
      return Math.round(segs.reduce((s, seg) => s + seg.daysPerWeek * seg.weeks, 0) / totalW);
    };
    setDpw1(avgDpw(p1Segs));
    setDpw2(avgDpw(p2Segs));
  };

  // Sync preBirthDate when choice is "1week"
  useEffect(() => {
    if (preBirthChoice === "1week" && dueDate) {
      setPreBirthDate(addDays(dueDate, -7));
    } else if (preBirthChoice === "none") {
      setPreBirthDate("");
    }
  }, [preBirthChoice, dueDate]);

  // When switching to dates mode, pre-populate from months
  const switchToDates = () => {
    setDurationMode("dates");
    if (dueDate) {
      if (!endDate1) setEndDate1(addMonths(dueDate, months1));
      const base = endDate1 || addMonths(dueDate, months1);
      if (!endDate2) setEndDate2(addMonths(base, months2));
    }
  };

  // When switching to months mode, compute months from dates then clear dates
  const switchToMonths = () => {
    setDurationMode("months");
    if (dueDate && endDate1) {
      setMonths1(Math.max(1, approxMonths(dueDate, endDate1)));
    }
    if (endDate1 && endDate2) {
      setMonths2(Math.max(1, approxMonths(endDate1, endDate2)));
    }
    setEndDate1("");
    setEndDate2("");
  };

  // Auto-save draft
  useEffect(() => {
    saveWizardDraft({
      planningMode: null,
      parent1Name, parent2Name,
      wantIncome, income1, income2,
      has240Days1, has240Days2,
      dueDate,
      preBirthChoice, preBirthDate,
      endDate1, endDate2,
      months1, months2,
      daysPerWeek1, daysPerWeek2,
      savingPreset: null, savedDays: 0,
      step,
    });
  }, [parent1Name, parent2Name, wantIncome, income1, income2,
    has240Days1, has240Days2, dueDate, preBirthChoice, preBirthDate,
    endDate1, endDate2, months1, months2,
    daysPerWeek1, daysPerWeek2, step]);

  const handleReset = useCallback(() => {
    clearAllDrafts();
    setStep(1);
    setParent1Name(""); setParent2Name("");
    setWantIncome(null); setIncome1(""); setIncome2("");
    setHas240Days1(true); setHas240Days2(true);
    setDueDate("");
    setPreBirthChoice("none"); setPreBirthDate("");
    setEndDate1(""); setEndDate2("");
    setMonths1(6); setMonths2(6);
    setDaysPerWeek1(5); setDaysPerWeek2(5);
    setDurationMode("months");
  }, []);

  const canNext = (): boolean => {
    switch (step) {
      case 1: return parent1Name.trim().length > 0 && parent2Name.trim().length > 0;
      case 2: return dueDate.length > 0 && (preBirthChoice === "none" || preBirthChoice === "1week" || (preBirthChoice === "custom" && !!preBirthDate));
      case 3: return Number(income1) > 0 && Number(income2) > 0;
      case 4: return durationMode === "months" ? (months1 >= 1 && months2 >= 1) : (!!endDate1 && !!endDate2);
      case 5: return true;
      default: return false;
    }
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    } else {
      const hasPre = preBirthChoice !== "none" && !!preBirthDate && !!dueDate;
      const preWeeks = hasPre ? Math.max(1, Math.round(diffDaysInclusive(preBirthDate, dueDate) / 7)) : 0;

      // Compute final endDates from months if in months mode
      let finalEndDate1 = endDate1;
      let finalEndDate2 = endDate2;
      if (durationMode === "months" && dueDate) {
        finalEndDate1 = addMonths(dueDate, months1);
        finalEndDate2 = addMonths(finalEndDate1, months2);
      }

      onComplete({
        parent1Name,
        parent2Name,
        dueDate,
        months1,
        months2,
        daysPerWeek1: Math.round(Math.max(0, Math.min(7, daysPerWeek1))),
        daysPerWeek2: Math.round(Math.max(0, Math.min(7, daysPerWeek2))),
        savedDaysTarget: 0,
        income1: Number(income1) || 0,
        income2: Number(income2) || 0,
        has240Days1,
        has240Days2,
        preBirthParent: hasPre ? "p1" : null,
        preBirthWeeks: preWeeks,
        endDate1: finalEndDate1,
        endDate2: finalEndDate2,
        preBirthDate: hasPre ? preBirthDate : null,
        schedule: suggestedSchedule ?? undefined,
      });
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const cardClass = (active: boolean) =>
    `w-full text-left px-4 py-3 rounded-lg border transition-colors text-base ${active ? "border-primary bg-primary/5 font-medium" : "border-border bg-card hover:bg-muted"}`;

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted text-muted-foreground"}`;

  const pillToggle = (mode: DurationMode) => (
    <div className="flex justify-center gap-1 rounded-full border border-border p-1 bg-card w-fit mx-auto">
      <button
        onClick={() => mode !== "months" ? switchToMonths() : undefined}
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${durationMode === "months" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
      >
        Antal månader
      </button>
      <button
        onClick={() => mode !== "dates" ? switchToDates() : undefined}
        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${durationMode === "dates" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
      >
        Datum
      </button>
    </div>
  );

  const stepContent = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-bold tracking-tight">Vad heter ni?</h1>
              <p className="text-muted-foreground">Vi behöver bara namn för att komma igång.</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-base">Förälder 1</Label>
                <Input className="text-lg h-12" placeholder="Förnamn (t.ex. du som fyller i detta)" value={parent1Name} onChange={(e) => setParent1Name(e.target.value)} autoFocus />
                <p className="text-sm text-muted-foreground">Förälder 1 planerar sina dagar först i nästa steg</p>
              </div>
              <div className="space-y-2">
                <Label className="text-base">Förälder 2</Label>
                <Input className="text-lg h-12" placeholder="Förnamn" value={parent2Name} onChange={(e) => setParent2Name(e.target.value)} />
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">När är barnet beräknat?</h1>
            <div className="space-y-2">
              <Label className="text-base">Beräknat datum</Label>
              <Input type="date" className="text-lg h-12" value={dueDate} onChange={(e) => setDueDate(e.target.value)} autoFocus />
            </div>

            {/* Pre-birth sub-question */}
            {dueDate && (
              <div className="space-y-3 animate-in fade-in duration-200">
                <div className="space-y-1">
                  <Label className="text-base">Vill någon ta ledighet innan BF?</Label>
                  <p className="text-sm text-muted-foreground">Vissa väljer att börja ta ut dagar en eller ett par veckor innan beräknat datum.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setPreBirthChoice("none")} className={chipClass(preBirthChoice === "none")}>
                    Nej
                  </button>
                  <button onClick={() => setPreBirthChoice("1week")} className={chipClass(preBirthChoice === "1week")}>
                    ~1 vecka innan
                  </button>
                  <button onClick={() => setPreBirthChoice("custom")} className={chipClass(preBirthChoice === "custom")}>
                    Välj datum
                  </button>
                </div>
                {preBirthChoice === "1week" && (
                  <p className="text-sm text-muted-foreground animate-in fade-in duration-150">
                    Ledigheten börjar {addDays(dueDate, -7)}
                  </p>
                )}
                {preBirthChoice === "custom" && (
                  <div className="space-y-2 animate-in fade-in duration-150">
                    <Input
                      type="date"
                      className="text-lg h-12"
                      value={preBirthDate}
                      max={addDays(dueDate, -1)}
                      onChange={(e) => setPreBirthDate(e.target.value)}
                    />
                    {preBirthDate && (
                      <p className="text-sm text-muted-foreground">
                        ≈ {Math.round(diffDaysInclusive(preBirthDate, dueDate) / 7)} veckor innan BF
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case 3:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">Vad tjänar ni per månad?</h1>
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className="text-base">Månadsinkomst {parent1Name || "Förälder 1"} (kr)</Label>
                <Input type="text" inputMode="numeric" pattern="[0-9]*" className="text-lg h-12" value={income1} onChange={(e) => setIncome1(e.target.value.replace(/\D/g, ""))} autoFocus />
                <div className="flex items-center gap-2 pt-1">
                  <Checkbox id="has240-1" checked={has240Days1} onCheckedChange={(c) => setHas240Days1(!!c)} />
                  <label htmlFor="has240-1" className="text-sm text-muted-foreground cursor-pointer">Haft inkomst i minst 240 dagar</label>
                </div>
                <details className="text-sm text-muted-foreground mt-1">
                  <summary className="cursor-pointer hover:text-foreground transition-colors">Vad innebär detta?</summary>
                  <p className="mt-2 pl-1 leading-relaxed">För att få föräldrapenning på sjukpenningnivå (~80 % av lönen, upp till SGI-taket) behöver du ha haft en registrerad inkomst hos FK i minst 240 dagar i rad innan barnet föds. Har du det klarar du kravet. Saknar du det får du istället lägstanivå: 180 kr/dag. De flesta som jobbat heltid i över ett år uppfyller kravet automatiskt.</p>
                  <a href="https://www.forsakringskassan.se/privatperson/foralder/foraldrapenning" target="_blank" rel="noopener noreferrer" className="inline-block mt-1 pl-1 text-primary hover:underline">Läs mer på Försäkringskassan →</a>
                </details>
              </div>
              <div className="space-y-2">
                <Label className="text-base">Månadsinkomst {parent2Name || "Förälder 2"} (kr)</Label>
                <Input type="text" inputMode="numeric" pattern="[0-9]*" className="text-lg h-12" value={income2} onChange={(e) => setIncome2(e.target.value.replace(/\D/g, ""))} />
                <div className="flex items-center gap-2 pt-1">
                  <Checkbox id="has240-2" checked={has240Days2} onCheckedChange={(c) => setHas240Days2(!!c)} />
                  <label htmlFor="has240-2" className="text-sm text-muted-foreground cursor-pointer">Haft inkomst i minst 240 dagar</label>
                </div>
                <details className="text-sm text-muted-foreground mt-1">
                  <summary className="cursor-pointer hover:text-foreground transition-colors">Vad innebär detta?</summary>
                  <p className="mt-2 pl-1 leading-relaxed">För att få föräldrapenning på sjukpenningnivå (~80 % av lönen, upp till SGI-taket) behöver du ha haft en registrerad inkomst hos FK i minst 240 dagar i rad innan barnet föds. Har du det klarar du kravet. Saknar du det får du istället lägstanivå: 180 kr/dag. De flesta som jobbat heltid i över ett år uppfyller kravet automatiskt.</p>
                  <a href="https://www.forsakringskassan.se/privatperson/foralder/foraldrapenning" target="_blank" rel="noopener noreferrer" className="inline-block mt-1 pl-1 text-primary hover:underline">Läs mer på Försäkringskassan →</a>
                </details>
              </div>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 mb-4 text-sm text-foreground">
              <p>📋 Det här är ett utkast – du kan justera allt i Min Plan efteråt</p>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-center">Hur länge vill ni vara hemma?</h1>
            {pillToggle(durationMode)}

            {durationMode === "months" ? (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-base">{parent1Name || "Förälder 1"} – antal månader</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className="text-lg h-12"
                    value={months1 === 0 ? "" : months1}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "");
                      setMonths1(v === "" ? 0 : Math.min(24, Number(v)));
                    }}
                    onBlur={() => { if (months1 < 1) setMonths1(1); }}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-base">{parent2Name || "Förälder 2"} – antal månader</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className="text-lg h-12"
                    value={months2 === 0 ? "" : months2}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "");
                      setMonths2(v === "" ? 0 : Math.min(24, Number(v)));
                    }}
                    onBlur={() => { if (months2 < 1) setMonths2(1); }}
                  />
                </div>
              </div>
            ) : !dueDate ? (
              <p className="text-sm text-muted-foreground text-center">Ange beräknat datum för förlossning i föregående steg för att välja slutdatum.</p>
            ) : (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-base">{parent1Name || "Förälder 1"} slutar</Label>
                  <Input
                    type="date"
                    className="text-lg h-12"
                    value={endDate1}
                    min={dueDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEndDate1(val);
                      if (val) setMonths1(approxMonths(dueDate, val));
                    }}
                    autoFocus
                  />
                  {endDate1 && <p className="text-sm text-muted-foreground">≈ {approxMonths(dueDate, endDate1)} månader</p>}
                </div>
                <div className="space-y-2">
                  <Label className="text-base">{parent2Name || "Förälder 2"} slutar</Label>
                  <Input
                    type="date"
                    className="text-lg h-12"
                    value={endDate2}
                    min={endDate1 || dueDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEndDate2(val);
                      if (val && endDate1) setMonths2(approxMonths(endDate1, val));
                    }}
                  />
                  {endDate2 && endDate1 && <p className="text-sm text-muted-foreground">≈ {approxMonths(endDate1, endDate2)} månader</p>}
                </div>
              </div>
            )}
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground transition-colors">ℹ️ Vad bestämmer jag här?</summary>
              <div className="mt-2 pl-1 leading-relaxed space-y-2">
                <p>Du anger ungefär hur länge varje förälder tänker vara hemma på heltid. Det styr hur er plan fördelas i kalendern som skapas åt er.</p>
                <p className="font-medium">Tänk på:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Det här är bara ett startförslag – du kan justera startdatum, slut­datum och överlapp direkt i Min Plan efteråt.</li>
                  <li>FK räknar i föräldradagar (måndag–fredag), inte kalenderdagar. 6 månader heltid ≈ 130 dagar.</li>
                  <li>Du kan ta ut föräldrapenning ända tills barnet fyller 12 år, men de flesta tar ut det mesta under de första 2 åren.</li>
                </ul>
                <Link to="/foraldraledighet-101" className="inline-block text-primary hover:underline text-sm">Lär dig mer om hur dagar fungerar →</Link>
              </div>
            </details>
          </div>
        );

      case 5: {
        const m1 = durationMode === "dates" && dueDate && endDate1 ? approxMonths(dueDate, endDate1) : months1;
        const m2 = durationMode === "dates" && endDate1 && endDate2 ? approxMonths(endDate1, endDate2) : months2;

        // Live feedback: use schedule if active, otherwise uniform sliders
        const activeDaysConsumed = suggestedSchedule
          ? scheduleTotalDays(suggestedSchedule)
          : Math.round((daysPerWeek1 * m1 * 4.33) + (daysPerWeek2 * m2 * 4.33));
        const daysRemaining = 480 - activeDaysConsumed;
        const inc1Num = Number(income1) || 0;
        const inc2Num = Number(income2) || 0;
        const hasIncome = inc1Num > 0 && inc2Num > 0;

        const prefCards: { key: "income" | "balanced" | "save"; emoji: string; title: string; desc: string; detail: string }[] = [
          {
            key: "income", emoji: "💰", title: "Maximalt uttag",
            desc: "Ni tar ut alla 480 föräldradagar under er ledighet.",
            detail: "Det ger er högsta möjliga ersättning från Försäkringskassan under tiden ni är hemma, men inga dagar sparas för senare. Bra om ni vill maximera inkomsten nu och inte planerar att vara lediga igen."
          },
          {
            key: "balanced", emoji: "⚖️", title: "Balanserat",
            desc: "En mellanväg – bra inkomst nu och dagar kvar för framtiden.",
            detail: "Ni använder merparten av dagarna men sparar en del till senare, t.ex. för att förlänga semestrar eller vara hemma vid inskolning. Hur många som sparas beror på hur länge ni planerar vara lediga."
          },
          {
            key: "save", emoji: "🏖️", title: "Spara dagar",
            desc: "Ni sparar en stor del av dagarna till efter ledigheten.",
            detail: "Ersättningen per månad blir något lägre, men ni har ca 176 dagar kvar som kan användas fritt tills barnet fyller 12 – perfekt för längre semestrar, VAB-buffert eller kortare ledighetsperioder senare."
          },
        ];

        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 mb-4 text-sm text-foreground">
              <p>📋 Det här är ett utkast – du kan justera allt i Min Plan efteråt</p>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-center">Hur många dagar per vecka?</h1>
            <p className="text-muted-foreground text-center text-sm">Antal föräldradagar ni planerar ta ut per vecka. Ni kan justera allt i planen efteråt.</p>

            {/* Smart suggestion helper */}
            {!showHelper ? (
              <Button variant="outline" className="w-full gap-2 text-muted-foreground" onClick={() => setShowHelper(true)}>
                <Lightbulb className="h-4 w-4" />
                Hjälp mig välja
              </Button>
            ) : (
              <div className="space-y-3 animate-in fade-in duration-200">
                <p className="text-sm text-muted-foreground text-center">Vad är viktigast för er?</p>
                <div className="flex flex-col gap-3">
                  {prefCards.map(({ key, emoji, title, desc, detail }) => {
                    const sched = computeOptimalSchedule(key, m1, m2);
                    const totalDays = scheduleTotalDays(sched);
                    const saved = 480 - totalDays;
                    return (
                      <button
                        key={key}
                        onClick={() => applyPreference(key)}
                        className={`flex flex-col items-start text-left gap-1 px-4 py-4 rounded-lg border transition-colors ${
                          selectedPreference === key
                            ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                            : "border-border bg-card hover:bg-muted"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{emoji}</span>
                          <span className="text-base font-semibold">{title}</span>
                        </div>
                        <p className="text-sm text-foreground/80 leading-snug">{desc}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{detail}</p>
                        <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="font-medium text-primary/80">{totalDays} dagar används</span>
                          <span>·</span>
                          <span>{saved > 0 ? `${saved} dagar sparas` : "Inga dagar sparas"}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {selectedPreference && suggestedSchedule && (
                  <p className="text-xs text-muted-foreground text-center animate-in fade-in duration-150">
                    Du kan finjustera med slidersen nedan.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base">{parent1Name || "Förälder 1"}</Label>
                  <span className="text-lg font-semibold">{daysPerWeek1} dagar/vecka</span>
                </div>
                <Slider min={0} max={7} step={1} value={[daysPerWeek1]} onValueChange={([v]) => { setDpw1(v); setSelectedPreference(null); setSuggestedSchedule(null); }} />
                {daysPerWeek1 === 0 && (
                  <p className="text-sm text-destructive/80">Om du väljer 0 skapas ingen ledighet för perioden.</p>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base">{parent2Name || "Förälder 2"}</Label>
                  <span className="text-lg font-semibold">{daysPerWeek2} dagar/vecka</span>
                </div>
                <Slider min={0} max={7} step={1} value={[daysPerWeek2]} onValueChange={([v]) => { setDpw2(v); setSelectedPreference(null); setSuggestedSchedule(null); }} />
                {daysPerWeek2 === 0 && (
                  <p className="text-sm text-destructive/80">Om du väljer 0 skapas ingen ledighet för perioden.</p>
                )}
              </div>
            </div>

            {/* Live feedback summary */}
            <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm space-y-1.5">
              {hasIncome && (
                <div className="space-y-0.5">
                  <p className="font-medium">{parent1Name || "Förälder 1"}: ~{Math.round(computeBlockMonthlyBenefit(inc1Num, daysPerWeek1)).toLocaleString("sv-SE")} kr/mån från FK</p>
                  <p className="font-medium">{parent2Name || "Förälder 2"}: ~{Math.round(computeBlockMonthlyBenefit(inc2Num, daysPerWeek2)).toLocaleString("sv-SE")} kr/mån från FK</p>
                </div>
              )}
              <p className="text-muted-foreground text-center">
                {activeDaysConsumed} dagar förbrukas · {Math.max(0, daysRemaining)} dagar kvar av 480
                {daysRemaining < 0 && <span className="text-destructive ml-1">(⚠️ överskrider med {Math.abs(daysRemaining)} dagar)</span>}
              </p>
              <p className="text-xs text-muted-foreground/70 text-center">I nästa steg kan du bryta ner detta i olika block och skräddarsy uttagstakten för bästa resultat.</p>
            </div>
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground transition-colors">ℹ️ Vad bestämmer jag här?</summary>
              <div className="mt-2 pl-1 leading-relaxed space-y-2">
                <p>Du anger i vilken takt varje förälder tar ut dagar – alltså hur stor andel av veckan ni är hemma.</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>5 dagar/vecka = heltidsuttag (vanligast i början)</li>
                  <li>4 dagar/vecka = 80%-uttag</li>
                  <li>3 dagar/vecka = 60%-uttag (föräldraledigheten sträcker sig längre i kalendern)</li>
                  <li>2,5 dagar/vecka = halvtidsuttag</li>
                </ul>
                <p>Tänk: ju färre dagar/vecka, desto längre varar perioden i kalendern men du förbrukar lika många föräldradagar totalt. Väljer du till exempel 3 dagar/vecka sträcker sig en "månads­period" ut till nästan 7 kalenderveckor.</p>
                <Link to="/foraldraledighet-101" className="inline-block text-primary hover:underline text-sm">Lär dig mer om uttakstakt →</Link>
              </div>
            </details>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="max-w-lg mx-auto px-6 py-12 min-h-[80vh] flex flex-col">
      {/* Progress */}
      <div className="text-center mb-2">
        <p className="text-sm text-muted-foreground">Steg {step} av {TOTAL_STEPS}</p>
      </div>
      <div className="flex gap-1.5 mb-6">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i < step ? "bg-primary" : "bg-muted"}`}
          />
        ))}
      </div>

      {/* Draft actions */}
      <div className="flex justify-center gap-3 mb-4">
        {hasDraft && step === 1 && (
          <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => {
            const d = loadWizardDraft();
            if (d) {
              setParent1Name(d.parent1Name); setParent2Name(d.parent2Name);
              setWantIncome(d.wantIncome); setIncome1(d.income1); setIncome2(d.income2);
              setHas240Days1(d.has240Days1); setHas240Days2(d.has240Days2);
              setDueDate(d.dueDate);
              setPreBirthChoice(d.preBirthChoice ?? "none");
              setPreBirthDate(d.preBirthDate ?? "");
              setEndDate1(d.endDate1 ?? ""); setEndDate2(d.endDate2 ?? "");
              setMonths1(d.months1); setMonths2(d.months2);
              setDaysPerWeek1(d.daysPerWeek1); setDaysPerWeek2(d.daysPerWeek2);
              setDurationMode((d.endDate1 && d.endDate1.length > 0) ? "dates" : "months");
              setStep(d.step);
            }
          }}>
            <Upload className="h-3.5 w-3.5" />
            Ladda senaste
          </Button>
        )}
        <Button variant="ghost" size="sm" className="text-xs gap-1.5 text-muted-foreground" onClick={handleReset}>
          <RotateCcw className="h-3.5 w-3.5" />
          Återställ
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col justify-start pt-4">
        {stepContent()}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-8">
        <Button variant="ghost" onClick={handleBack} disabled={step === 1}>
          ← Tillbaka
        </Button>
        <Button size="lg" onClick={handleNext} disabled={!canNext()}>
          {step === TOTAL_STEPS ? "Se min plan →" : "Nästa →"}
        </Button>
      </div>
    </div>
  );
};

export default OnboardingWizard;
