import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown, CalendarIcon } from "lucide-react";
import { format, differenceInCalendarDays, subWeeks } from "date-fns";
import { sv } from "date-fns/locale";
import { cn } from "@/lib/utils";

type SavingPreset = "none" | "lite" | "buffert" | "unknown";

const PRESET_DAYS: Record<SavingPreset, number> = {
  none: 0,
  lite: 30,
  buffert: 60,
  unknown: 30,
};

export type WizardResult = {
  parent1Name: string;
  parent2Name: string;
  dueDate: string;
  months1: number;
  months2: number;
  savedDays: number;
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

const OnboardingWizard = ({ onComplete }: Props) => {
  const [step, setStep] = useState(1);
  // Step 1
  const [parent1Name, setParent1Name] = useState("");
  const [parent2Name, setParent2Name] = useState("");
  // Step 2
  const [wantIncome, setWantIncome] = useState<boolean | null>(null);
  const [income1, setIncome1] = useState("");
  const [income2, setIncome2] = useState("");
  const [has240Days1, setHas240Days1] = useState(true);
  const [has240Days2, setHas240Days2] = useState(true);
  // Step 3
  const [dueDate, setDueDate] = useState("");
  // Step 4
  const [preBirthChoice, setPreBirthChoice] = useState<"no" | "p1" | "p2" | null>(null);
  const [preBirthDate, setPreBirthDate] = useState<Date | undefined>(undefined);
  // Step 5 & 6
  const [months1, setMonths1] = useState(6);
  const [months2, setMonths2] = useState(6);
  // Step 7
  const [savingPreset, setSavingPreset] = useState<SavingPreset | null>(null);
  const [savedDays, setSavedDays] = useState(30);
  const [showSlider, setShowSlider] = useState(false);

  const totalSteps = 7;

  const canNext = (): boolean => {
    switch (step) {
      case 1: return parent1Name.trim().length > 0 && parent2Name.trim().length > 0;
      case 2: return wantIncome !== null;
      case 3: return dueDate.length > 0;
      case 4: return preBirthChoice === "no" || (preBirthChoice !== null && preBirthDate !== undefined);
      case 5: return months1 >= 1;
      case 6: return months2 >= 1;
      case 7: return savingPreset !== null;
      default: return false;
    }
  };

  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      onComplete({
        parent1Name,
        parent2Name,
        dueDate,
        months1,
        months2,
        savedDays,
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
    if (step > 1) setStep(step - 1);
  };

  const selectPreset = (preset: SavingPreset) => {
    setSavingPreset(preset);
    setSavedDays(PRESET_DAYS[preset]);
  };

  const stepContent = () => {
    switch (step) {
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
        <p className="text-sm text-muted-foreground">Steg {step} av {totalSteps}</p>
      </div>
      <div className="flex gap-1.5 mb-12">
        {Array.from({ length: totalSteps }, (_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i < step ? "bg-primary" : "bg-muted"}`}
          />
        ))}
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
          {step === totalSteps ? "Se min plan →" : "Nästa →"}
        </Button>
      </div>
    </div>
  );
};

export default OnboardingWizard;
