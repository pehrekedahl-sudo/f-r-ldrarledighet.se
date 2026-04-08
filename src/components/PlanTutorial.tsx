import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface TutorialStep {
  targetId: string | null; // null = centered, no spotlight
  title: string;
  body: string;
}

const STEPS: TutorialStep[] = [
  {
    targetId: "plan-hero",
    title: "Översikt",
    body: "Här ser du en sammanfattning av er plan: hur länge pengarna räcker, snittinkomst per månad, och hur många dagar varje förälder har kvar. Du kan dela planen eller börja om.",
  },
  {
    targetId: "plan-timeline",
    title: "Tidslinjen",
    body: "Tidslinjen visar era ledighetsblock i kronologisk ordning. Dra i kanterna för att ändra längd, eller klicka på ett block för att redigera dagar per vecka. Det påverkar direkt hur länge dagarna räcker och vad ni får i ersättning.",
  },
  {
    targetId: "adjust-panel",
    title: "Justera planen",
    body: "Här finjusterar ni planen: ändra växlingsdatum mellan föräldrar, spara dagar som reserv, överföra dagar sinsemellan eller lägga till dubbeldagar. Varje ändring uppdaterar tidslinjen och ersättningen direkt.",
  },
  {
    targetId: "benefit-panel",
    title: "Ersättning per förälder",
    body: "Här ser ni vad varje förälder får utbetalt per månad i snitt och hur mycket av lönen det täcker. Ni kan även lägga till arbetsgivarens tillägg (löneuppfyllnad) för att se den riktiga nettoskillnaden.",
  },
  {
    targetId: null,
    title: "Klart! 🎉",
    body: "Nu är ni redo att planera! Ni kan alltid ta fram den här guiden igen via ❓-knappen uppe till höger.",
  },
];

const STORAGE_KEY = "planTutorialSeenV1";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function PlanTutorial({ open, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const currentStep = STEPS[step];

  const measureTarget = useCallback(() => {
    if (!currentStep.targetId) {
      setRect(null);
      return;
    }
    const el = document.getElementById(currentStep.targetId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Small delay so scroll settles before measuring
      setTimeout(() => {
        setRect(el.getBoundingClientRect());
      }, 350);
    } else {
      setRect(null);
    }
  }, [currentStep.targetId]);

  useEffect(() => {
    if (!open) return;
    setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    measureTarget();
    const onResize = () => measureTarget();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, step, measureTarget]);

  const finish = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, "true"); } catch {}
    onClose();
  }, [onClose]);

  const next = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else finish();
  };

  const skip = () => finish();

  if (!open) return null;

  const PAD = 8;
  const isSpotlight = currentStep.targetId !== null && rect !== null;

  // Clip-path to cut a hole in the overlay
  const clipPath = isSpotlight
    ? `polygon(
        0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
        ${rect!.left - PAD}px ${rect!.top - PAD}px,
        ${rect!.left - PAD}px ${rect!.bottom + PAD}px,
        ${rect!.right + PAD}px ${rect!.bottom + PAD}px,
        ${rect!.right + PAD}px ${rect!.top - PAD}px,
        ${rect!.left - PAD}px ${rect!.top - PAD}px
      )`
    : undefined;

  // Position tooltip below the target, or centered
  const tooltipStyle: React.CSSProperties = isSpotlight
    ? {
        position: "fixed",
        top: Math.min(rect!.bottom + PAD + 12, window.innerHeight - 220),
        left: Math.max(16, Math.min(rect!.left, window.innerWidth - 380)),
        zIndex: 60,
      }
    : {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 60,
      };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50 transition-all duration-300"
        style={{
          backgroundColor: "rgba(0,0,0,0.55)",
          clipPath,
        }}
        onClick={skip}
      />

      {/* Spotlight ring */}
      {isSpotlight && (
        <div
          className="fixed z-50 rounded-lg border-2 border-primary/60 pointer-events-none transition-all duration-300"
          style={{
            top: rect!.top - PAD,
            left: rect!.left - PAD,
            width: rect!.width + PAD * 2,
            height: rect!.height + PAD * 2,
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        className="bg-card rounded-xl shadow-lg border border-border p-5 max-w-sm w-[calc(100vw-2rem)] animate-in fade-in-0 zoom-in-95 duration-200"
        style={tooltipStyle}
      >
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-sm font-semibold text-foreground">{currentStep.title}</h3>
          <button onClick={skip} className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 p-1 rounded-md">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">{currentStep.body}</p>

        <div className="flex items-center justify-between">
          {/* Step dots */}
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${i === step ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step < STEPS.length - 1 && (
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={skip}>
                Hoppa över
              </Button>
            )}
            <Button size="sm" className="text-xs h-7 px-4" onClick={next}>
              {step < STEPS.length - 1 ? "Nästa" : "Klar!"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export function usePlanTutorial() {
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== "true") {
        // Small delay so the plan renders first
        const t = setTimeout(() => setShowTutorial(true), 800);
        return () => clearTimeout(t);
      }
    } catch {}
  }, []);

  return { showTutorial, setShowTutorial };
}
