import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

type SavingPreset = "none" | "lite" | "buffert" | "unknown";

const PRESET_DAYS: Record<SavingPreset, number> = {
  none: 0,
  lite: 30,
  buffert: 60,
  unknown: 30,
};

type WizardResult = {
  parent1Name: string;
  parent2Name: string;
  dueDate: string;
  months1: number;
  months2: number;
  savedDays: number;
};

type Props = {
  onComplete: (result: WizardResult) => void;
};

const OnboardingWizard = ({ onComplete }: Props) => {
  const [step, setStep] = useState(1);
  const [parent1Name, setParent1Name] = useState("");
  const [parent2Name, setParent2Name] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [months1, setMonths1] = useState(6);
  const [months2, setMonths2] = useState(6);
  const [savingPreset, setSavingPreset] = useState<SavingPreset | null>(null);
  const [savedDays, setSavedDays] = useState(30);
  const [showSlider, setShowSlider] = useState(false);

  const totalSteps = 5;

  const canNext = (): boolean => {
    switch (step) {
      case 1: return parent1Name.trim().length > 0 && parent2Name.trim().length > 0;
      case 2: return dueDate.length > 0;
      case 3: return months1 >= 0;
      case 4: return months2 >= 0;
      case 5: return savingPreset !== null;
      default: return false;
    }
  };

  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      onComplete({ parent1Name, parent2Name, dueDate, months1, months2, savedDays });
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const selectPreset = (preset: SavingPreset) => {
    setSavingPreset(preset);
    setSavedDays(PRESET_DAYS[preset]);
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
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
              i < step ? "bg-primary" : "bg-muted"
            }`}
          />
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col justify-center">
        {step === 1 && (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">Vad heter ni?</h1>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-base">Förälder 1</Label>
                <Input
                  className="text-lg h-12"
                  placeholder="Förnamn"
                  value={parent1Name}
                  onChange={(e) => setParent1Name(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label className="text-base">Förälder 2</Label>
                <Input
                  className="text-lg h-12"
                  placeholder="Förnamn"
                  value={parent2Name}
                  onChange={(e) => setParent2Name(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">När är barnet beräknat?</h1>
            <div className="space-y-2">
              <Label className="text-base">Beräknat datum</Label>
              <Input
                type="date"
                className="text-lg h-12"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                autoFocus
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">
              Hur länge vill {parent1Name} vara hemma?
            </h1>
            <div className="space-y-2">
              <Label className="text-base">Antal månader</Label>
              <Input
                type="number"
                min={0}
                max={24}
                className="text-lg h-12"
                value={months1}
                onChange={(e) => setMonths1(Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
                autoFocus
              />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">
              Hur länge vill {parent2Name} vara hemma?
            </h1>
            <div className="space-y-2">
              <Label className="text-base">Antal månader</Label>
              <Input
                type="number"
                min={0}
                max={24}
                className="text-lg h-12"
                value={months2}
                onChange={(e) => setMonths2(Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
                autoFocus
              />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <h1 className="text-3xl font-bold tracking-tight text-center">
              Vill ni ha dagar kvar till senare?
            </h1>
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
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors text-base ${
                    savingPreset === opt.key
                      ? "border-primary bg-primary/5 font-medium"
                      : "border-border bg-card hover:bg-muted"
                  }`}
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
                <Slider
                  min={0}
                  max={120}
                  step={1}
                  value={[savedDays]}
                  onValueChange={([v]) => {
                    setSavedDays(v);
                    // Clear preset match since user manually adjusted
                    if (savingPreset === null) setSavingPreset("lite");
                  }}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0</span>
                  <span>120</span>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-8">
        <Button
          variant="ghost"
          onClick={handleBack}
          disabled={step === 1}
        >
          ← Tillbaka
        </Button>
        <Button
          size="lg"
          onClick={handleNext}
          disabled={!canNext()}
        >
          {step === totalSteps ? "Se min plan →" : "Nästa →"}
        </Button>
      </div>
    </div>
  );
};

export default OnboardingWizard;
