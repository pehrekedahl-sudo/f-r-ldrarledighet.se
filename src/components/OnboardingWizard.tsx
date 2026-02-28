import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown, CalendarIcon, RotateCcw, Upload, Zap, Compass, SlidersHorizontal } from "lucide-react";
import { format, differenceInCalendarDays, subWeeks } from "date-fns";
import { sv } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { saveWizardDraft, loadWizardDraft, clearAllDrafts, type WizardDraft, type PlanningMode } from "@/lib/persistence";

type SavingPreset = "none" | "lite" | "buffert" | "unknown";

const PRESET_DAYS: Record<SavingPreset, number> = {
  none: 0,
  lite: 30,
  buffert: 60,
  unknown: 30,
};

const TOTAL_BUDGET_DAYS = 480;

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

const MODE_LABELS: Record<PlanningMode, string> = {
  quick: "Grundplan",
  guided: "Preferenser",
  advanced: "Full kontroll",
};

function calcGuidedDpw(totalMonths: number, savedDays: number): number {
  const totalWeeks = totalMonths * 4.3;
  if (totalWeeks <= 0) return 5;
  const available = TOTAL_BUDGET_DAYS - savedDays;
  const dpw = Math.round(available / totalWeeks);
  return Math.max(4, Math.min(7, dpw));
}

const OnboardingWizard = ({ onComplete }: Props) => {
  const draft = loadWizardDraft();
  const [step, setStep] = useState(draft?.step ?? 0);
  const [planningMode, setPlanningMode] = useState<PlanningMode | null>(draft?.planningMode ?? null);
  // Step 1
  const [parent1Name, setParent1Name] = useState(draft?.parent1Name ?? "");
  const [parent2Name, setParent2Name] = useState(draft?.parent2Name ?? "");
  // Step 2
  const [wantIncome, setWantIncome] = useState<boolean | null>(draft?.wantIncome ?? null);
  const [income1, setIncome1] = useState(draft?.income1 ?? "");
  const [income2, setIncome2] = useState(draft?.income2 ?? "");
  const [has240Days1, setHas240Days1] = useState(draft?.has240Days1 ?? true);
  const [has240Days2, setHas240Days2] = useState(draft?.has240Days2 ?? true);
  // Step 3
  const [dueDate, setDueDate] = useState(draft?.dueDate ?? "");
  // Step 4
  const [preBirthChoice, setPreBirthChoice] = useState<"no" | "p1" | "p2" | null>(draft?.preBirthChoice ?? null);
  const [preBirthDate, setPreBirthDate] = useState<Date | undefined>(
    draft?.preBirthDate ? new Date(draft.preBirthDate) : undefined
  );
  // Step 5 & 6
  const [months1, setMonths1] = useState(draft?.months1 ?? 6);
  const [months2, setMonths2] = useState(draft?.months2 ?? 6);
  const [daysPerWeek1, setDaysPerWeek1] = useState(draft?.daysPerWeek1 ?? 5);
  const [daysPerWeek2, setDaysPerWeek2] = useState(draft?.daysPerWeek2 ?? 5);
  const setDpw1 = (v: number) => setDaysPerWeek1(Math.round(Math.max(0, Math.min(7, v))));
  const setDpw2 = (v: number) => setDaysPerWeek2(Math.round(Math.max(0, Math.min(7, v))));
  // Step 7
  const [savingPreset, setSavingPreset] = useState<SavingPreset | null>((draft?.savingPreset as SavingPreset) ?? null);
  const [savedDays, setSavedDays] = useState(draft?.savedDays ?? 30);
  const [showSlider, setShowSlider] = useState(false);
  const [hasDraft] = useState(() => !!loadWizardDraft());

  const showDpw = planningMode === "advanced";
  const showSavingStep = planningMode !== "quick";

  // Steps that are active for the current mode
  const activeSteps = useMemo(() => {
    const steps = [0, 1, 2, 3, 4, 5, 6];
    if (showSavingStep) steps.push(7);
    return steps;
  }, [showSavingStep]);

  const totalSteps = activeSteps.length;
  const currentStepIndex = activeSteps.indexOf(step);

  // Auto-save
  useEffect(() => {
    saveWizardDraft({
      planningMode, parent1Name, parent2Name, wantIncome, income1, income2,
      has240Days1, has240Days2, dueDate, preBirthChoice,
      preBirthDate: preBirthDate ? preBirthDate.toISOString() : null,
      months1, months2, daysPerWeek1, daysPerWeek2,
      savingPreset, savedDays, step,
    });
  }, [planningMode, parent1Name, parent2Name, wantIncome, income1, income2,
    has240Days1, has240Days2, dueDate, preBirthChoice, preBirthDate,
    months1, months2, daysPerWeek1, daysPerWeek2, savingPreset, savedDays, step]);

  const handleReset = useCallback(() => {
    clearAllDrafts();
    setStep(0);
    setPlanningMode(null);
    setParent1Name(""); setParent2Name("");
    setWantIncome(null); setIncome1(""); setIncome2("");
    setHas240Days1(true); setHas240Days2(true);
    setDueDate(""); setPreBirthChoice(null); setPreBirthDate(undefined);
    setMonths1(6); setMonths2(6);
    setDaysPerWeek1(5); setDaysPerWeek2(5);
    setSavingPreset(null); setSavedDays(30);
  }, []);

  const canNext = (): boolean => {
    switch (step) {
      case 0: return planningMode !== null;
      case 1: return parent1Name.trim().length > 0 && parent2Name.trim().length > 0;
      case 2: return wantIncome !== null;
      case 3: return dueDate.length > 0;
      case 4: return preBirthChoice === "no" || (preBirthChoice !== null && preBirthDate !== undefined);
      case 5: return months1 >= 1 && !(months1 > 0 && daysPerWeek1 === 0 && showDpw);
      case 6: return months2 >= 1 && !(months2 > 0 && daysPerWeek2 === 0 && showDpw);
      case 7: return savingPreset !== null;
      default: return false;
    }
  };

  const getNextStep = (current: number): number | null => {
    const idx = activeSteps.indexOf(current);
    if (idx < activeSteps.length - 1) return activeSteps[idx + 1];
    return null; // last step
  };

  const getPrevStep = (current: number): number | null => {
    const idx = activeSteps.indexOf(current);
    if (idx > 0) return activeSteps[idx - 1];
    return null;
  };

  const computeFinalDpw = useCallback((): { dpw1: number; dpw2: number } => {
    if (planningMode === "quick") {
      return { dpw1: 6, dpw2: 6 };
    }
    if (planningMode === "guided") {
      const dpw = calcGuidedDpw(months1 + months2, savedDays);
      return { dpw1: dpw, dpw2: dpw };
    }
    return {
      dpw1: Math.round(Math.max(0, Math.min(7, daysPerWeek1))),
      dpw2: Math.round(Math.max(0, Math.min(7, daysPerWeek2))),
    };
  }, [planningMode, months1, months2, savedDays, daysPerWeek1, daysPerWeek2]);

  const guidedPreviewDpw = useMemo(() => {
    if (planningMode !== "guided") return null;
    return calcGuidedDpw(months1 + months2, savedDays);
  }, [planningMode, months1, months2, savedDays]);

  const handleNext = () => {
    const next = getNextStep(step);
    if (next !== null) {
      setStep(next);
    } else {
      // Complete
      const { dpw1, dpw2 } = computeFinalDpw();
      const finalSavedDays = planningMode === "quick" ? 0 : savedDays;
      onComplete({
        parent1Name,
        parent2Name,
        dueDate,
        months1,
        months2,
        daysPerWeek1: dpw1,
        daysPerWeek2: dpw2,
        savedDaysTarget: finalSavedDays,
        income1: wantIncome ? (Number(income1) || 0) : null,
        income2: wantIncome ? (Number(income2) || 0) : null,
        has240Days1: wantIncome ? has240Days1 : true,
        has240Days2: wantIncome ? has240Days2 : true,
        preBirthParent: preBirthChoice === "p1" ? "p1" : preBirthChoice === "p2" ? "p2" : null,
        preBirthWeeks: preBirthChoice !== "no" && preBirthChoice !== null && preBirthDate && dueDate
          ? Math.max(1, Math.ceil(differenceInCalendarDays(new Date(dueDate), preBirthDate) / 7))
          : 0,
      });
    }
  };

  const handleBack = () => {
    const prev = getPrevStep(step);
    if (prev !== null) setStep(prev);
  };

  const selectPreset = (preset: SavingPreset) => {
    setSavingPreset(preset);
    setSavedDays(PRESET_DAYS[preset]);
  };

  const isLastStep = getNextStep(step) === null;

  const renderModeIndicator = () => {
    if (!planningMode || step === 0) return null;
    return (
      <div className="flex items-center justify-center gap-1.5 mb-4">
        <span className="text-xs text-muted-foreground">Planeringsläge:</span>
        {(["quick", "guided", "advanced"] as PlanningMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setPlanningMode(m)}
            className={cn(
              "px-2 py-0.5 rounded-full text-xs transition-colors border",
              planningMode === m
                ? "border-primary bg-primary/10 text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>
    );
  };

  const renderDpwSection = (
    parentName: string,
    dpwValue: number,
    setDpw: (v: number) => void,
    monthsValue: number
  ) => {
    if (!showDpw) return null;
    return (
      <div className="space-y-3">
        <Label className="text-base">Hur många föräldradagar per vecka planerar {parentName} ta ut?</Label>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Dagar/vecka</span>
          <span className="font-medium text-lg">{dpwValue} dagar/vecka</span>
        </div>
        <Slider min={0} max={7} step={1} value={[dpwValue]} onValueChange={([v]) => setDpw(v)} />
        {dpwValue === 0 && <p className="text-sm text-amber-600">Om du väljer 0 skapas ingen ledighet för perioden.</p>}
        {monthsValue > 0 && dpwValue === 0 && <p className="text-sm text-destructive">Välj minst 1 dag/vecka eller sätt 0 månader.</p>}
        <div className="flex gap-2">
          {[3, 5, 7].map((n) => (
            <button key={n} onClick={() => setDpw(n)} className={`px-3 py-1 rounded-full text-sm border transition-colors ${dpwValue === n ? "border-primary bg-primary/10 font-medium" : "border-border bg-card hover:bg-muted"}`}>
              {n}
            </button>
          ))}
        </div>
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors [&[data-state=open]>svg]:rotate-180">
            Vad betyder detta?
            <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform duration-200" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 text-sm text-muted-foreground space-y-1">
            <p>Att vara hemma är inte samma sak som att ta ut dagar.</p>
            <p>Tar ni ut 5 dagar/vecka och är hemma 7 dagar sparar ni 2 dagar/vecka.</p>
            <p>Uttagstakt påverkar både hur länge dagarna räcker och ersättningen.</p>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  };

  const stepContent = () => {
    switch (step) {
      case 0:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-bold tracking-tight">Hur vill ni börja planera?</h1>
              <p className="text-muted-foreground">Välj det som passar er bäst – ni kan alltid ändra.</p>
            </div>
            <div className="space-y-3">
              {([
                {
                  key: "quick" as PlanningMode,
                  icon: Zap,
                  label: "Vi vill ha en grundplan att börja diskutera utifrån",
                  desc: "Vi skapar en genomtänkt grundplan baserad på era förutsättningar. Ni kan justera allt i nästa steg.",
                },
                {
                  key: "guided" as PlanningMode,
                  icon: Compass,
                  label: "Vi har vissa preferenser vi vill ta hänsyn till",
                  desc: "Till exempel att spara dagar eller prioritera inkomst.",
                },
                {
                  key: "advanced" as PlanningMode,
                  icon: SlidersHorizontal,
                  label: "Vi vill styra detaljerna själva",
                  desc: "Vi anger själva hur många dagar per vecka vi tar ut.",
                },
              ]).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setPlanningMode(opt.key)}
                  className={cn(
                    "w-full text-left px-4 py-4 rounded-lg border transition-colors",
                    planningMode === opt.key
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-muted"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <opt.icon className={cn(
                      "h-5 w-5 mt-0.5 shrink-0",
                      planningMode === opt.key ? "text-primary" : "text-muted-foreground"
                    )} />
                    <div>
                      <p className={cn("text-base", planningMode === opt.key && "font-medium")}>{opt.label}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">{opt.desc}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">Vad heter ni?</h1>
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
                  <Label className="text-base">Månadsinkomst {parent1Name} (kr)</Label>
                  <Input type="number" min={0} className="text-lg h-12" value={income1} onChange={(e) => setIncome1(e.target.value)} />
                  <div className="flex items-center gap-2 pt-1">
                    <Checkbox id="has240-1" checked={has240Days1} onCheckedChange={(c) => setHas240Days1(!!c)} />
                    <label htmlFor="has240-1" className="text-sm text-muted-foreground cursor-pointer">Haft inkomst i minst 240 dagar</label>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-base">Månadsinkomst {parent2Name} (kr)</Label>
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

      case 3:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">När är barnet beräknat?</h1>
            <div className="space-y-2">
              <Label className="text-base">Beräknat datum</Label>
              <Input type="date" className="text-lg h-12" value={dueDate} onChange={(e) => setDueDate(e.target.value)} autoFocus />
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">Ska någon börja vara ledig innan barnet föds?</h1>
            <div className="space-y-3">
              {([
                { key: "no" as const, label: "Nej" },
                { key: "p1" as const, label: `Ja, ${parent1Name}` },
                { key: "p2" as const, label: `Ja, ${parent2Name}` },
              ]).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setPreBirthChoice(opt.key)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors text-base ${preBirthChoice === opt.key ? "border-primary bg-primary/5 font-medium" : "border-border bg-card hover:bg-muted"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {preBirthChoice && preBirthChoice !== "no" && dueDate && (
              <div className="space-y-2 animate-in fade-in duration-200">
                <Label className="text-base">När börjar ledigheten?</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full h-12 justify-start text-left text-lg font-normal",
                        !preBirthDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {preBirthDate ? format(preBirthDate, "d MMMM yyyy", { locale: sv }) : "Välj datum"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={preBirthDate}
                      onSelect={setPreBirthDate}
                      defaultMonth={subWeeks(new Date(dueDate), 4)}
                      disabled={(date) =>
                        date < subWeeks(new Date(dueDate), 8) || date > new Date(dueDate)
                      }
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}
          </div>
        );

      case 5:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">Hur länge vill {parent1Name} vara hemma?</h1>
            <div className="space-y-2">
              <Label className="text-base">Antal månader</Label>
              <Input type="number" min={0} max={24} className="text-lg h-12" value={months1} onChange={(e) => setMonths1(Math.max(0, Math.min(24, Number(e.target.value) || 0)))} autoFocus />
              {months1 === 0 && <p className="text-sm text-destructive">Sätt minst 1 månad för att skapa en plan.</p>}
            </div>
            {renderDpwSection(parent1Name, daysPerWeek1, setDpw1, months1)}
            {planningMode === "quick" && (
              <p className="text-sm text-muted-foreground italic">Ni får ett balanserat standardförslag som ni kan justera senare.</p>
            )}
          </div>
        );

      case 6:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">Hur länge vill {parent2Name} vara hemma?</h1>
            <div className="space-y-2">
              <Label className="text-base">Antal månader</Label>
              <Input type="number" min={0} max={24} className="text-lg h-12" value={months2} onChange={(e) => setMonths2(Math.max(0, Math.min(24, Number(e.target.value) || 0)))} autoFocus />
              {months2 === 0 && <p className="text-sm text-destructive">Sätt minst 1 månad för att skapa en plan.</p>}
            </div>
            {renderDpwSection(parent2Name, daysPerWeek2, setDpw2, months2)}
            {planningMode === "quick" && (
              <p className="text-sm text-muted-foreground italic">Ni får ett balanserat standardförslag som ni kan justera senare.</p>
            )}
            {planningMode === "guided" && guidedPreviewDpw !== null && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
                Baserat på era svar föreslår vi <span className="font-semibold">{guidedPreviewDpw} dagar/vecka</span>.
              </div>
            )}
          </div>
        );

      case 7:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">Vill ni ha dagar kvar till senare?</h1>
            <div className="space-y-3">
              {([
                { key: "none" as SavingPreset, label: "Nej, använd så mycket som möjligt nu" },
                { key: "lite" as SavingPreset, label: "Ja, vi vill ha lite kvar" },
                { key: "buffert" as SavingPreset, label: "Ja, vi vill ha en buffert" },
                { key: "unknown" as SavingPreset, label: "Jag vet inte än" },
              ]).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => selectPreset(opt.key)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors text-base ${savingPreset === opt.key ? "border-primary bg-primary/5 font-medium" : "border-border bg-card hover:bg-muted"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <Collapsible open={showSlider} onOpenChange={setShowSlider}>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors [&[data-state=open]>svg]:rotate-180">
                Justera exakt antal (valfritt)
                <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform duration-200" />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Spara dagar</span>
                  <span className="font-medium text-lg">{savedDays} dagar</span>
                </div>
                <Slider min={0} max={120} step={1} value={[savedDays]} onValueChange={([v]) => { setSavedDays(v); if (savingPreset === null) setSavingPreset("lite"); }} />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0</span>
                  <span>120</span>
                </div>
              </CollapsibleContent>
            </Collapsible>
            {planningMode === "guided" && guidedPreviewDpw !== null && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
                Baserat på era svar föreslår vi <span className="font-semibold">{guidedPreviewDpw} dagar/vecka</span>.
              </div>
            )}
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
        <p className="text-sm text-muted-foreground">Steg {currentStepIndex + 1} av {totalSteps}</p>
      </div>
      <div className="flex gap-1.5 mb-6">
        {Array.from({ length: totalSteps }, (_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i <= currentStepIndex ? "bg-primary" : "bg-muted"}`}
          />
        ))}
      </div>

      {/* Mode indicator */}
      {renderModeIndicator()}

      {/* Draft actions */}
      <div className="flex justify-center gap-3 mb-4">
        {hasDraft && step === 0 && (
          <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => {
            const d = loadWizardDraft();
            if (d) {
              setPlanningMode(d.planningMode);
              setParent1Name(d.parent1Name); setParent2Name(d.parent2Name);
              setWantIncome(d.wantIncome); setIncome1(d.income1); setIncome2(d.income2);
              setHas240Days1(d.has240Days1); setHas240Days2(d.has240Days2);
              setDueDate(d.dueDate); setPreBirthChoice(d.preBirthChoice);
              setPreBirthDate(d.preBirthDate ? new Date(d.preBirthDate) : undefined);
              setMonths1(d.months1); setMonths2(d.months2);
              setDaysPerWeek1(d.daysPerWeek1); setDaysPerWeek2(d.daysPerWeek2);
              setSavingPreset(d.savingPreset as SavingPreset); setSavedDays(d.savedDays);
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
        <Button variant="ghost" onClick={handleBack} disabled={step === 0}>
          ← Tillbaka
        </Button>
        <Button size="lg" onClick={handleNext} disabled={!canNext()}>
          {isLastStep ? "Se min plan →" : "Nästa →"}
        </Button>
      </div>
    </div>
  );
};

export default OnboardingWizard;
