import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { RotateCcw, Upload } from "lucide-react";
import { saveWizardDraft, loadWizardDraft, clearAllDrafts } from "@/lib/persistence";
import { addDays, addMonths, diffDaysInclusive } from "@/utils/dateOnly";

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

  const [hasDraft] = useState(() => !!loadWizardDraft());

  const setDpw1 = (v: number) => setDaysPerWeek1(Math.round(Math.max(0, Math.min(7, v))));
  const setDpw2 = (v: number) => setDaysPerWeek2(Math.round(Math.max(0, Math.min(7, v))));

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
      case 3: return wantIncome !== null;
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
        income1: wantIncome ? (Number(income1) || 0) : null,
        income2: wantIncome ? (Number(income2) || 0) : null,
        has240Days1: wantIncome ? has240Days1 : true,
        has240Days2: wantIncome ? has240Days2 : true,
        preBirthParent: hasPre ? "p1" : null,
        preBirthWeeks: preWeeks,
        endDate1: finalEndDate1,
        endDate2: finalEndDate2,
        preBirthDate: hasPre ? preBirthDate : null,
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
                <Input className="text-lg h-12" placeholder="Förnamn" value={parent1Name} onChange={(e) => setParent1Name(e.target.value)} autoFocus />
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
                <Input type="number" min={0} className="text-lg h-12" value={income1} onChange={(e) => setIncome1(e.target.value)} autoFocus />
                <div className="flex items-center gap-2 pt-1">
                  <Checkbox id="has240-1" checked={has240Days1} onCheckedChange={(c) => setHas240Days1(!!c)} />
                  <label htmlFor="has240-1" className="text-sm text-muted-foreground cursor-pointer">Haft inkomst i minst 240 dagar</label>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-base">Månadsinkomst {parent2Name || "Förälder 2"} (kr)</Label>
                <Input type="number" min={0} className="text-lg h-12" value={income2} onChange={(e) => setIncome2(e.target.value)} />
                <div className="flex items-center gap-2 pt-1">
                  <Checkbox id="has240-2" checked={has240Days2} onCheckedChange={(c) => setHas240Days2(!!c)} />
                  <label htmlFor="has240-2" className="text-sm text-muted-foreground cursor-pointer">Haft inkomst i minst 240 dagar</label>
                </div>
              </div>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">Hur länge vill ni vara hemma?</h1>
            {pillToggle(durationMode)}

            {durationMode === "months" ? (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-base">{parent1Name || "Förälder 1"} – antal månader</Label>
                  <Input
                    type="number"
                    min={1}
                    max={24}
                    className="text-lg h-12"
                    value={months1}
                    onChange={(e) => setMonths1(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-base">{parent2Name || "Förälder 2"} – antal månader</Label>
                  <Input
                    type="number"
                    min={1}
                    max={24}
                    className="text-lg h-12"
                    value={months2}
                    onChange={(e) => setMonths2(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
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
          </div>
        );

      case 5:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">Hur många dagar per vecka?</h1>
            <p className="text-muted-foreground text-center text-sm">Antal föräldradagar ni planerar ta ut per vecka. Ni kan justera allt i planen efteråt.</p>

            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base">{parent1Name || "Förälder 1"}</Label>
                  <span className="text-lg font-semibold">{daysPerWeek1} dagar/vecka</span>
                </div>
                <Slider min={0} max={7} step={1} value={[daysPerWeek1]} onValueChange={([v]) => setDpw1(v)} />
                {daysPerWeek1 === 0 && (
                  <p className="text-sm text-destructive/80">Om du väljer 0 skapas ingen ledighet för perioden.</p>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base">{parent2Name || "Förälder 2"}</Label>
                  <span className="text-lg font-semibold">{daysPerWeek2} dagar/vecka</span>
                </div>
                <Slider min={0} max={7} step={1} value={[daysPerWeek2]} onValueChange={([v]) => setDpw2(v)} />
                {daysPerWeek2 === 0 && (
                  <p className="text-sm text-destructive/80">Om du väljer 0 skapas ingen ledighet för perioden.</p>
                )}
              </div>
            </div>
          </div>
        );

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
      <div className="flex-1 flex flex-col justify-center">
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
