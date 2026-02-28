import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { RotateCcw, Upload } from "lucide-react";
import { saveWizardDraft, loadWizardDraft, clearAllDrafts } from "@/lib/persistence";

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
};

type Props = {
  onComplete: (result: WizardResult) => void;
};

const TOTAL_STEPS = 5;

const OnboardingWizard = ({ onComplete }: Props) => {
  const draft = loadWizardDraft();
  const [step, setStep] = useState(draft?.step ?? 1);

  // Step 1: Names
  const [parent1Name, setParent1Name] = useState(draft?.parent1Name ?? "");
  const [parent2Name, setParent2Name] = useState(draft?.parent2Name ?? "");

  // Step 2: Due date
  const [dueDate, setDueDate] = useState(draft?.dueDate ?? "");

  // Step 3: Income (optional)
  const [wantIncome, setWantIncome] = useState<boolean | null>(draft?.wantIncome ?? null);
  const [income1, setIncome1] = useState(draft?.income1 ?? "");
  const [income2, setIncome2] = useState(draft?.income2 ?? "");
  const [has240Days1, setHas240Days1] = useState(draft?.has240Days1 ?? true);
  const [has240Days2, setHas240Days2] = useState(draft?.has240Days2 ?? true);

  // Step 4: Months
  const [months1, setMonths1] = useState(draft?.months1 ?? 6);
  const [months2, setMonths2] = useState(draft?.months2 ?? 6);

  // Step 5: Days per week
  const [daysPerWeek1, setDaysPerWeek1] = useState(draft?.daysPerWeek1 ?? 5);
  const [daysPerWeek2, setDaysPerWeek2] = useState(draft?.daysPerWeek2 ?? 5);

  const [hasDraft] = useState(() => !!loadWizardDraft());

  // Clamp helpers
  const setDpw1 = (v: number) => setDaysPerWeek1(Math.round(Math.max(0, Math.min(7, v))));
  const setDpw2 = (v: number) => setDaysPerWeek2(Math.round(Math.max(0, Math.min(7, v))));

  // Auto-save draft
  useEffect(() => {
    saveWizardDraft({
      planningMode: null,
      parent1Name, parent2Name,
      wantIncome, income1, income2,
      has240Days1, has240Days2,
      dueDate,
      preBirthChoice: null, preBirthDate: null,
      months1, months2,
      daysPerWeek1, daysPerWeek2,
      savingPreset: null, savedDays: 0,
      step,
    });
  }, [parent1Name, parent2Name, wantIncome, income1, income2,
    has240Days1, has240Days2, dueDate, months1, months2,
    daysPerWeek1, daysPerWeek2, step]);

  const handleReset = useCallback(() => {
    clearAllDrafts();
    setStep(1);
    setParent1Name(""); setParent2Name("");
    setWantIncome(null); setIncome1(""); setIncome2("");
    setHas240Days1(true); setHas240Days2(true);
    setDueDate("");
    setMonths1(6); setMonths2(6);
    setDaysPerWeek1(5); setDaysPerWeek2(5);
  }, []);

  const canNext = (): boolean => {
    switch (step) {
      case 1: return parent1Name.trim().length > 0 && parent2Name.trim().length > 0;
      case 2: return dueDate.length > 0;
      case 3: return wantIncome !== null;
      case 4: return months1 >= 1 && months2 >= 1;
      case 5: return true;
      default: return false;
    }
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    } else {
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
        preBirthParent: null,
        preBirthWeeks: 0,
      });
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

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
          </div>
        );

      case 3:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">Vill ni se en uppskattning av ersättningen?</h1>
            <div className="space-y-3">
              <button
                onClick={() => setWantIncome(true)}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-colors text-base ${wantIncome === true ? "border-primary bg-primary/5 font-medium" : "border-border bg-card hover:bg-muted"}`}
              >
                Ja, ange inkomst
              </button>
              <button
                onClick={() => setWantIncome(false)}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-colors text-base ${wantIncome === false ? "border-primary bg-primary/5 font-medium" : "border-border bg-card hover:bg-muted"}`}
              >
                Nej, hoppa över
              </button>
            </div>
            {wantIncome && (
              <div className="space-y-5 animate-in fade-in duration-200">
                <div className="space-y-2">
                  <Label className="text-base">Månadsinkomst {parent1Name || "Förälder 1"} (kr)</Label>
                  <Input type="number" min={0} className="text-lg h-12" value={income1} onChange={(e) => setIncome1(e.target.value)} />
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
            )}
          </div>
        );

      case 4:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">Hur länge vill ni vara hemma?</h1>
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className="text-base">Antal månader – {parent1Name || "Förälder 1"}</Label>
                <Input type="number" min={1} max={24} className="text-lg h-12" value={months1} onChange={(e) => setMonths1(Math.max(1, Math.min(24, Number(e.target.value) || 1)))} autoFocus />
              </div>
              <div className="space-y-2">
                <Label className="text-base">Antal månader – {parent2Name || "Förälder 2"}</Label>
                <Input type="number" min={1} max={24} className="text-lg h-12" value={months2} onChange={(e) => setMonths2(Math.max(1, Math.min(24, Number(e.target.value) || 1)))} />
              </div>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">Hur många dagar per vecka?</h1>
            <p className="text-muted-foreground text-center text-sm">Antal föräldradagar ni planerar ta ut per vecka. Ni kan justera allt i planen efteråt.</p>

            <div className="space-y-6">
              {/* Parent 1 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base">{parent1Name || "Förälder 1"}</Label>
                  <span className="text-lg font-semibold">{daysPerWeek1} dagar/vecka</span>
                </div>
                <Slider min={0} max={7} step={1} value={[daysPerWeek1]} onValueChange={([v]) => setDpw1(v)} />
                {daysPerWeek1 === 0 && (
                  <p className="text-sm text-amber-600">Om du väljer 0 skapas ingen ledighet för perioden.</p>
                )}
              </div>

              {/* Parent 2 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base">{parent2Name || "Förälder 2"}</Label>
                  <span className="text-lg font-semibold">{daysPerWeek2} dagar/vecka</span>
                </div>
                <Slider min={0} max={7} step={1} value={[daysPerWeek2]} onValueChange={([v]) => setDpw2(v)} />
                {daysPerWeek2 === 0 && (
                  <p className="text-sm text-amber-600">Om du väljer 0 skapas ingen ledighet för perioden.</p>
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
              setMonths1(d.months1); setMonths2(d.months2);
              setDaysPerWeek1(d.daysPerWeek1); setDaysPerWeek2(d.daysPerWeek2);
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
